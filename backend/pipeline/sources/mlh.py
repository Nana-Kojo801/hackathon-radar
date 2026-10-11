"""MLH season events page.

mlh.io redirects to https://www.mlh.com/seasons/<season>/events, an Inertia.js
page: the event list is JSON inside <script data-page="app" type="application/json">,
under props.upcomingEvents (each with name, startsAt, endsAt, location,
formatType, websiteUrl, slug, ...). MLH seasons run Aug -> Jul and are named
after the year they end in.
"""

import json
import logging
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from ..dates import parse_iso
from ..http import PoliteClient
from ..types import RawListing, Source

log = logging.getLogger(__name__)

BASE = "https://www.mlh.com"
FORMATS = {"physical": "in_person", "digital": "online", "virtual": "online", "hybrid": "hybrid"}


def current_seasons(now: datetime | None = None) -> list[int]:
    now = now or datetime.now(timezone.utc)
    season = now.year + 1 if now.month >= 8 else now.year
    # Next season's list starts filling up around early summer.
    return [season, season + 1] if now.month in (5, 6, 7) else [season]


class MLHSource(Source):
    name = "mlh"
    timeout = 90

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.5)

    def fetch(self) -> list[RawListing]:
        out: list[RawListing] = []
        for season in current_seasons():
            r = self.client.get(f"{BASE}/seasons/{season}/events")
            soup = BeautifulSoup(r.text, "lxml")
            tag = soup.find("script", attrs={"data-page": "app"})
            if not tag or not tag.string:
                raise ValueError(f"MLH page layout changed: no Inertia data on season {season}")
            props = json.loads(tag.string).get("props") or {}
            events = props.get("upcomingEvents")
            if events is None:
                raise ValueError("MLH page layout changed: props.upcomingEvents missing")
            out.extend(filter(None, (self._to_listing(e) for e in events)))
        return out

    def _to_listing(self, e: dict) -> RawListing | None:
        name = e.get("name")
        url = e.get("websiteUrl") or (BASE + e["url"] if e.get("url") else None)
        if not name or not url:
            return None
        fmt = FORMATS.get((e.get("formatType") or "").lower())
        focus = (e.get("customFields") or {}).get("hackathon_focus") or []
        underserved = (e.get("customFields") or {}).get("underserved_types") or []
        desc = [f"MLH Member Event ({e.get('formatType') or 'unknown format'})"
                f" in {e.get('location') or 'unknown location'}, {e.get('dateRange') or ''}."]
        if focus:
            desc.append("Focus: " + ", ".join(map(str, focus)) + ".")
        if underserved:
            desc.append("Diversity focus: " + ", ".join(map(str, underserved)) + ".")
        return RawListing(
            source=self.name,
            source_url=url,
            title=name,
            organizer=None,
            description=" ".join(desc),
            prize_text=None,
            location_text=e.get("location"),
            dates_text=e.get("dateRange"),
            raw_payload=e,
            start_date=parse_iso(e.get("startsAt")),
            end_date=parse_iso(e.get("endsAt")),
            format=fmt,
            # MLH's season list is the student hackathon league.
            student_only=True,
            international_ok=True if fmt == "online" else None,
            image_url=e.get("logoUrl") or e.get("backgroundUrl"),
        )
