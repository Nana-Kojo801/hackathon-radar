"""Numbers for the stats page.

- GET /stats: the market (what's out there) and how the radar itself is doing.
  Public, and written into the snapshot like the other public data.
- GET /me/stats: you. Your funnel from listed to won, what you go for, your
  habits, and how you use the app. Needs the personal key.
- POST /me/events: the app logs opens (and where they came from), hackathons
  opened, and stage changes are logged by PUT /me/hackathons (personal.py).

Activity charts start the day the log shipped; stage history from before that
was backfilled from when each hackathon was first tracked (migration 009).
"""

from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import db
from .categories import CATEGORIES, VISIBLE
from .personal import _settings, _valid_tz, require_key

public_router = APIRouter()
router = APIRouter(prefix="/me", dependencies=[Depends(require_key)])

WEEKS = 12
OPEN = "status IN ('open', 'upcoming')"

PRIZE_BUCKETS = [(0, 1_000, "<$1K"), (1_000, 5_000, "$1–5K"), (5_000, 25_000, "$5–25K"),
                 (25_000, 100_000, "$25–100K"), (100_000, None, "$100K+")]

ENTERED = ("registered", "submitted", "won", "not_placed")
SAVED = ("saved",) + ENTERED
SUBMITTED = ("submitted", "won", "not_placed")


def _weeks(now: datetime, tz: ZoneInfo, n: int = WEEKS) -> list[datetime]:
    """Monday 00:00 (local) of the last n weeks, oldest first."""
    local = now.astimezone(tz)
    monday = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return [monday - timedelta(weeks=i) for i in range(n - 1, -1, -1)]


# ---------------------------------------------------------------- market


@public_router.get("/stats")
def market_stats() -> dict:
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        cur.execute(
            f"SELECT count(*)::int AS open, COALESCE(sum(prize_usd), 0)::float AS pool,"
            f" count(*) FILTER (WHERE first_seen_at > now() - interval '7 days')::int AS new_7d,"
            f" count(DISTINCT source)::int AS platforms,"
            f" percentile_cont(0.5) WITHIN GROUP (ORDER BY prize_usd)::float AS median_prize"
            f" FROM hackathons WHERE {VISIBLE} AND {OPEN}"
        )
        totals = cur.fetchone()

        # The first run finds the whole backlog at once, so weeks before it say nothing.
        cur.execute("SELECT min(finished_at) AS first FROM source_runs WHERE source = 'pipeline'")
        first_run = cur.fetchone()["first"]
        cur.execute(
            f"SELECT date_trunc('week', first_seen_at AT TIME ZONE 'UTC') AS week, count(*)::int AS n"
            f" FROM hackathons WHERE {VISIBLE} AND first_seen_at > now() - interval '{WEEKS} weeks'"
            "   AND first_seen_at > %s GROUP BY 1",
            (first_run + timedelta(hours=1) if first_run else now,),
        )
        per_week = {r["week"].date(): r["n"] for r in cur.fetchall()}
        weeks = _weeks(now, ZoneInfo("UTC"))
        backlog_week = first_run.date() - timedelta(days=first_run.weekday()) if first_run else None
        new_per_week = [
            {"week": w.date().isoformat(),
             "count": None if backlog_week is None or w.date() < backlog_week else per_week.get(w.date(), 0)}
            for w in weeks
        ]

        cur.execute(
            f"SELECT source, count(*)::int AS n FROM hackathons WHERE {VISIBLE} AND {OPEN}"
            " GROUP BY source ORDER BY n DESC"
        )
        by_source = [{"source": r["source"], "count": r["n"]} for r in cur.fetchall()]

        cur.execute(f"SELECT prize_usd::float AS p FROM hackathons WHERE {VISIBLE} AND {OPEN}")
        prizes = [r["p"] for r in cur.fetchall()]
        buckets = [{"label": label, "count": sum(1 for p in prizes if p is not None and p >= lo and (hi is None or p < hi))}
                   for lo, hi, label in PRIZE_BUCKETS]
        buckets.append({"label": "Not stated", "count": sum(1 for p in prizes if p is None)})

        cur.execute(
            "SELECT (COALESCE(registration_deadline, end_date) AT TIME ZONE 'UTC')::date AS day, count(*)::int AS n"
            f" FROM hackathons WHERE {VISIBLE} AND {OPEN}"
            "   AND COALESCE(registration_deadline, end_date) BETWEEN now() AND now() + interval '56 days'"
            " GROUP BY 1"
        )
        closing = {r["day"].isoformat(): r["n"] for r in cur.fetchall()}

        cur.execute(
            "SELECT c AS category, count(*)::int AS n FROM hackathons, unnest(categories) c"
            f" WHERE {VISIBLE} AND {OPEN} GROUP BY c ORDER BY n DESC"
        )
        categories = [{"category": r["category"], "count": r["n"]} for r in cur.fetchall()]

        cur.execute(
            "SELECT (started_at AT TIME ZONE 'UTC')::date AS day, sum(fetched)::int AS fetched,"
            " sum(new)::int AS new, sum(tokens_used)::int AS tokens, count(*)::int AS runs,"
            " sum(errors)::int AS errors"
            " FROM source_runs WHERE source = 'pipeline' AND started_at > now() - interval '14 days'"
            " GROUP BY 1 ORDER BY 1"
        )
        runs = [{**r, "day": r["day"].isoformat()} for r in cur.fetchall()]

    return {
        "generated_at": now,
        "totals": totals,
        "new_per_week": new_per_week,
        "by_source": by_source,
        "prize_buckets": buckets,
        "closing": closing,
        "categories": categories,
        "runs": runs,
    }


