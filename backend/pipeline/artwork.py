"""Artwork step: a cover for listings that arrive without one.

Most platforms give each listing an image; web finds and a few others don't.
For those, in order:

1. The share image (og:image / twitter:image) of the hackathon's own page.
   Aggregator sites often use one image for every event, so an image shared
   by two or more listings is treated as generic and dropped.
2. The organizer's logo: the AI names the organizer's official website (one
   batched call, cached in organizer_sites), and the logo is read from its
   homepage (apple-touch-icon, a large icon, or the logo in its structured data).
3. The icon of the hackathon's own site, when it isn't an aggregator's.

Every image is checked to load as an image before it's kept. A listing is
looked at once, and again a week later (three times at most) if nothing was
found; at most MAX_ARTWORK_PER_RUN per run. The app shows page_image_url as a
cover (main.py folds it into image_url) and logo_url on a plain tile.
"""

import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from . import ai
from .http import PoliteClient

log = logging.getLogger(__name__)

MAX_ARTWORK_PER_RUN = int(os.getenv("MAX_ARTWORK_PER_RUN", "40") or 40)
MAX_ATTEMPTS = 3
PAGE_LIMIT = 1_500_000

# Listing sites and platforms: their page images can be the event's, but their icons never are.
AGGREGATORS = {
    "devpost.com", "mlh.io", "devfolio.co", "unstop.com", "taikai.network", "ethglobal.com",
    "hackathonhub.eu", "allhackathons.com", "hackathon.com", "hackathons.com", "lu.ma", "luma.com",
    "eventbrite.com", "meetup.com", "linkedin.com", "x.com", "twitter.com", "facebook.com",
    "instagram.com", "medium.com", "notion.site", "google.com", "forms.gle", "thegrid.id",
    "hackerearth.com", "dorahacks.io", "kaggle.com", "github.com", "gitbook.io", "substack.com",
    "internshala.com", "cerebralvalley.ai", "risein.com", "hackclub.com", "angelhack.com", "hackquest.io",
}
# Images from the listing that are really platform placeholders (same rule as the app).
PLACEHOLDER = re.compile(r"placeholder|default[-_]?thumbnail", re.I)


def _site(url: str) -> str:
    host = urlsplit(url).netloc.lower().split(":")[0]
    return ".".join(host.split(".")[-2:])


def _is_aggregator(url: str) -> bool:
    return _site(url) in AGGREGATORS


