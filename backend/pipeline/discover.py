"""Web discovery: find hackathons outside the known platforms.

search queries (Tavily) -> fetch result pages -> AI extracts hackathons ->
keep only specific hackathons with a working link. The normal pipeline then
dedupes and enriches them; enrichment drops anything that isn't a real hackathon.

Cost guards: pages whose text hasn't changed are never sent to the AI again
(their earlier extraction is re-used from discovered_pages), and at most
MAX_DISCOVERY_PAGES new/changed pages are extracted per run.
"""

import hashlib
import logging
import os
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from psycopg.types.json import Jsonb

from app import config, db

from . import ai
from .dates import parse_iso
from .http import PoliteClient
from .normalize import canonical_url, clean_text
from .types import RawListing, Source

log = logging.getLogger(__name__)

TAVILY_URL = os.getenv("SEARCH_API_URL", "https://api.tavily.com/search")
PAGE_TEXT_LIMIT = 6000
RESULTS_PER_QUERY = 5
MAX_LINK_CHECKS = 40

SOCIAL_DOMAINS = (
    "twitter.com", "x.com", "facebook.com", "instagram.com", "linkedin.com", "youtube.com",
    "reddit.com", "tiktok.com", "discord.gg", "discord.com", "t.me", "wa.me",
)
# Covered by dedicated adapters, or not hackathon pages at all.
SKIP_DOMAINS = ("devpost.com", "devfolio.co", "mlh.io", "mlh.com", "unstop.com", "taikai.network",
                "ethglobal.com", "hackerearth.com", "medium.com", "quora.com",
                "wikipedia.org") + SOCIAL_DOMAINS


def _host_in(url: str, domains: tuple[str, ...]) -> bool:
    host = urlsplit(url).netloc.lower().removeprefix("www.")
    return any(host == d or host.endswith("." + d) for d in domains)


def queries(now: datetime | None = None) -> list[str]:
    year = (now or datetime.now(timezone.utc)).year
    return [
        f"hackathon prize {year} register",
        "online hackathon cash prize registration open",
        "AI hackathon open now prize pool",
        f"global online hackathon {year} open to all countries",
        f"web3 OR fintech OR climate hackathon {year} prize apply",
    ]


EXTRACT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["hackathons"],
    "properties": {
        "hackathons": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "title", "url", "organizer", "prize_text", "location_text", "dates_text",
                    "start_date", "end_date", "registration_deadline", "format", "description",
                ],
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string", "description": "Absolute URL of the hackathon's own page or registration page."},
                    "organizer": {"type": ["string", "null"]},
                    "prize_text": {"type": ["string", "null"], "description": "Prize pool as written, e.g. '$50,000 in prizes'."},
                    "location_text": {"type": ["string", "null"]},
                    "dates_text": {"type": ["string", "null"]},
                    "start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                    "end_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                    "registration_deadline": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                    "format": {"type": "string", "enum": ["online", "in_person", "hybrid", "unknown"]},
                    "description": {"type": ["string", "null"], "description": "1-3 sentences from the page."},
                },
            },
        }
    },
}

EXTRACT_SYSTEM = """You extract hackathon listings from a web page for a hackathon finder.
Return every SPECIFIC hackathon on the page that people can still register for or join
(not ended before today). A hackathon needs a name and a URL pointing to its own page or
registration page; use links shown in [brackets] in the text. If the page itself is one
hackathon's page, return it with the page URL. Skip: generic advice, courses, job posts,
past events, hackathon platforms' home pages, and anything without a link.
Don't invent facts or URLs: use null when the page doesn't say, and only use URLs that appear
on the page. Return at most 15 hackathons. Return {"hackathons": []} if none."""


def search(query: str, client: httpx.Client) -> list[dict]:
    r = client.post(
        TAVILY_URL,
        headers={"Authorization": f"Bearer {config.SEARCH_API_KEY}"},
        json={
            "api_key": config.SEARCH_API_KEY,
            "query": query,
            "search_depth": "basic",
            "max_results": RESULTS_PER_QUERY,
            "include_raw_content": False,
        },
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("results") or []


def page_text(html: str, base_url: str) -> str:
    """Visible text with outbound links kept inline as 'anchor [url]'."""
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "noscript", "svg", "iframe", "form", "nav", "footer"]):
        tag.decompose()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        text = a.get_text(" ", strip=True)
        if not text or href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = urljoin(base_url, href)
        if _host_in(absolute, SOCIAL_DOMAINS):
            continue  # social links are noise
        a.replace_with(f"{text} [{absolute}]")
    title = soup.title.get_text(strip=True) if soup.title else ""
    body = soup.get_text("\n", strip=True)
    text = f"{title}\n\n{body}" if title else body
    return clean_text(text, PAGE_TEXT_LIMIT) or ""


def _skip(url: str) -> bool:
    return _host_in(url, SKIP_DOMAINS)


def _to_listing(item: dict, page_url: str) -> RawListing | None:
    url = (item.get("url") or "").strip()
    title = (item.get("title") or "").strip()
    if not url or not title:
        return None
    url = urljoin(page_url, url)
    if not url.startswith(("http://", "https://")) or _skip(url):
        return None
    return RawListing(
        source="web",
        source_url=url,
        title=title,
        organizer=item.get("organizer"),
        description=item.get("description"),
        prize_text=item.get("prize_text"),
        location_text=item.get("location_text"),
        dates_text=item.get("dates_text"),
        raw_payload={"found_on": page_url, "extracted": item},
        start_date=parse_iso(item.get("start_date")),
        end_date=parse_iso(item.get("end_date")),
        registration_deadline=parse_iso(item.get("registration_deadline")),
        prize_usd=None,  # web prize text is unreliable; the AI estimates it with a confidence
        format=item.get("format") if item.get("format") != "unknown" else None,
    )


