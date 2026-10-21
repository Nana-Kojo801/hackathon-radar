"""Add a hackathon the radar hasn't found: from a link, a name, or a post shared from another app.

- POST /me/add/find {"text": ...}: what you typed or shared. Returns up to three candidates, best
  first, with what the AI read from their pages ("not stated" stays null), and the id of the
  hackathon when it's already on the radar. A link is read directly; a name, or a social post
  (LinkedIn pages are mostly behind a login), is searched for on the web first.
- POST /me/add: a candidate as you confirmed (and edited) it. Stored as a web find marked
  added_by_user: shown in Explore at once, never dropped by the AI check, never sent to you as an
  alert. Then, in the background, the AI fills in the summary, prize and themes, the artwork step
  looks for a banner and logo, and the public snapshot is republished so it shows everywhere.
- PATCH /me/add/{id}, DELETE /me/add/{id}: change or delete a hackathon you added (only those).

Same tools as web discovery (pipeline/discover.py): Tavily search, the page reader, OpenAI.
"""

import logging
import re
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from pipeline import ai, artwork, dedupe, discover, enrich, store
from pipeline.dates import parse_iso
from pipeline.http import HEADERS, PoliteClient
from pipeline.normalize import canonical_url, clean_text, normalize
from pipeline.types import RawListing

from . import config, db, refresh
from .personal import require_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/me", dependencies=[Depends(require_key)])

URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]]+")
PAGE_LIMIT = 5000
MAX_PAGES = 5
TAVILY_EXTRACT_URL = "https://api.tavily.com/extract"

FIELDS = ["title", "url", "organizer", "prize_text", "location_text", "dates_text",
          "start_date", "end_date", "registration_deadline", "format", "description"]

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidates"],
    "properties": {
        "candidates": {
            "type": "array",
            "items": discover.EXTRACT_SCHEMA["properties"]["hackathons"]["items"],
        }
    },
}

SYSTEM = """Someone wants to add one specific hackathon to their personal hackathon tracker.
You get what they typed or shared (a name, a link, or a social media post) and some web pages.
Work out which hackathon they mean and return it first. If the pages show other hackathons that
could be what they meant, add up to two more, best match first.

Rules:
- Hackathons only (also buildathons, hack weeks, coding or AI competitions with prizes).
- "url" is the hackathon's own page or registration page, copied from the pages: a page's own
  URL or a link shown in [brackets]. Never invent or guess a URL. Prefer the official page over
  a news article or a social post.
- Fill a field only when a page states it; otherwise null ("format": "unknown"). Dates as
  YYYY-MM-DD. "description": 1-3 sentences from the page.
- If nothing on the pages matches what they asked for, return {"candidates": []}."""


class FindBody(BaseModel):
    text: str = Field(min_length=2, max_length=4000)


class Candidate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=8, max_length=2000)
    organizer: str | None = Field(default=None, max_length=200)
    prize_text: str | None = Field(default=None, max_length=300)
    location_text: str | None = Field(default=None, max_length=200)
    dates_text: str | None = Field(default=None, max_length=120)
    start_date: str | None = None
    end_date: str | None = None
    registration_deadline: str | None = None
    format: Literal["online", "in_person", "hybrid", "unknown"] = "unknown"
    description: str | None = Field(default=None, max_length=2000)
    # Found on its page while you picked it (find), kept so the listing has them from the start.
    banner_url: str | None = Field(default=None, max_length=2000)
    logo_url: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------- reading pages


def _social(url: str) -> bool:
    return discover._host_in(url, discover.SOCIAL_DOMAINS)


