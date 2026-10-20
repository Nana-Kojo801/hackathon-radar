"""TAIKAI (European hackathon platform).

TAIKAI publishes a GraphQL API (advertised at
https://taikai.network/.well-known/api-catalog); the list pages render from
it. One POST returns every not-closed challenge, 20 per page, including the
long "overview", "prizes" and "rules" tab texts, so no detail requests are
needed. `isClosed` lags behind reality (finished 2024 events still show as
open), so we keep a challenge only if its registration deadline or last
timeline step is still ahead. Format and location aren't fields; the AI reads
them from the text.
"""

import logging
from datetime import datetime, timedelta, timezone

from bs4 import BeautifulSoup

from ..dates import parse_iso
from ..http import PoliteClient
from ..normalize import to_usd
from ..types import RawListing, Source

log = logging.getLogger(__name__)

API = "https://api.taikai.network/api/graphql"
QUERY = """
query($where: ChallengeWhereInput, $page: Int) {
  challengesPageInfo(where: $where) { pageCount recordCount }
  challenges(where: $where, page: $page, orderBy: {order: desc}) {
    id name slug isClosed shortDescription prize prizeDecimals prizeCurrency { name }
    organization { name slug city country }
    industries { title }
    cardImageFile { url } coverImageFile { url }
    allowedParticipants startParticipantRegistrationDate endParticipantRegistrationDate
    steps { name startDate }
    tabs { title content }
  }
}
"""
WHERE = {"isClosed": {"equals": False}, "publishInfo": {"state": {"equals": "ACTIVE"}}}
MAX_PAGES = 5
TABS = ("overview", "prizes", "rules")


def _text(content: str | None) -> str:
    # Tab content is Markdown or HTML depending on the challenge; plain text either way.
    return BeautifulSoup(content or "", "lxml").get_text("\n", strip=True)


class TaikaiSource(Source):
    name = "taikai"
    timeout = 90

    def __init__(self, client: PoliteClient | None = None):
        self.client = client or PoliteClient(delay=1.5, timeout=40)

    def fetch(self) -> list[RawListing]:
        out: list[RawListing] = []
        page, pages = 0, 1
        while page < min(pages, MAX_PAGES):
            r = self.client.post(API, json={"query": QUERY, "variables": {"page": page, "where": WHERE}})
            body = r.json()
            if body.get("errors") or "data" not in body:
                raise ValueError(f"TAIKAI API error: {str(body.get('errors'))[:300]}")
            data = body["data"]
            pages = int((data.get("challengesPageInfo") or {}).get("pageCount") or 1)
            out.extend(filter(None, (to_listing(c) for c in data.get("challenges") or [])))
            page += 1
        return out


def to_listing(c: dict, now: datetime | None = None) -> RawListing | None:
    now = now or datetime.now(timezone.utc)
    org = c.get("organization") or {}
    if not c.get("name") or not c.get("slug") or not org.get("slug"):
        return None
    steps = sorted(d for d in (parse_iso(s.get("startDate")) for s in c.get("steps") or []) if d)
    deadline = parse_iso(c.get("endParticipantRegistrationDate"))
    latest = max([d for d in (steps[-1] if steps else None, deadline) if d], default=None)
    if not latest or latest < now - timedelta(days=1):
        return None  # still flagged open, but its dates are all in the past

    amount = c.get("prize")
    if amount and c.get("prizeDecimals"):
        amount = amount / (10 ** int(c["prizeDecimals"]))
    currency = ((c.get("prizeCurrency") or {}).get("name") or "").upper() or None
    prize_usd = to_usd(float(amount), currency) if amount else None
    prize_text = f"{currency or ''} {amount:,.0f}".strip() if amount else None

    tabs = {(t.get("title") or "").lower(): _text(t.get("content")) for t in c.get("tabs") or []}
    parts = [c.get("shortDescription")]
    parts += [f"{name.title()}:\n{tabs[name]}" for name in TABS if tabs.get(name)]
    if c.get("allowedParticipants") == "SELECTED":
        parts.append("Participation: by application (participants are selected).")
    location = ", ".join(p for p in (org.get("city"), org.get("country")) if p) or None

    image = (c.get("coverImageFile") or {}).get("url") or (c.get("cardImageFile") or {}).get("url")
    return RawListing(
        source="taikai",
        source_url=f"https://taikai.network/{org['slug']}/hackathons/{c['slug']}",
        title=c["name"].strip(),
        organizer=org.get("name"),
        description="\n\n".join(p for p in parts if p) or None,
        prize_text=prize_text,
        location_text=location,
        dates_text=None,
        raw_payload={k: c.get(k) for k in ("id", "name", "slug", "prize", "prizeCurrency", "steps", "allowedParticipants")},
        start_date=steps[0] if steps else None,
        end_date=steps[-1] if steps else None,
        registration_deadline=deadline,
        prize_usd=prize_usd,
        prize_confidence="high" if prize_usd else None,
        categories=[],
        image_url=image,
        banner_url=(c.get("coverImageFile") or {}).get("url"),
    )