class _Head(HTMLParser):
    """Collects share images, icons and structured-data logos from a page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[str] = []
        self.icons: list[tuple[int, str]] = []  # (size, href)
        self.logos: list[str] = []
        self._ld = False
        self._ld_text: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key in ("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src") and a.get("content"):
                self.images.append(a["content"].strip())
            elif key == "og:logo" and a.get("content"):
                self.logos.append(a["content"].strip())
        elif tag == "link" and a.get("href"):
            rel = a.get("rel", "").lower()
            href = a["href"].strip()
            if href.startswith("data:"):
                return
            if "apple-touch-icon" in rel:
                self.icons.append((_size(a.get("sizes")) or 180, href))
            elif "icon" in rel:
                size = 512 if href.lower().split("?")[0].endswith(".svg") else _size(a.get("sizes"))
                self.icons.append((size, href))
        elif tag == "script" and a.get("type", "").lower() == "application/ld+json":
            self._ld = True

    def handle_endtag(self, tag):
        if tag == "script" and self._ld:
            self._ld = False
            self.logos.extend(_ld_logos("".join(self._ld_text)))
            self._ld_text = []

    def handle_data(self, data):
        if self._ld:
            self._ld_text.append(data)


def _size(sizes: str | None) -> int:
    m = re.search(r"(\d+)x(\d+)", sizes or "")
    return int(m.group(1)) if m else 0


def _ld_logos(text: str) -> list[str]:
    try:
        data = json.loads(text)
    except ValueError:
        return []
    out: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            logo = node.get("logo")
            if isinstance(logo, str):
                out.append(logo)
            elif isinstance(logo, dict) and isinstance(logo.get("url"), str):
                out.append(logo["url"])
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(data)
    return out


def read_page(http: PoliteClient, url: str) -> _Head | None:
    try:
        r = http.get(url, timeout=12)
    except Exception as e:  # robots, timeouts, 4xx: just no artwork from here
        log.debug("artwork: can't read %s: %s", url, e)
        return None
    if "html" not in r.headers.get("content-type", "html"):
        return None
    head = _Head()
    try:
        head.feed(r.text[:PAGE_LIMIT])
    except Exception:
        pass
    base = str(r.url)
    head.images = [urljoin(base, u) for u in head.images]
    head.icons = [(s, urljoin(base, u)) for s, u in head.icons]
    head.logos = [urljoin(base, u) for u in head.logos]
    return head


def is_image(http: PoliteClient, url: str) -> bool:
    """True when the URL answers with an image (followed redirects, no robots check: it's one asset)."""
    if not url.startswith("https://"):
        return False
    try:
        with http.client.stream("GET", url, timeout=10) as r:
            return r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
    except httpx.HTTPError:
        return False


def best_logo(http: PoliteClient, head: _Head) -> str | None:
    """A square-ish logo: the biggest touch icon or large icon, else a structured-data logo."""
    icons = sorted(((s, u) for s, u in head.icons if s >= 96), reverse=True)
    for _, url in icons[:3]:
        if is_image(http, url):
            return url
    for url in head.logos[:2]:
        if is_image(http, url):
            return url
    return None


# ---------------------------------------------------------------- organizer websites

DOMAIN_SYSTEM = """You map hackathon organizers to their official website.
For each organizer name, give the registrable domain of its official website (like "unesco.org", "xanadu.ai", "mit.edu"), lowercase, no scheme or path.
Use null when you are not confident which organization it is, when it's a person, or when it's a generic name. Never guess."""

DOMAIN_SCHEMA = {
    "type": "object",
    "properties": {
        "sites": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"name": {"type": "string"}, "domain": {"type": ["string", "null"]}},
                "required": ["name", "domain"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["sites"],
    "additionalProperties": False,
}
DOMAIN = re.compile(r"^(?:[a-z0-9-]+\.)+[a-z]{2,}$")


def organizer_domains(cur, names: list[str], usage: ai.Usage) -> dict[str, str | None]:
    """Domains for these organizer names: cached ones, plus one AI call for the rest."""
    names = sorted({n.strip() for n in names if n and n.strip()})
    if not names:
        return {}
    cur.execute("SELECT name, domain FROM organizer_sites WHERE name = ANY(%s)", (names,))
    known = {r["name"]: r["domain"] for r in cur.fetchall()}
    missing = [n for n in names if n not in known]
    if missing:
        try:
            ai.client()
            res = ai.chat_json(DOMAIN_SYSTEM, "\n".join(missing[:80]), DOMAIN_SCHEMA, "organizer_sites", usage, max_tokens=1600)
            found = {s["name"].strip(): s["domain"] for s in res.get("sites", []) if isinstance(s, dict)}
        except Exception as e:  # no key or a failed call: try again next run
            log.warning("artwork: organizer lookup skipped: %s", e)
            found = None
        if found is not None:
            for n in missing[:80]:
                d = (found.get(n) or "").strip().lower().removeprefix("www.") or None
                d = d if d and DOMAIN.match(d) and _site(f"https://{d}") not in AGGREGATORS else None
                known[n] = d
                cur.execute(
                    "INSERT INTO organizer_sites (name, domain) VALUES (%s, %s)"
                    " ON CONFLICT (name) DO UPDATE SET domain = EXCLUDED.domain, checked_at = now()",
                    (n, d),
                )
    return known


# ---------------------------------------------------------------- the step


def find_artwork(http: PoliteClient, row: dict, org_domain: str | None) -> dict:
    pages = [u for u in [row["source_url"], *(row["alt_urls"] or [])] if u and u.startswith("http")][:3]
    cover = logo = site_icon = None
    for url in pages:
        head = read_page(http, url)
        if not head:
            continue
        if not cover:
            cover = next((u for u in head.images[:2] if not PLACEHOLDER.search(u) and is_image(http, u)), None)
        if not site_icon and not _is_aggregator(url):
            site_icon = best_logo(http, head)
        if cover and site_icon:
            break
    if org_domain:
        head = read_page(http, f"https://{org_domain}/")
        if head:
            logo = best_logo(http, head)
        if not logo and is_image(http, f"https://{org_domain}/apple-touch-icon.png"):
            logo = f"https://{org_domain}/apple-touch-icon.png"
    return {"page_image_url": cover, "logo_url": logo or site_icon}


def run_artwork(conn, limit: int | None = None) -> dict:
    limit = MAX_ARTWORK_PER_RUN if limit is None else limit
    stats = {"candidates": 0, "covers": 0, "logos": 0, "tokens_used": 0}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, organizer, source_url, alt_urls FROM hackathons
            WHERE NOT is_hidden AND status IN ('open', 'upcoming')
              AND (image_url IS NULL OR image_url ~* 'placeholder|default[-_]?thumbnail')
              AND page_image_url IS NULL AND logo_url IS NULL
              AND artwork_attempts < %s
              AND (artwork_checked_at IS NULL OR artwork_checked_at < now() - interval '7 days')
            ORDER BY artwork_checked_at NULLS FIRST, prize_usd DESC NULLS LAST
            LIMIT %s
            """,
            (MAX_ATTEMPTS, limit),
        )
        rows = cur.fetchall()
        usage = ai.Usage()
        domains = organizer_domains(cur, [r["organizer"] for r in rows if r["organizer"]], usage)
    conn.commit()
    stats["candidates"] = len(rows)
    if not rows:
        return stats

    http = PoliteClient(delay=1.0, timeout=12)
    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda r: find_artwork(http, r, domains.get((r["organizer"] or "").strip())), rows))
    finally:
        http.close()

    with conn.cursor() as cur:
        for row, res in zip(rows, results):
            found = bool(res["page_image_url"] or res["logo_url"])
            cur.execute(
                "UPDATE hackathons SET page_image_url = %s, logo_url = %s, artwork_checked_at = now(),"
                " artwork_attempts = CASE WHEN %s THEN artwork_attempts ELSE artwork_attempts + 1 END WHERE id = %s",
                (res["page_image_url"], res["logo_url"], found, row["id"]),
            )
            stats["covers"] += bool(res["page_image_url"])
            stats["logos"] += bool(res["logo_url"])
        # One image on several listings is a site's generic share image, not an event's.
        cur.execute(
            "UPDATE hackathons SET page_image_url = NULL WHERE page_image_url IN (SELECT page_image_url FROM hackathons"
            "   WHERE page_image_url IS NOT NULL GROUP BY 1 HAVING count(*) > 1)"
        )
        stats["covers"] -= min(stats["covers"], cur.rowcount)
        # Likewise a logo on listings from different organizers is a listing site's, not theirs
        # (one organizer's logo may repeat across its own events).
        cur.execute(
            "UPDATE hackathons SET logo_url = NULL WHERE logo_url IN (SELECT logo_url FROM hackathons"
            "   WHERE logo_url IS NOT NULL GROUP BY 1 HAVING count(DISTINCT COALESCE(lower(organizer), id::text)) > 1)"
        )
        stats["logos"] -= min(stats["logos"], cur.rowcount)
        # A listing left with nothing after that counts the try, so it isn't re-read every week
        # only to find the same generic images.
        cur.execute(
            "UPDATE hackathons SET artwork_attempts = artwork_attempts + 1"
            " WHERE id = ANY(%s) AND page_image_url IS NULL AND logo_url IS NULL",
            ([row["id"] for row, res in zip(rows, results) if res["page_image_url"] or res["logo_url"]],),
        )
    conn.commit()

    stats["tokens_used"] = usage.total
    log.info("artwork: candidates=%d covers=%d logos=%d tokens=%d", stats["candidates"], stats["covers"], stats["logos"], usage.total)
    return stats
