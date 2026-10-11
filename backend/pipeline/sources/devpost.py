"""Devpost: the JSON endpoint the hackathon listing page itself calls.

GET https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=N&per_page=40
-> {"hackathons": [...], "meta": {"total_count": N, "per_page": 40}}
(per_page is capped at 40 server-side.)
"""

import logging
import re

from bs4 import BeautifulSoup

from ..dates import parse_range
from ..http import PoliteClient
from ..normalize import map_themes, parse_money, to_usd
from ..types import RawListing, Source

log = logging.getLogger(__name__)

API = "https://devpost.com/api/hackathons"
PER_PAGE = 40
MAX_PAGES = 15


def _strip_html(s: str | None) -> str:
    return re.sub(r"<[^>]+>", "", s or "").strip()


class DevpostSource(Source):
    name = "devpost"
    timeout = 240

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.0)

    def fetch(self) -> list[RawListing]:
        out: list[RawListing] = []
        seen: set[int] = set()
        for page in range(1, MAX_PAGES + 1):
            r = self.client.get(
                API,
                params=[("status[]", "upcoming"), ("status[]", "open"),
                        ("page", page), ("per_page", PER_PAGE)],
            )
            data = r.json()
            items = data.get("hackathons") or []
            for h in items:
                if h.get("id") in seen:
                    continue
                seen.add(h.get("id"))
                listing = self._to_listing(h)
                if listing:
                    out.append(listing)
            total = (data.get("meta") or {}).get("total_count") or 0
            if not items or len(seen) >= total:
                break
        return out

    def _to_listing(self, h: dict) -> RawListing | None:
        if h.get("invite_only"):
            return None  # can't register anyway
        url = h.get("url")
        if not url or not h.get("title"):
            return None
        prize_text = _strip_html(h.get("prize_amount"))
        amount, currency = parse_money(prize_text)
        cash = (h.get("prizes_counts") or {}).get("cash", 0)
        other = (h.get("prizes_counts") or {}).get("other", 0)
        if prize_text and cash == 0 and other:
            prize_text += " (non-cash prizes)"
        loc = (h.get("displayed_location") or {})
        online = loc.get("icon") == "globe" or (loc.get("location") or "").lower() == "online"
        start, end = parse_range(h.get("submission_period_dates"))
        themes = [t.get("name") for t in h.get("themes") or [] if t.get("name")]
        # Only stable facts go in the description: it feeds the content hash,
        # and volatile bits ("12 days left") would trigger re-enrichment daily.
        desc_bits = ["Themes: " + ", ".join(themes) + "."] if themes else []
        thumb = h.get("thumbnail_url") or ""
        return RawListing(
            source=self.name,
            source_url=url,
            title=h["title"],
            organizer=h.get("organization_name"),
            description=" ".join(desc_bits) or None,
            prize_text=prize_text or None,
            location_text=loc.get("location"),
            dates_text=h.get("submission_period_dates"),
            raw_payload=h,
            start_date=start,
            end_date=end,
            # Devpost registration stays open until the submission deadline.
            registration_deadline=end,
            prize_usd=to_usd(amount, currency),
            prize_confidence="high" if currency == "USD" else "medium",
            format="online" if online else "in_person",
            categories=map_themes(themes),
            image_url=("https:" + thumb) if thumb.startswith("//") else (thumb or None),
        )

    def fetch_detail(self, listing: dict) -> dict | None:
        r = self.client.get(listing["source_url"])
        soup = BeautifulSoup(r.text, "lxml")
        parts = []
        meta = soup.find("meta", attrs={"name": "description"})
        if meta and meta.get("content"):
            parts.append(meta["content"].strip())
        for sel in ("#challenge-information", "#challenge-description"):
            el = soup.select_one(sel)
            if el:
                parts.append(el.get_text(" ", strip=True))
        return {"text": "\n\n".join(parts) or None, "prizes": parse_prizes(soup)}


def parse_prizes(soup: BeautifulSoup) -> list[dict]:
    """Devpost prize cards: title, '<cur><amount> in cash' per winner, 'N winners', perks."""
    out = []
    for card in soup.select("#prizes .prize")[:20]:
        title = card.select_one(".prize-title")
        name = title.get_text(" ", strip=True) if title else ""
        if not name:
            continue
        value = card.select_one(".prize-value")
        value_text = value.get_text(" ", strip=True) if value else ""
        amount_text = None
        if "in cash" in value_text:
            amount_text = re.sub(r"\s+", "", value_text.split("in cash")[0]) or None
        amount, currency = parse_money(amount_text)
        winners_el = card.select_one(".prize-winners")
        m = re.search(r"(\d+)", winners_el.get_text() if winners_el else "")
        perks_el = card.find("p")
        perks = [p.strip(" •") for p in perks_el.get_text("\n", strip=True).split("\n") if p.strip(" •")] if perks_el else []
        out.append({
            "name": name[:120],
            "amount_text": amount_text,
            "amount_usd": to_usd(amount, currency),
            "winners": int(m.group(1)) if m else 1,
            "perks": perks[:4],
        })
    return out