# ---------------------------------------------------------------- you


class Event(BaseModel):
    kind: Literal["open", "view"]
    hackathon_id: UUID | None = None
    source: Literal["email", "push", "home_screen", "browser"] | None = None
    # When it happened on the device; events queue up while offline.
    at: datetime | None = None


class EventsBody(BaseModel):
    events: list[Event] = Field(max_length=200)


@router.post("/events")
def log_events(body: EventsBody) -> dict:
    now = datetime.now(timezone.utc)
    rows = []
    for e in body.events:
        at = e.at if e.at and e.at.tzinfo else now
        at = min(max(at, now - timedelta(days=30)), now)
        rows.append((e.kind, e.hackathon_id if e.kind == "view" else None, e.source if e.kind == "open" else None, at))
    with db.cursor() as cur:
        if rows:
            # Views of hackathons that have since been deleted are dropped.
            cur.executemany(
                "INSERT INTO my_events (kind, hackathon_id, detail, at)"
                " SELECT %s, %s::uuid, %s, %s WHERE %s::uuid IS NULL OR EXISTS (SELECT 1 FROM hackathons WHERE id = %s::uuid)",
                [(k, h, d, a, h, h) for k, h, d, a in rows],
            )
    return {"logged": len(rows)}


def _streaks(days: set, today) -> tuple[int, int]:
    """Current streak (counting today or yesterday) and the longest, in days."""
    current = 0
    d = today if today in days else today - timedelta(days=1)
    while d in days:
        current += 1
        d -= timedelta(days=1)
    longest = run = 0
    prev = None
    for d in sorted(days):
        run = run + 1 if prev and d - prev == timedelta(days=1) else 1
        longest = max(longest, run)
        prev = d
    return current, longest


