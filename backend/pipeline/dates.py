import re
from datetime import datetime, timezone

MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
    )
}

_PART = re.compile(r"^\s*(?:([A-Za-z]{3})[a-z]*\.?\s+)?(\d{1,2})(?:,\s*(\d{4}))?\s*$")


def parse_iso(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_range(text: str | None) -> tuple[datetime | None, datetime | None]:
    """Parse Devpost-style ranges.

    'Aug 31 - Oct 23, 2026', 'Oct 05 - 23, 2026', 'Dec 20, 2026',
    'Dec 01, 2026 - Jan 15, 2027'. End dates are set to the end of that day (UTC).
    """
    if not text:
        return None, None
    pieces = [p for p in re.split(r"\s+[-–]\s+", text.strip()) if p]
    if not 1 <= len(pieces) <= 2:
        return None, None
    parsed = []
    for p in pieces:
        m = _PART.match(p)
        if not m:
            return None, None
        mon, day, year = m.groups()
        parsed.append([MONTHS.get(mon.lower()[:3]) if mon else None, int(day), int(year) if year else None])
    end = parsed[-1]
    start = parsed[0]
    if end[0] is None or end[2] is None:
        if start[0] is None:
            return None, None
        end[0] = end[0] or start[0]
        end[2] = end[2] or start[2]
    if end[2] is None:
        return None, None
    start[0] = start[0] or end[0]
    if start[2] is None:
        # 'Dec 20 - Jan 05, 2027' crosses a year boundary
        start[2] = end[2] - 1 if start[0] > end[0] else end[2]
    try:
        s = datetime(start[2], start[0], start[1], tzinfo=timezone.utc)
        e = datetime(end[2], end[0], end[1], 23, 59, 59, tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None, None
    return s, e
