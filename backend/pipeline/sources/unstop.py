"""Unstop (India's largest student competition platform).

The site is a JS shell; its own public JSON API (allowed by robots.txt under
/api/public/) serves the list:

    GET https://unstop.com/api/public/opportunity/search-result
        ?opportunity=hackathons&oppstatus=open&per_page=50&page=N

A Laravel paginator: data.data[] items, data.last_page. ~260 open at a time,
so ~6 requests. Each item already carries the full description (details,
HTML), prizes[] (cash per rank; currency is a FontAwesome name such as
"fa-rupee"), regnRequirements.end_regn_dt (deadline), end_date, region
(online/offline/hybrid) and eligibility. per_page=100 drops items, so stay
at 50. Responses are cached at CloudFront for 5 minutes.

The category also holds coding contests, CTFs and quizzes, so Unstop rows stay
hidden until the AI confirms they're hackathons (app.categories.VETTED_SOURCES).
"""

import json
import logging

from bs4 import BeautifulSoup

from ..dates import parse_iso
from ..http import PoliteClient
from ..normalize import to_usd
from ..types import RawListing, Source

log = logging.getLogger(__name__)

API = "https://unstop.com/api/public/opportunity/search-result"
PER_PAGE = 50
MAX_PAGES = 12
FORMATS = {"online": "online", "offline": "in_person", "hybrid": "hybrid"}
CURRENCIES = {"fa-rupee": "INR", "fa-inr": "INR", "fa-dollar": "USD", "fa-usd": "USD", "fa-euro": "EUR", "fa-eur": "EUR",
              "fa-gbp": "GBP", "fa-pound": "GBP"}
SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}
# Eligibility "sector" values that only students can meet.
STUDENT_SECTORS = {"students", "school", "college"}


class UnstopSource(Source):
    name = "unstop"
    timeout = 120

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.5)

    def fetch(self) -> list[RawListing]:
        out: list[RawListing] = []
        seen: set[int] = set()
        page, last = 1, 1
        while page <= min(last, MAX_PAGES):
            r = self.client.get(API, params={"opportunity": "hackathons", "oppstatus": "open", "per_page": PER_PAGE, "page": page})
            data = r.json().get("data")
            if not isinstance(data, dict) or "data" not in data:
                raise ValueError("Unstop API changed: data.data missing")
            last = int(data.get("last_page") or 1)
            for item in data["data"]:
                if item.get("id") in seen:
                    continue
                seen.add(item.get("id"))
                listing = to_listing(item)
                if listing:
                    out.append(listing)
            page += 1
        return out


def _currency(prize: dict) -> str | None:
    code = (prize.get("currencyCode") or "").upper()
    return code or CURRENCIES.get((prize.get("currency") or "").lower())


def _prizes(item: dict) -> tuple[float | None, str | None, list[dict]]:
    """(total in USD, display text, breakdown) from prizes[] (cash per rank)."""
    rows, total, currency = [], 0.0, None
    for p in item.get("prizes") or []:
        cash = p.get("cash") or 0
        cur = _currency(p)
        currency = currency or cur
        others = (p.get("others") or "").strip()
        if not cash and not others:
            continue
        rank = (p.get("rank") or "").strip()
        rows.append({
            "name": f"{rank} prize" if rank and not rank.lower().endswith("prize") else (rank or "Prize"),
            "amount_text": f"{SYMBOLS.get(cur or '', (cur or '') + ' ')}{cash:,.0f}" if cash else None,
            "amount_usd": to_usd(float(cash), cur) if cash else None,
            "winners": 1,
            "perks": [others] if others else [],
        })
        total += cash
    if not total:
        return None, None, rows
    text = f"{SYMBOLS.get(currency or '', (currency or '') + ' ')}{total:,.0f} in cash prizes"
    return to_usd(total, currency), text, rows


def _student_only(item: dict) -> bool | None:
    raw = (item.get("regnRequirements") or {}).get("eligibility")
    try:
        sectors = {str(s).lower() for s in (json.loads(raw) if isinstance(raw, str) else raw or {}).get("sector") or []}
    except (ValueError, AttributeError):
        sectors = set()
    if not sectors:
        return None
    return sectors <= STUDENT_SECTORS


def to_listing(item: dict) -> RawListing | None:
    title = (item.get("title") or "").strip()
    url = item.get("seo_url") or (f"https://unstop.com/{item['public_url']}" if item.get("public_url") else None)
    if not title or not url:
        return None
    regn = item.get("regnRequirements") or {}
    addr = item.get("address_with_country_logo") or {}
    country = (addr.get("country") or {}).get("name") if isinstance(addr.get("country"), dict) else None
    fmt = FORMATS.get((item.get("region") or "").lower())
    location = "Online" if fmt == "online" else ", ".join(p for p in (addr.get("city"), addr.get("state"), country) if p) or None
    prize_usd, prize_text, prizes = _prizes(item)
    eligible = [f.get("name") for f in item.get("filters") or [] if f.get("type") == "eligible" and f.get("name")]
    details = BeautifulSoup(item.get("details") or "", "lxml").get_text("\n", strip=True)
    extra = []
    if eligible:
        extra.append("Eligible: " + ", ".join(eligible) + ".")
    team = (regn.get("min_team_size"), regn.get("max_team_size"))
    if team[1]:
        extra.append(f"Team size: {team[0] or 1}-{team[1]}.")
    return RawListing(
        source="unstop",
        source_url=url,
        title=title,
        organizer=(item.get("organisation") or {}).get("name"),
        description="\n\n".join(p for p in (" ".join(extra), details) if p) or None,
        prize_text=prize_text,
        location_text=location,
        dates_text=None,
        raw_payload={k: item.get(k) for k in ("id", "title", "region", "end_date", "prizes", "regnRequirements", "filters")},
        end_date=parse_iso(item.get("end_date")),
        registration_deadline=parse_iso(regn.get("end_regn_dt")),
        registrations=item.get("registerCount") if isinstance(item.get("registerCount"), int) else None,
        prize_usd=prize_usd,
        prize_confidence="medium" if prize_usd else None,
        format=fmt,
        student_only=_student_only(item),
        image_url=item.get("logoUrl2") or (item.get("organisation") or {}).get("logoUrl"),
        icon_url=item.get("logoUrl2") or (item.get("organisation") or {}).get("logoUrl"),
        prizes=prizes,
    )
