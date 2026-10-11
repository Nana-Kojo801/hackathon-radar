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
    """Same normalized title on another source (web finds also match each other).
    With overlapping dates, one title containing the other also counts:
    'HackerNoon Decentralize AI Hackathon' == 'Decentralize AI Hackathon'."""
    key = n.title_key
    if not key:
        return None
    r = n.raw
    # Platforms list each event once, so two URLs there are two events.
    # Web finds of the same event often come from different pages.
    other_source = "(source <> %(source)s OR %(source)s = 'web')"
    cur.execute(
        f"SELECT * FROM hackathons WHERE title_key = %(key)s AND {other_source}"
        " ORDER BY last_seen_at DESC LIMIT 5",
        {"key": key, "source": r.source},
    )
    for row in cur.fetchall():
        overlap = dates_overlap(r.start_date, r.end_date, row["start_date"], row["end_date"])
        if overlap is True:
            return row
        if overlap is None and len(key) >= MIN_KEY_LEN_WITHOUT_DATES:
            return row

    if len(key) < MIN_KEY_LEN_WITHOUT_DATES or not (r.start_date or r.end_date):
        return None
    cur.execute(
        f"SELECT * FROM hackathons WHERE {other_source} AND title_key <> %(key)s"
        " AND length(title_key) >= %(min)s"
        " AND (strpos(title_key, %(key)s) > 0 OR strpos(%(key)s, title_key) > 0)"
        " ORDER BY last_seen_at DESC LIMIT 5",
        {"key": key, "source": r.source, "min": MIN_KEY_LEN_WITHOUT_DATES},
    )
    for row in cur.fetchall():
        if dates_overlap(r.start_date, r.end_date, row["start_date"], row["end_date"]) is True:
            return row
    return None