def _slug_words(url: str) -> str:
    """Words in a post's address: linkedin.com/posts/hackerrank_openai-hackathon-activity-7380... ->
    'hackerrank openai hackathon'. Social pages rarely open without a login, but their links say a lot."""
    words = []
    for w in re.split(r"[-_/.+%]+", urlsplit(url).path):
        if w.lower() in {"activity", "status", "ugcpost", "share"} or w.isdigit():
            if words:
                break  # what follows is the post's id
            continue
        if w.isalpha() and len(w) > 1 and w.lower() not in {"posts", "post", "feed", "update", "in", "company", "p", "comments"}:
            words.append(w)
    return " ".join(words)


def _meta_text(html: str) -> str:
    """A page's title and share description: on social posts, often all that's readable without a login."""
    soup = BeautifulSoup(html, "lxml")
    bits = []
    for name in ("og:title", "og:description", "twitter:title", "twitter:description", "description"):
        tag = soup.find("meta", attrs={"property": name}) or soup.find("meta", attrs={"name": name})
        if tag and tag.get("content"):
            bits.append(tag["content"].strip())
    return "\n".join(dict.fromkeys(bits))


def _tavily_extract(url: str, http: httpx.Client) -> str:
    """The page's text as Tavily reads it: a fallback for pages built in the browser."""
    if not config.SEARCH_API_KEY:
        return ""
    try:
        r = http.post(TAVILY_EXTRACT_URL, headers={"Authorization": f"Bearer {config.SEARCH_API_KEY}"},
                      json={"api_key": config.SEARCH_API_KEY, "urls": [url]}, timeout=30)
        r.raise_for_status()
        results = r.json().get("results") or []
        return clean_text(results[0].get("raw_content") if results else "", PAGE_LIMIT) or ""
    except (httpx.HTTPError, ValueError, KeyError) as e:
        log.info("add: extract failed for %s: %s", url, e)
        return ""


def read(url: str, http: httpx.Client) -> tuple[str, str, str]:
    """(final url, page text, share text). Empty text when it can't be read."""
    try:
        r = http.get(url, timeout=15, follow_redirects=True)
        if r.status_code < 400 and "html" in r.headers.get("content-type", "html"):
            final = str(r.url)
            text = discover.page_text(r.text, final)
            share = _meta_text(r.text)
            if len(text) < 300 and not _social(final):
                text = _tavily_extract(final, http) or text
            return final, text[:PAGE_LIMIT], share
    except httpx.HTTPError as e:
        log.info("add: couldn't read %s: %s", url, e)
    return url, ("" if _social(url) else _tavily_extract(url, http)), ""


def search(query: str, http: httpx.Client) -> list[tuple[str, str]]:
    if not config.SEARCH_API_KEY:
        raise HTTPException(503, "Searching needs SEARCH_API_KEY on the server. Paste the hackathon's own link instead.")
    try:
        r = http.post(
            discover.TAVILY_URL,
            headers={"Authorization": f"Bearer {config.SEARCH_API_KEY}"},
            json={"api_key": config.SEARCH_API_KEY, "query": query, "search_depth": "advanced",
                  "max_results": MAX_PAGES, "include_raw_content": True},
            timeout=40,
        )
        r.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"The web search didn't answer ({e}). Try again, or paste the hackathon's link.") from e
    out = []
    for res in r.json().get("results") or []:
        url = res.get("url") or ""
        if not url or _social(url):
            continue
        text = clean_text(res.get("raw_content") or res.get("content"), PAGE_LIMIT) or ""
        out.append((url, f"{res.get('title', '')}\n\n{text}"))
    return out


# ---------------------------------------------------------------- finding


def _raw(c: dict) -> RawListing:
    return RawListing(
        source="web",
        source_url=c["url"],
        title=c["title"],
        organizer=c.get("organizer"),
        description=c.get("description"),
        prize_text=c.get("prize_text"),
        location_text=c.get("location_text"),
        dates_text=c.get("dates_text"),
        raw_payload={"added_by_user": True},
        start_date=parse_iso(c.get("start_date")),
        end_date=parse_iso(c.get("end_date")),
        registration_deadline=parse_iso(c.get("registration_deadline")),
        format=c.get("format") if c.get("format") != "unknown" else None,
        banner_url=_http(c.get("banner_url")),
    )