class WebDiscoverySource(Source):
    name = "web"
    timeout = 420

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.0, timeout=15)
        self.tokens_used = 0

    def fetch(self) -> list[RawListing]:
        if not config.SEARCH_API_KEY:
            raise RuntimeError("SEARCH_API_KEY is not set; web discovery skipped")
        ai.client()  # raises AIUnavailable early if there's no OpenAI key

        results: dict[str, dict] = {}
        with httpx.Client() as http:
            for q in queries():
                try:
                    for res in search(q, http):
                        url = res.get("url")
                        if url and not _skip(url):
                            results.setdefault(canonical_url(url), res)
                except httpx.HTTPError as e:
                    log.warning("search failed for %r: %s", q, e)
        if not results:
            raise RuntimeError("no search results (search API failing?)")
        log.info("web: %d candidate pages from %d queries", len(results), len(queries()))

        usage = ai.Usage()
        listings: list[RawListing] = []
        extracted_pages = 0
        conn = db.connect()
        try:
            for page_url, res in results.items():
                try:
                    try:
                        html = self.client.get(res["url"]).text
                        text = page_text(html, res["url"])
                    except Exception as e:  # blocked or down: fall back to the search snippet
                        log.info("web: fetch failed for %s (%s); using snippet", page_url, e)
                        text = clean_text(f"{res.get('title', '')}\n\n{res.get('content', '')}", PAGE_TEXT_LIMIT) or ""
                    if len(text) < 200:
                        continue
                    h = hashlib.sha256(text.encode()).hexdigest()
                    with conn.cursor() as cur:
                        cur.execute("SELECT content_hash, listings FROM discovered_pages WHERE url = %s", (page_url,))
                        cached = cur.fetchone()
                    if cached and cached["content_hash"] == h:
                        items = cached["listings"]
                        with conn.cursor() as cur:
                            cur.execute("UPDATE discovered_pages SET last_seen_at = now() WHERE url = %s", (page_url,))
                        conn.commit()
                    else:
                        if extracted_pages >= config.MAX_DISCOVERY_PAGES:
                            continue
                        extracted_pages += 1
                        today = datetime.now(timezone.utc).date().isoformat()
                        out = ai.chat_json(
                            EXTRACT_SYSTEM, f"Today: {today}\nPage URL: {res['url']}\n\n{text}",
                            EXTRACT_SCHEMA, "hackathon_extraction", usage, max_tokens=4000,
                        )
                        items = out.get("hackathons") or []
                        with conn.cursor() as cur:
                            cur.execute(
                                "INSERT INTO discovered_pages (url, content_hash, found, listings)"
                                " VALUES (%s, %s, %s, %s) ON CONFLICT (url) DO UPDATE SET"
                                " content_hash = EXCLUDED.content_hash, found = EXCLUDED.found,"
                                " listings = EXCLUDED.listings, extracted_at = now(), last_seen_at = now()",
                                (page_url, h, len(items), Jsonb(items)),
                            )
                        conn.commit()
                    listings.extend(filter(None, (_to_listing(i, res["url"]) for i in items)))
                except Exception as e:
                    conn.rollback()
                    log.warning("web: page %s failed: %s", page_url, e)
        finally:
            conn.close()
            self.tokens_used = usage.total

        listings = self._drop_dead(self._drop_past(listings))
        cost = usage.cost_usd(config.OPENAI_MODEL)
        log.info("web: extracted %d pages, %d hackathons kept, tokens=%d est_cost=%s",
                 extracted_pages, len(listings), usage.total, f"${cost:.4f}" if cost is not None else "n/a")
        return listings

    @staticmethod
    def _drop_past(listings: list[RawListing]) -> list[RawListing]:
        now = datetime.now(timezone.utc)
        out, seen = [], set()
        for r in listings:
            last = r.registration_deadline or r.end_date
            key = canonical_url(r.source_url)
            if (last and last < now) or key in seen:
                continue
            seen.add(key)
            out.append(r)
        return out

    def _drop_dead(self, listings: list[RawListing]) -> list[RawListing]:
        """Discard listings whose link is gone (404/410/DNS). Other errors are often
        bot-blocking (403/429/5xx), so those stay and the AI judges them."""
        conn = db.connect()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT source_url FROM hackathons WHERE source_url = ANY(%s)",
                    ([canonical_url(r.source_url) for r in listings],),
                )
                known = {row["source_url"] for row in cur.fetchall()}
        finally:
            conn.close()
        out, checks = [], 0
        for r in listings:
            if canonical_url(r.source_url) in known:
                out.append(r)
                continue
            if checks >= MAX_LINK_CHECKS:
                break
            checks += 1
            try:
                resp = self.client.client.get(r.source_url, timeout=10)
                if resp.status_code in (404, 410):
                    log.info("web: dropping dead link %s (%s)", r.source_url, resp.status_code)
                    continue
            except httpx.HTTPError as e:
                log.info("web: dropping unreachable %s (%s)", r.source_url, type(e).__name__)
                continue
            out.append(r)
        return out
