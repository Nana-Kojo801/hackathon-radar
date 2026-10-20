from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class RawListing:
    """What every source adapter returns.

    The first block is the interface from the spec. The optional block holds
    structured facts a source already knows (exact dates, a prize amount,
    online/in-person), so we don't pay the AI to guess them.
    """

    source: str
    source_url: str
    title: str
    organizer: str | None = None
    description: str | None = None
    prize_text: str | None = None
    location_text: str | None = None
    dates_text: str | None = None
    raw_payload: dict[str, Any] = field(default_factory=dict)

    # Structured hints (all optional)
    start_date: datetime | None = None
    end_date: datetime | None = None
    registration_deadline: datetime | None = None
    prize_usd: float | None = None
    prize_confidence: str | None = None
    format: str | None = None  # online / in_person / hybrid
    categories: list[str] = field(default_factory=list)
    international_ok: bool | None = None
    student_only: bool | None = None
    image_url: str | None = None
    # Square artwork (a logo or thumbnail) and wide artwork (a cover or header photo), when the
    # source tells them apart; image_url stays the one image for anything that wants just one.
    icon_url: str | None = None
    banner_url: str | None = None
    # Prize breakdown: [{"name", "amount_text", "amount_usd" (per winner), "winners", "perks"}]
    prizes: list[dict] = field(default_factory=list)


class Source:
    name: str = "base"
    # Seconds the whole fetch() may take before the run gives up on it.
    timeout: float = 180

    def fetch(self) -> list[RawListing]:
        raise NotImplementedError

    def fetch_detail(self, listing: dict) -> dict | None:
        """Optional: fetch a listing's own page for what the list doesn't carry.

        Returns {"text": long description, "prizes": [...]}. The pipeline's
        detail step calls it for new or changed listings (and weekly after),
        before AI enrichment.
        """
        return None