def _http(url: str | None) -> str | None:
    return url if url and url.startswith(("http://", "https://")) else None


def pictures(cands: list[dict]) -> None:
    """A banner and a logo for each new candidate, from its page, to show while you pick one."""
    todo = [c for c in cands if not c.get("existing_id")]
    if not todo:
        return
    http = PoliteClient(delay=0.2, timeout=8)

    def one(c: dict) -> None:
        try:
            head = artwork.read_page(http, c["url"])
            if not head:
                return
            images = [u for u in head.images[:2] if not artwork.PLACEHOLDER.search(u)]
            c["banner_url"] = next((u for u in images if artwork.is_banner(http, u)), None)
            c["logo_url"] = artwork.best_logo(http, head) or next((u for u in images if artwork.is_icon(http, u)), None)
        except Exception as e:  # pictures are a nicety: never fail the search for them
            log.info("add: no pictures for %s: %s", c["url"], e)

    try:
        with ThreadPoolExecutor(max_workers=3) as pool:
            list(pool.map(one, todo))
    finally:
        http.close()


def _art(cur, hackathon_id) -> dict:
    cur.execute(
        "SELECT COALESCE(banner_url, page_image_url) AS banner_url, COALESCE(icon_url, logo_url) AS logo_url"
        " FROM hackathons WHERE id = %s",
        (hackathon_id,),
    )
    return cur.fetchone() or {"banner_url": None, "logo_url": None}


def existing(cur, c: dict) -> str | None:
    """The hackathon's id if the radar already has it: same link, or same name and dates."""
    row = dedupe.find_by_url(cur, canonical_url(c["url"]))
    if not row:
        row = dedupe.find_by_title(cur, normalize(_raw(c)))
    return str(row["id"]) if row and not row["is_hidden"] else None


def _known(cur, url: str) -> dict | None:
    """The listing at this link, as a candidate, if the radar already shows it."""
    row = dedupe.find_by_url(cur, canonical_url(url))
    if not row or row["is_hidden"]:
        return None
    return {
        "title": row["title"], "url": row["source_url"], "organizer": row["organizer"],
        "prize_text": row["prize_text"], "location_text": row["location_text"], "dates_text": row["dates_text"],
        "start_date": _day(row["start_date"]), "end_date": _day(row["end_date"]),
        "registration_deadline": _day(row["registration_deadline"]), "format": row["format"] or "unknown",
        "description": row["summary"] or clean_text(row["description_raw"], 400), "existing_id": str(row["id"]),
        **_art(cur, row["id"]),
    }


def _day(v) -> str | None:
    return v.date().isoformat() if v else None


