"""Cross-source dedupe.

Primary key is the canonical source_url. Secondary: the same normalized title
with overlapping dates on a different source is the same hackathon; the
record from the richest source is kept and the other URL goes to alt_urls.
"""

from datetime import datetime, timedelta

from .normalize import Normalized

# Higher = richer, structured data. Used to break ties in richness().
SOURCE_PRIORITY = {"devpost": 3, "devfolio": 3, "mlh": 2, "web": 1}

# Titles shorter than this are too generic to match without dates.
MIN_KEY_LEN_WITHOUT_DATES = 8


def richness(fields: dict) -> int:
    score = SOURCE_PRIORITY.get(fields.get("source") or "", 0) * 2
    for k in ("prize_text", "description", "organizer", "location_text", "start_date",
              "end_date", "registration_deadline", "prize_usd"):
        v = fields.get(k)
        if v not in (None, "", []):
            score += 1
    return score


def dates_overlap(
    a_start: datetime | None, a_end: datetime | None,
    b_start: datetime | None, b_end: datetime | None,
    slack: timedelta = timedelta(days=2),
) -> bool | None:
    """True/False when both sides have dates, None when either side has none."""
    a_start, a_end = a_start or a_end, a_end or a_start
    b_start, b_end = b_start or b_end, b_end or b_start
    if not (a_start and b_start):
        return None
    return a_start - slack <= b_end and b_start - slack <= a_end


def find_by_url(cur, url: str) -> dict | None:
    cur.execute(
        "SELECT * FROM hackathons WHERE source_url = %s OR %s = ANY(alt_urls) LIMIT 1",
        (url, url),
    )
    return cur.fetchone()


def find_by_title(cur, n: Normalized) -> dict | None:
    if not n.title_key:
        return None
    cur.execute(
        "SELECT * FROM hackathons WHERE title_key = %s AND source <> %s"
        " ORDER BY last_seen_at DESC LIMIT 5",
        (n.title_key, n.raw.source),
    )
    r = n.raw
    for row in cur.fetchall():
        overlap = dates_overlap(r.start_date, r.end_date, row["start_date"], row["end_date"])
        if overlap is True:
            return row
        if overlap is None and len(n.title_key) >= MIN_KEY_LEN_WITHOUT_DATES:
            return row
    return None
