"""Devfolio.

The listing page https://devfolio.co/hackathons is Next.js; __NEXT_DATA__ holds
a react-query cache with open_hackathons / upcoming_hackathons (slug, name,
dates, is_online, themes, settings.reg_ends_at). Prizes and descriptions are
only on each hackathon's microsite https://<slug>.devfolio.co/, whose
__NEXT_DATA__ pageProps carry hackathon{desc, tagline, location, ...},
aggregatePrizeValue and aggregatePrizeCurrency. There are only ~20 open at a
time, so we fetch every microsite.
"""

import json
import logging

from bs4 import BeautifulSoup

from ..dates import parse_iso
from ..http import PoliteClient
from ..normalize import map_themes, to_usd
from ..types import RawListing, Source

log = logging.getLogger(__name__)

LISTING = "https://devfolio.co/hackathons"


def _next_data(html: str) -> dict:
    tag = BeautifulSoup(html, "lxml").find("script", id="__NEXT_DATA__")
    if not tag or not tag.string:
        raise ValueError("no __NEXT_DATA__ on page")
    return json.loads(tag.string)


class DevfolioSource(Source):
    name = "devfolio"
    timeout = 180

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.0)

    def fetch(self) -> list[RawListing]:
        data = _next_data(self.client.get(LISTING).text)
        queries = data["props"]["pageProps"]["dehydratedState"]["queries"]
        lists = next((q["state"]["data"] for q in queries
                      if isinstance(q.get("state", {}).get("data"), dict)
                      and "open_hackathons" in q["state"]["data"]), None)
        if lists is None:
            raise ValueError("Devfolio layout changed: open_hackathons not found")
        summaries = {}
        for key in ("featured_hackathons", "open_hackathons", "upcoming_hackathons"):
            for h in lists.get(key) or []:
                if h.get("slug") and (h.get("type") or "HACKATHON") == "HACKATHON":
                    summaries.setdefault(h["slug"], h)

        out: list[RawListing] = []
        for slug, summary in summaries.items():
            detail: dict = {}
            try:
                detail = _next_data(self.client.get(f"https://{slug}.devfolio.co/").text)["props"]["pageProps"]
            except Exception as e:  # fall back to the listing summary
                log.info("devfolio detail failed for %s: %s", slug, e)
            out.append(self._to_listing(slug, summary, detail))
        return out

    def _to_listing(self, slug: str, s: dict, d: dict) -> RawListing:
        h = d.get("hackathon") or {}
        settings = {**(s.get("settings") or {}), **(h.get("settings") or {})}
        name = h.get("name") or s.get("name")
        amount = d.get("aggregatePrizeValue")
        currency = (d.get("aggregatePrizeCurrency") or "").upper() or None
        prize_text = f"{currency or ''} {amount:,.0f}".strip() if amount else None
        themes = [t.get("theme", {}).get("name") for t in (s.get("themes") or []) if t.get("theme")]
        if settings.get("is_hybrid"):
            fmt = "hybrid"
        else:
            fmt = "online" if (h.get("is_online", s.get("is_online"))) else "in_person"
        location = "Online" if fmt == "online" else (
            h.get("location") or ", ".join(p for p in (h.get("city"), h.get("country")) if p) or None
        )
        desc_parts = [h.get("tagline"), h.get("desc")]
        if themes:
            desc_parts.append("Themes: " + ", ".join(themes))
        start, end = parse_iso(h.get("starts_at") or s.get("starts_at")), parse_iso(h.get("ends_at") or s.get("ends_at"))
        return RawListing(
            source=self.name,
            source_url=f"https://{slug}.devfolio.co/",
            title=name,
            organizer=None,
            description="\n\n".join(p for p in desc_parts if p) or None,
            prize_text=prize_text,
            location_text=location,
            dates_text=f"{start:%b %d, %Y} - {end:%b %d, %Y}" if start and end else None,
            raw_payload={"summary": s, "prize": {"value": amount, "currency": currency},
                         "location": h.get("location"), "country": h.get("country")},
            start_date=start,
            end_date=end,
            registration_deadline=parse_iso(settings.get("reg_ends_at")),
            prize_usd=to_usd(amount, currency) if amount else None,
            prize_confidence="high" if currency in ("USD", "USDC", "USDT") else "medium",
            format=fmt,
            categories=map_themes(themes),
            image_url=h.get("cover_img") or settings.get("logo"),
            icon_url=settings.get("logo"),
            banner_url=h.get("cover_img"),
            prizes=_prizes(d.get("prizeDetails") or []),
        )


def _prizes(details: list[dict]) -> list[dict]:
    """Devfolio prizeDetails: sponsor/track groups, each with prizes {name, amount, currency, quantity}."""
    out = []
    for group in details:
        for p in group.get("prizes") or []:
            amount = p.get("amount") or 0
            currency = (p.get("currency") or "USD").upper()
            name = p.get("name") or group.get("name") or "Prize"
            if group.get("name") and group["name"].lower() not in name.lower():
                name = f"{group['name']}: {name}"
            out.append({
                "name": name[:120],
                "amount_text": f"{currency} {amount:,.0f}" if amount else None,
                "amount_usd": to_usd(amount, currency) if amount else None,
                "winners": int(p.get("quantity") or 1),
                "perks": [p["desc"][:160]] if p.get("desc") else [],
            })
    return out[:20]
