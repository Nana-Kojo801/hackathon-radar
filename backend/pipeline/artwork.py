"""Artwork step: a banner and an icon for listings whose platform didn't give them.

Each listing can have two kinds of artwork: a wide banner (shown across the top
of its page) and a square icon (in lists). Platforms give one or both
(icon_url, banner_url); for what's missing, in order:

- Banner: the share image (og:image / twitter:image) of the hackathon's own
  page, if it's wide. Aggregator sites often use one image for every event, so
  an image shared by two or more listings is treated as generic and dropped.
- Icon: the organizer's logo. The AI names the organizer's official website
  (one batched call, cached in organizer_sites) and the logo is read from its
  homepage (apple-touch-icon, a large icon, or the logo in its structured
  data); else the icon of the hackathon's own site when it isn't an aggregator.

Every image is checked to load, and its shape read from the first bytes of the
file, so a square thumbnail never becomes a banner or a banner an icon. A
listing is looked at once, and again a week later (three times at most) if
nothing was found; at most MAX_ARTWORK_PER_RUN per run. The results are
page_image_url (a banner) and logo_url (an icon, drawn on a plain tile).
"""

import json
import logging
import os
import re
import struct
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from . import ai
from .http import PoliteClient

log = logging.getLogger(__name__)

MAX_ARTWORK_PER_RUN = int(os.getenv("MAX_ARTWORK_PER_RUN", "60") or 60)
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


def image_size(data: bytes) -> tuple[int, int] | None:
    """Width and height from the start of a PNG, GIF, WebP or JPEG file."""
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP" and len(data) >= 30:
        chunk = data[12:16]
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if chunk == b"VP8L":
            b = data[21:25]
            return 1 + (((b[1] & 0x3F) << 8) | b[0]), 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6))
        if chunk == b"VP8X":
            return 1 + int.from_bytes(data[24:27], "little"), 1 + int.from_bytes(data[27:30], "little")
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 <= len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01, 0xFF) or 0xD0 <= marker <= 0xD7:
                i += 1 if marker == 0xFF else 2
                continue
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    return None


def probe(http: PoliteClient, url: str) -> tuple[bool, tuple[int, int] | None]:
    """Whether the URL answers with an image, and its size when the format tells (SVG doesn't)."""
    if not url.startswith("https://"):
        return False, None
    try:
        with http.client.stream("GET", url, timeout=10) as r:
            if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
                return False, None
            data = b""
            for chunk in r.iter_bytes():
                data += chunk
                if len(data) >= 262_144 or image_size(data):
                    break
            return True, image_size(data)
    except httpx.HTTPError:
        return False, None


def is_banner(http: PoliteClient, url: str) -> bool:
    ok, size = probe(http, url)
    return ok and size is not None and size[0] >= 400 and size[0] / max(1, size[1]) >= 1.45


def is_icon(http: PoliteClient, url: str) -> bool:
    """Square-ish and big enough to show; an SVG (no size in its header) counts."""
    ok, size = probe(http, url)
    return ok and (size is None or (size[0] >= 64 and 0.7 <= size[0] / max(1, size[1]) <= 1.45))


def best_logo(http: PoliteClient, head: _Head) -> str | None:
    """A square-ish logo: the biggest touch icon or large icon, else a structured-data logo."""
    icons = sorted(((s, u) for s, u in head.icons if s >= 96), reverse=True)
    for _, url in icons[:3]:
        if is_icon(http, url):
            return url
    for url in head.logos[:2]:
        if is_icon(http, url):
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
    """A banner and/or an icon for the listing, whichever it's missing."""
    pages = [u for u in [row["source_url"], *(row["alt_urls"] or [])] if u and u.startswith("http")][:3]
    banner = logo = site_icon = None
    for url in pages:
        if not (row["want_banner"] or row["want_icon"]):
            break
        head = read_page(http, url)
        if not head:
            continue
        if row["want_banner"] and not banner:
            banner = next((u for u in head.images[:2] if not PLACEHOLDER.search(u) and is_banner(http, u)), None)
        if row["want_icon"] and not site_icon and not _is_aggregator(url):
            site_icon = best_logo(http, head)
        if (banner or not row["want_banner"]) and (site_icon or not row["want_icon"]):
            break
    if row["want_icon"] and org_domain:
        head = read_page(http, f"https://{org_domain}/")
        if head:
            logo = best_logo(http, head)
        if not logo and is_icon(http, f"https://{org_domain}/apple-touch-icon.png"):
            logo = f"https://{org_domain}/apple-touch-icon.png"
    return {"page_image_url": banner, "logo_url": logo or site_icon}


def run_artwork(conn, limit: int | None = None, ids: list | None = None) -> dict:
    """Artwork for the listings missing it; or right away for `ids` (a hackathon you just added)."""
    limit = MAX_ARTWORK_PER_RUN if limit is None else limit
    stats = {"candidates": 0, "covers": 0, "logos": 0, "tokens_used": 0}
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM (
              SELECT id, title, organizer, source_url, alt_urls, prize_usd, artwork_checked_at,
                     -- Devpost banners come from the detail step; Unstop pages carry none.
                     (banner_url IS NULL AND page_image_url IS NULL AND source NOT IN ('devpost', 'unstop')) AS want_banner,
                     (icon_url IS NULL AND logo_url IS NULL
                      AND (image_url IS NULL OR image_url ~* 'placeholder|default[-_]?thumbnail')) AS want_icon
              FROM hackathons
              WHERE NOT is_hidden AND status IN ('open', 'upcoming') AND artwork_attempts < %s
            ) c
            WHERE (want_banner OR want_icon)
              AND (CASE WHEN %s::uuid[] IS NULL
                        THEN artwork_checked_at IS NULL OR artwork_checked_at < now() - interval '7 days'
                        ELSE id = ANY(%s::uuid[]) END)
            ORDER BY artwork_checked_at NULLS FIRST, prize_usd DESC NULLS LAST
            LIMIT %s
            """,
            (MAX_ATTEMPTS, ids, ids, limit),
        )
        rows = cur.fetchall()
        usage = ai.Usage()
        domains = organizer_domains(cur, [r["organizer"] for r in rows if r["organizer"] and r["want_icon"]], usage)
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
                "UPDATE hackathons SET page_image_url = COALESCE(%s, page_image_url), logo_url = COALESCE(%s, logo_url),"
                " artwork_checked_at = now(),"
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