@router.get("/stats")
def my_stats() -> dict:
    now = datetime.now(timezone.utc)
    with db.cursor() as cur:
        tz_name = _settings(cur)["timezone"]
        tz = ZoneInfo(tz_name if _valid_tz(tz_name) else "UTC")

        cur.execute("SELECT min(at) AS since FROM my_events")
        since = cur.fetchone()["since"] or now

        # Everything listed while you've been using the app, plus anything you tracked. Listings
        # are re-seen every 6 hours, so a day's slack covers the run before your first activity.
        listed = (f"({VISIBLE} AND last_seen_at >= %(since)s - interval '1 day')"
                  " OR id IN (SELECT hackathon_id FROM my_hackathons)")
        cur.execute(
            "SELECT h.id, h.title, h.prize_usd::float AS prize_usd, h.categories, h.format,"
            " h.registration_deadline, h.start_date, m.status"
            f" FROM hackathons h LEFT JOIN my_hackathons m ON m.hackathon_id = h.id WHERE {listed}",
            {"since": since},
        )
        rows = cur.fetchall()

        cur.execute("SELECT kind, hackathon_id, detail, at FROM my_events ORDER BY at")
        events = cur.fetchall()

    mine = [r for r in rows if r["status"] in SAVED]
    entered = [r for r in rows if r["status"] in ENTERED]
    views = [e for e in events if e["kind"] == "view"]
    opens = [e for e in events if e["kind"] == "open"]
    stages = [e for e in events if e["kind"] == "stage"]
    count = lambda states: sum(1 for r in rows if r["status"] in states)  # noqa: E731

    funnel = {
        "listed": len(rows),
        "opened": len({e["hackathon_id"] for e in views}),
        "opened_since": views[0]["at"] if views else None,
        "saved": count(SAVED),
        "registered": count(ENTERED),
        "submitted": count(SUBMITTED),
        "won": count(("won",)),
        "not_placed": count(("not_placed",)),
        "hidden": count(("hidden",)),
    }

    def shares(key):
        mine_n: dict = {}
        market_n: dict = {}
        for r in rows:
            values = r[key] if key == "categories" else [r[key] or "unknown"]
            for v in values or []:
                market_n[v] = market_n.get(v, 0) + 1
                if r["status"] in SAVED:
                    mine_n[v] = mine_n.get(v, 0) + 1
        keys = sorted(set(market_n) | set(mine_n), key=lambda k: (-(mine_n.get(k, 0)), -market_n.get(k, 0)))
        if key == "categories":
            keys = [k for k in keys if k in CATEGORIES]
        return [{"key": k, "mine": mine_n.get(k, 0), "market": market_n.get(k, 0)} for k in keys]

    market_prizes = [r["prize_usd"] for r in rows if r["prize_usd"]]
    entered_prizes = [r["prize_usd"] for r in entered if r["prize_usd"]]
    biggest = max(entered, key=lambda r: r["prize_usd"] or 0, default=None)
    prizes = {
        "entered_total": sum(entered_prizes),
        "entered_avg": sum(entered_prizes) / len(entered_prizes) if entered_prizes else None,
        "market_avg": sum(market_prizes) / len(market_prizes) if market_prizes else None,
        "saved_avg": (lambda v: sum(v) / len(v) if v else None)([r["prize_usd"] for r in mine if r["prize_usd"]]),
        "biggest": {"id": biggest["id"], "title": biggest["title"], "prize_usd": biggest["prize_usd"]}
        if biggest and biggest["prize_usd"] else None,
    }

    # Habits, from stage history: the first time each hackathon reached saved / registered.
    first_saved: dict = {}
    first_registered: dict = {}
    for e in stages:
        if e["detail"] in SAVED:
            first_saved.setdefault(e["hackathon_id"], e["at"])
        if e["detail"] in ENTERED:
            first_registered.setdefault(e["hackathon_id"], e["at"])
    by_id = {r["id"]: r for r in rows}
    gaps = [(first_registered[h] - first_saved[h]).total_seconds() / 86400
            for h in first_registered if h in first_saved and first_registered[h] > first_saved[h]]
    leads = []
    for h, at in first_registered.items():
        r = by_id.get(h)
        deadline = r and (r["registration_deadline"] or r["start_date"])
        if deadline and deadline > at:
            leads.append((deadline - at).total_seconds() / 86400)
    habits = {
        "save_to_register_days": median(gaps) if gaps else None,
        "lead_days": median(leads) if leads else None,
        "last_minute_pct": sum(1 for d in leads if d <= 2) / len(leads) if leads else None,
        "registrations": len(leads),
    }

    # Activity, in the phone's timezone.
    weeks = _weeks(now, tz)
    per_week = [0] * WEEKS
    heat = [[0] * 8 for _ in range(7)]  # weekday x 3-hour block, last 90 days
    sources = {"email": 0, "push": 0, "home_screen": 0, "browser": 0}
    days = set()
    for e in opens:
        local = e["at"].astimezone(tz)
        days.add(local.date())
        for i in range(WEEKS - 1, -1, -1):
            if local >= weeks[i]:
                per_week[i] += 1
                break
        if e["at"] > now - timedelta(days=90):
            heat[local.weekday()][local.hour // 3] += 1
        sources[e["detail"] if e["detail"] in sources else "browser"] += 1
    today = now.astimezone(tz).date()
    streak, longest = _streaks(days, today)
    activity = {
        "since": opens[0]["at"] if opens else None,
        "opens": len(opens),
        "views": len(views),
        "per_week": [{"week": w.date().isoformat(), "count": per_week[i] if not opens or w + timedelta(weeks=1) > opens[0]["at"] else None}
                     for i, w in enumerate(weeks)],
        "heatmap": heat,
        "sources": sources,
        "streak": streak,
        "longest_streak": longest,
        "active_days_30": sum(1 for d in days if d > today - timedelta(days=30)),
    }

    # Saved and registered per month, last 6 months.
    months = []
    first_of_month = today.replace(day=1)
    for i in range(5, -1, -1):
        y, m = divmod(first_of_month.year * 12 + first_of_month.month - 1 - i, 12)
        months.append((y, m + 1))
    month_key = lambda at: (at.astimezone(tz).year, at.astimezone(tz).month)  # noqa: E731
    monthly = [{"month": f"{y}-{m:02d}",
                "saved": sum(1 for at in first_saved.values() if month_key(at) == (y, m)),
                "registered": sum(1 for at in first_registered.values() if month_key(at) == (y, m))}
               for y, m in months]

    week_ago = now - timedelta(days=7)
    recap = {
        "saved": sum(1 for at in first_saved.values() if at > week_ago),
        "registered": sum(1 for at in first_registered.values() if at > week_ago),
        "opens": sum(1 for e in opens if e["at"] > week_ago),
        "views": sum(1 for e in views if e["at"] > week_ago),
    }

    return {
        "since": since,
        "timezone": tz.key,
        "funnel": funnel,
        "categories": shares("categories"),
        "formats": shares("format"),
        "prizes": prizes,
        "habits": habits,
        "activity": activity,
        "monthly": monthly,
        "recap": recap,
    }
