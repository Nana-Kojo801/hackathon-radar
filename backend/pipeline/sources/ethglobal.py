"""ETHGlobal (Ethereum hackathons, in person and online).

https://ethglobal.com/events is a Next.js App Router page with no
__NEXT_DATA__: the event objects are inside the React Server Components
payload, i.e. the strings passed to self.__next_f.push([1, "..."]). We join
and unescape those, find every {"id":N,"name":...} object and decode it with
json's raw_decode, then keep type == "hackathon" and status == "future".
There's usually only a handful, so we also read each event page for its
"$N Available in prizes" header, falling back to the sum of sponsor
prizeAmount values on /events/<slug>/prizes (event pages sometimes 500).

The RSC format is Next-internal and can change with any deploy, which is why
the extraction looks for objects by shape rather than by position.
"""

import json
import logging
import re

from bs4 import BeautifulSoup

from ..dates import parse_iso
from ..http import PoliteClient
from ..normalize import parse_money, to_usd
from ..types import RawListing, Source

log = logging.getLogger(__name__)

BASE = "https://ethglobal.com"
FORMATS = {"physical": "in_person", "virtual": "online", "async": "online", "hybrid": "hybrid"}
_PUSH = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')
_OBJ = re.compile(r'\{"id":\d+,"name":"')


def rsc_text(html: str) -> str:
    """The React Server Components payload embedded in a Next.js App Router page."""
    return "".join(json.loads(f'"{chunk}"') for chunk in _PUSH.findall(html))


def events_from(text: str) -> list[dict]:
    decoder = json.JSONDecoder()
    found: dict[str, dict] = {}
    for m in _OBJ.finditer(text):
        try:
            obj, _ = decoder.raw_decode(text, m.start())
        except ValueError:
            continue
        if isinstance(obj, dict) and obj.get("slug") and obj.get("type"):
            found.setdefault(obj["slug"], obj)
    return list(found.values())


def prize_from_event_page(html: str) -> float | None:
    """The "$100,000 / Available in prizes" header on an event page."""
    soup = BeautifulSoup(html, "lxml")
    label = soup.find(string=re.compile(r"^\s*Available in prizes\s*$"))
    if not label or not label.parent or not label.parent.parent:
        return None
    amount, currency = parse_money(label.parent.parent.get_text(" ", strip=True))
    return to_usd(amount, currency or "USD")


def prize_from_prizes_page(html: str) -> float | None:
    """Sum of sponsors' prizeAmount on /events/<slug>/prizes (approximate)."""
    amounts = [int(a) for a in re.findall(r'"prizeAmount":(\d+)', rsc_text(html))]
    return float(sum(amounts)) if amounts else None


class ETHGlobalSource(Source):
    name = "ethglobal"
    timeout = 120

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=2.0, timeout=40)

    def fetch(self) -> list[RawListing]:
        events = events_from(rsc_text(self.client.get(f"{BASE}/events").text))
        if not events:
            raise ValueError("ETHGlobal layout changed: no event objects in the page payload")
        upcoming = [e for e in events if e.get("type") == "hackathon" and e.get("status") == "future"]
        return [self._to_listing(e, *self._prize(e["slug"])) for e in upcoming]

    def _prize(self, slug: str) -> tuple[float | None, str | None]:
        try:
            amount = prize_from_event_page(self.client.get(f"{BASE}/events/{slug}").text)
            if amount:
                return amount, "high"
        except Exception as e:  # some event pages answer 500
            log.info("ethglobal event page failed for %s: %s", slug, e)
        try:
            amount = prize_from_prizes_page(self.client.get(f"{BASE}/events/{slug}/prizes").text)
            if amount:
                return amount, "medium"
        except Exception as e:
            log.info("ethglobal prizes page failed for %s: %s", slug, e)
        return None, None

    def _to_listing(self, e: dict, prize_usd: float | None, confidence: str | None) -> RawListing:
        city = e.get("city") or {}
        country = (city.get("country") or {}).get("name") if isinstance(city.get("country"), dict) else None
        fmt = FORMATS.get((e.get("medium") or "").lower())
        location = "Online" if fmt == "online" else ", ".join(p for p in (city.get("name"), country) if p) or None
        kind = "online (async) hackathon" if fmt == "online" else f"in-person hackathon in {location or 'a city to be announced'}"
        description = (
            f"{e['name']} is an ETHGlobal {kind} for building on Ethereum and web3: smart contracts, "
            "DeFi, infrastructure and apps, with sponsor prizes from ecosystem projects. "
            "Hackers apply to attend and teams build over the weekend."
        )
        image = (((e.get("style") or {}).get("global") or {}).get("meta") or {}).get("ogImage")
        return RawListing(
            source="ethglobal",
            source_url=f"{BASE}/events/{e['slug']}",
            title=e["name"],
            organizer="ETHGlobal",
            description=description,
            prize_text=f"${prize_usd:,.0f} in prizes" if prize_usd else None,
            location_text=location,
            dates_text=None,
            raw_payload={k: e.get(k) for k in ("id", "name", "slug", "type", "medium", "startTime", "endTime", "signupDeadline", "status")},
            start_date=parse_iso(e.get("startTime")),
            end_date=parse_iso(e.get("endTime")),
            registration_deadline=parse_iso(e.get("signupDeadline")),
            prize_usd=prize_usd,
            prize_confidence=confidence,
            format=fmt,
            categories=["web3/blockchain"],
            international_ok=True if fmt == "online" else None,
            image_url=image,
            banner_url=image,
        )