@router.post("/add/find")
def find(body: FindBody) -> dict:
    text = body.text.strip()
    urls = list(dict.fromkeys(u.rstrip(".,;:!?") for u in URL_RE.findall(text)))[:3]

    # A link to something the radar already has: no AI needed.
    with db.cursor() as cur:
        for u in urls:
            hit = _known(cur, u)
            if hit:
                return {"candidates": [hit], "searched": False}

    try:
        ai.client()
    except ai.AIUnavailable as e:
        raise HTTPException(503, "The AI isn't set up on the server (OPENAI_API_KEY).") from e

    pages: list[tuple[str, str]] = []
    clues: list[str] = [URL_RE.sub(" ", text).strip()]
    searched = False
    with httpx.Client(headers=HEADERS) as http:
        for u in urls:
            final, page, share = read(u, http)
            if _social(final):
                # A post about the hackathon: what it says (or its address) is what to search for.
                clues.append(share or page[:600] or _slug_words(final))
            elif page:
                pages.append((final, page))
                with db.cursor() as cur:
                    hit = _known(cur, final)
                if hit:
                    return {"candidates": [hit], "searched": False}
        clue = clean_text(" ".join(c for c in clues if c), 400) or ""
        if not pages:
            if len(clue) < 3:
                raise HTTPException(422, "Couldn't read that link. Paste the hackathon's name or its own page instead.")
            pages = search(f"{clue} hackathon", http)
            searched = True
    if not pages:
        return {"candidates": [], "searched": searched}

    today = datetime.now(timezone.utc).date().isoformat()
    usage = ai.Usage()
    prompt = f"Today: {today}\nThey typed or shared:\n{text[:1500]}\n" + "".join(
        f"\n--- Page {i + 1}: {url}\n{page}\n" for i, (url, page) in enumerate(pages[:MAX_PAGES])
    )
    try:
        out = ai.chat_json(SYSTEM, prompt, SCHEMA, "add_hackathon", usage, max_tokens=2500)
    except Exception as e:
        log.warning("add: extraction failed: %s", e)
        raise HTTPException(502, "The AI couldn't read the pages just now. Try again in a moment.") from e
    log.info("add: %d pages, tokens=%d", len(pages), usage.total)

    candidates, seen = [], set()
    with db.cursor() as cur:
        for c in out.get("candidates") or []:
            url = (c.get("url") or "").strip()
            if not url.startswith(("http://", "https://")) or _social(url) or not (c.get("title") or "").strip():
                continue
            key = canonical_url(url)
            if key in seen:
                continue
            seen.add(key)
            c = {k: c.get(k) for k in FIELDS}
            c["format"] = c.get("format") or "unknown"
            c["existing_id"] = existing(cur, c)
            c.update(_art(cur, c["existing_id"]) if c["existing_id"] else {"banner_url": None, "logo_url": None})
            candidates.append(c)
    candidates = candidates[:3]
    pictures(candidates)
    return {"candidates": candidates, "searched": searched}


# ---------------------------------------------------------------- adding


@router.post("/add", status_code=201)
def add(body: Candidate, background: BackgroundTasks) -> dict:
    from .main import LIST_COLUMNS

    c = body.model_dump()
    if not c["url"].startswith(("http://", "https://")):
        raise HTTPException(422, "The link must start with http:// or https://")
    n = normalize(_raw(c))
    with db.cursor() as cur:
        row = dedupe.find_by_url(cur, n.source_url)
        created = False
        if row is None:
            created = store.upsert(cur, n) == "new"
            row = dedupe.find_by_url(cur, n.source_url)
        if row is None:  # merged into a listing found by name: it's that one
            row = dedupe.find_by_title(cur, n)
        if row is None:
            raise HTTPException(500, "Couldn't store the hackathon")
        cur.execute(
            # A web find the AI hasn't vetted yet counts as yours too, so it shows now.
            "UPDATE hackathons SET is_hidden = false, last_seen_at = now(),"
            " added_by_user = added_by_user OR %s OR (source = 'web' AND enriched_at IS NULL),"
            " logo_url = CASE WHEN %s THEN COALESCE(logo_url, %s) ELSE logo_url END WHERE id = %s",
            (created, created, _http(c.get("logo_url")), row["id"]),
        )
        store.refresh_statuses(cur)
        cur.execute(f"SELECT {LIST_COLUMNS} FROM hackathons WHERE id = %s", (row["id"],))
        hackathon = cur.fetchone()
    if created:
        background.add_task(finish, str(row["id"]))
    return {"hackathon": hackathon, "created": created}


# ---------------------------------------------------------------- editing and deleting yours


