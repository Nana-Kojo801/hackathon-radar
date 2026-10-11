"""HackerEarth.

The /challenges/hackathon/ page renders in the browser from a public JSON
endpoint (allowed by robots.txt) that returns every challenge, past and
present, in one response:

    GET https://www.hackerearth.com/api/community/challenges/compete/
    -> {"data": [{title, type, url, start, end, company_name, listing_image, ...}], "total": N}

Times are naive UTC. We keep type == "Hackathon" (plus "Competitive" ones
named hackathons) that haven't ended. The list has no description or prize,
and each hackathon's page redirects to its own one-off landing site, so the
detail step only reads the landing page's title/description meta tags.
"""

import logging
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..dates import parse_iso
from ..http import PoliteClient
from ..types import RawListing, Source

log = logging.getLogger(__name__)

BASE = "https://www.hackerearth.com"
API = f"{BASE}/api/community/challenges/compete/"


class HackerEarthSource(Source):
    name = "hackerearth"
    timeout = 60

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.5)

    def fetch(self) -> list[RawListing]:
        body = self.client.get(API, headers={"Accept": "application/json"}).json()
        if not isinstance(body.get("data"), list):
            raise ValueError("HackerEarth API changed: data list missing")
        return list(filter(None, (to_listing(c) for c in body["data"])))

    def fetch_detail(self, listing: dict) -> dict | None:
        r = self.client.get(listing["source_url"])
        soup = BeautifulSoup(r.text, "lxml")
        parts = []
        for attrs in ({"property": "og:title"}, {"property": "og:description"}, {"name": "description"}):
            tag = soup.find("meta", attrs=attrs)
            text = (tag.get("content") or "").strip() if tag else ""
            if text and text not in parts:
                parts.append(text)
        return {"text": "\n\n".join(parts) or None, "prizes": []}


def to_listing(c: dict, now: datetime | None = None) -> RawListing | None:
    now = now or datetime.now(timezone.utc)
    title = (c.get("title") or "").strip()
    kind = c.get("type") or ""
    if not title or not c.get("url"):
        return None
    if kind != "Hackathon" and "hackathon" not in title.lower():
        return None
    start, end = parse_iso(c.get("start")), parse_iso(c.get("end"))  # naive UTC -> aware
    if not end or end < now:
        return None
    team = (c.get("min_team_size"), c.get("max_team_size"))
    desc = f"{title} on HackerEarth" + (f", hosted by {c['company_name']}" if c.get("company_name") else "") + "."
    if team[1]:
        desc += f" Teams of {team[0] or 1}-{team[1]}."
    return RawListing(
        source="hackerearth",
        source_url=urljoin(BASE, c["url"]),
        title=title,
        organizer=c.get("company_name"),
        description=desc,
        dates_text=f"{c.get('start_str') or ''} - {c.get('end_str') or ''}".strip(" -") or None,
        raw_payload=c,
        start_date=start,
        end_date=end,
        # Submissions close when the challenge ends; there's no separate deadline field.
        registration_deadline=end,
        image_url=c.get("listing_image") or c.get("image_url"),
    )