@router.patch("/add/{hackathon_id}")
def edit(hackathon_id: UUID, body: Candidate, background: BackgroundTasks) -> dict:
    """Change a hackathon you added. The AI then reads it again (summary, prize amount, themes)."""
    from .main import get_hackathon

    c = body.model_dump()
    if not c["url"].startswith(("http://", "https://")):
        raise HTTPException(422, "The link must start with http:// or https://")
    n = normalize(_raw(c))
    r = n.raw
    with db.cursor() as cur:
        cur.execute("SELECT id, hints FROM hackathons WHERE id = %s AND added_by_user", (hackathon_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Only hackathons you added can be edited.")
        other = dedupe.find_by_url(cur, n.source_url)
        if other and other["id"] != row["id"]:
            raise HTTPException(409, f"“{other['title']}” on the radar already uses that link.")
        hints = dict(row["hints"] or {})
        if r.format:
            hints["format"] = r.format
        else:
            hints.pop("format", None)
        cur.execute(
            """
            UPDATE hackathons SET
                title = %(title)s, title_key = %(key)s, source_url = %(url)s, organizer = %(org)s,
                prize_text = %(prize)s, location_text = %(loc)s,
                start_date = %(start)s, end_date = %(end)s, registration_deadline = %(deadline)s,
                format = COALESCE(%(format)s, 'unknown'), hints = %(hints)s,
                -- A new description replaces the AI's summary and tidied text until it reads it again.
                summary = CASE WHEN description_raw IS DISTINCT FROM %(desc)s THEN %(summary)s ELSE summary END,
                about_md = CASE WHEN description_raw IS DISTINCT FROM %(desc)s THEN NULL ELSE about_md END,
                description_raw = %(desc)s,
                banner_url = COALESCE(%(banner)s, banner_url), logo_url = COALESCE(%(logo)s, logo_url),
                content_hash = %(hash)s, last_seen_at = now()
            WHERE id = %(id)s
            """,
            {
                "id": row["id"], "title": r.title, "key": n.title_key, "url": n.source_url, "org": r.organizer,
                "prize": r.prize_text, "loc": r.location_text, "start": r.start_date, "end": r.end_date,
                "deadline": r.registration_deadline, "format": r.format, "hints": Jsonb(hints),
                "desc": r.description, "summary": clean_text(r.description, 400), "banner": r.banner_url,
                "logo": _http(c.get("logo_url")), "hash": n.content_hash,
            },
        )
        store.refresh_statuses(cur)
    background.add_task(finish, str(hackathon_id))
    return get_hackathon(hackathon_id)


@router.delete("/add/{hackathon_id}", status_code=204)
def remove(hackathon_id: UUID, background: BackgroundTasks) -> Response:
    """Delete a hackathon you added, with your progress and note on it."""
    with db.cursor() as cur:
        cur.execute("DELETE FROM hackathons WHERE id = %s AND added_by_user RETURNING id", (hackathon_id,))
        if not cur.fetchone():
            raise HTTPException(404, "Only hackathons you added can be deleted.")
    background.add_task(publish)
    return Response(status_code=204)


def finish(hackathon_id: str) -> None:
    """After adding: the AI's summary, prize and themes, artwork, and a fresh public snapshot."""
    conn = db.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM hackathons WHERE id = %s", (hackathon_id,))
            row = cur.fetchone()
        if row and config.OPENAI_API_KEY:
            try:
                res = enrich.enrich_one(row, ai.Usage())
                with conn.cursor() as cur:
                    enrich._apply(cur, row, res)
                conn.commit()
            except Exception:
                conn.rollback()
                log.exception("add: enrichment failed for %s", hackathon_id)
        try:
            artwork.run_artwork(conn, limit=1, ids=[hackathon_id])
        except Exception:
            conn.rollback()
            log.exception("add: artwork failed for %s", hackathon_id)
    finally:
        conn.close()
    publish()


def publish() -> None:
    """Republish the snapshot the app reads first, unless a refresh is running (it publishes when done)."""
    if not refresh.configured():
        return
    try:
        current = refresh.latest_run(refresh.REFRESH_WORKFLOW)
        if current and current["status"] != "completed":
            return
        refresh._github("POST", f"/actions/workflows/{refresh.PUBLISH_WORKFLOW}/dispatches", json={"ref": "main"})
    except Exception:
        log.exception("add: couldn't republish the snapshot")
