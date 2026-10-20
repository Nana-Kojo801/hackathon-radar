import logging
import secrets
import threading
from typing import Annotated, Literal
from uuid import UUID

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config, db, personal, push, refresh, stats
from .categories import CATEGORIES, STATUSES, VISIBLE

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("api")

app = FastAPI(title="Hackathon Radar API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(personal.router)
app.include_router(push.router)
app.include_router(push.public_router)
app.include_router(stats.router)
app.include_router(refresh.router)
app.include_router(stats.public_router)

# image_url is the one image for things that want just one: the listing's own,
# or (when it has none, or a platform placeholder) the share image the artwork
# step found. icon_url is square (the platform's logo or thumbnail), banner_url
# wide (the platform's cover or header photo, else that share image), logo_url
# the organizer's logo, drawn on a plain tile.
LIST_COLUMNS = """
    id, source, source_url, alt_urls, title, organizer, summary,
    CASE WHEN image_url IS NULL OR image_url ~* 'placeholder|default[-_]?thumbnail'
         THEN COALESCE(page_image_url, image_url) ELSE image_url END AS image_url, logo_url,
    icon_url, COALESCE(banner_url, page_image_url) AS banner_url,
    prize_text, prize_usd::float AS prize_usd, prize_confidence, prize_notes,
    format, location_text, categories, international_ok, student_only,
    start_date, end_date, registration_deadline, status, relevance_score,
    first_seen_at, last_seen_at, (enriched_at IS NOT NULL) AS enriched
"""


SORTS = {
    "prize": "prize_usd DESC NULLS LAST, relevance_score DESC NULLS LAST, first_seen_at DESC",
    "deadline": "COALESCE(registration_deadline, start_date, end_date) ASC NULLS LAST, prize_usd DESC NULLS LAST",
    "new": "first_seen_at DESC, prize_usd DESC NULLS LAST",
    "relevance": "relevance_score DESC NULLS LAST, prize_usd DESC NULLS LAST",
}

_refresh_lock = threading.Lock()


@app.on_event("startup")
def _startup() -> None:
    if config.DATABASE_URL:
        try:
            applied = db.migrate()
            if applied:
                log.info("applied migrations: %s", applied)
        except Exception:
            log.exception("migration failed on startup")


@app.get("/health")
def health() -> dict:
    ok = True
    try:
        with db.cursor() as cur:
            cur.execute("SELECT 1")
    except Exception as e:  # report, don't crash: Render pings this
        log.warning("health db check failed: %s", e)
        ok = False
    return {"ok": True, "db": ok}


def _split(values: list[str] | None) -> list[str]:
    out: list[str] = []
    for v in values or []:
        out.extend(p.strip() for p in v.split(",") if p.strip())
    return out


@app.get("/hackathons")
def list_hackathons(
    sort: Literal["prize", "deadline", "new", "relevance"] = "prize",
    category: Annotated[list[str] | None, Query()] = None,
    format: Literal["online", "in_person", "hybrid", "unknown"] | None = None,
    min_prize: float | None = None,
    international_ok: bool | None = None,
    student_only: bool | None = None,
    status: Annotated[list[str] | None, Query()] = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    where = [VISIBLE]
    params: dict = {}

    statuses = [s for s in _split(status) if s in STATUSES] or ["open", "upcoming"]
    where.append("status = ANY(%(statuses)s)")
    params["statuses"] = statuses

    cats = [c for c in _split(category) if c in CATEGORIES]
    if cats:
        where.append("categories && %(cats)s::text[]")
        params["cats"] = cats
    if format:
        # A hybrid event is also attendable online / in person.
        if format in ("online", "in_person"):
            where.append("format IN (%(format)s, 'hybrid')")
        else:
            where.append("format = %(format)s")
        params["format"] = format
    if min_prize is not None and min_prize > 0:
        where.append("prize_usd >= %(min_prize)s")
        params["min_prize"] = min_prize
    if international_ok is True:
        # "International only" hides events known to be restricted; unknown stays visible.
        where.append("international_ok IS NOT FALSE")
    elif international_ok is False:
        where.append("international_ok IS FALSE")
    if student_only is True:
        where.append("student_only IS TRUE")
    elif student_only is False:
        where.append("student_only IS NOT TRUE")
    if q and q.strip():
        where.append(
            "(title ILIKE %(q)s OR organizer ILIKE %(q)s OR summary ILIKE %(q)s"
            " OR location_text ILIKE %(q)s OR array_to_string(categories, ' ') ILIKE %(q)s)"
        )
        params["q"] = f"%{q.strip()}%"

    where_sql = " AND ".join(where)
    params.update(limit=limit, offset=offset)
    with db.cursor() as cur:
        cur.execute(f"SELECT count(*) AS n FROM hackathons WHERE {where_sql}", params)
        total = cur.fetchone()["n"]
        cur.execute(
            f"SELECT {LIST_COLUMNS} FROM hackathons WHERE {where_sql}"
            f" ORDER BY {SORTS[sort]} LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
        items = cur.fetchall()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.get("/hackathons/{hackathon_id}")
def get_hackathon(hackathon_id: UUID) -> dict:
    with db.cursor() as cur:
        cur.execute(
            f"SELECT {LIST_COLUMNS}, COALESCE(description_detail, description_raw) AS description,"
            " about_md AS about, about_prizes, prizes, dates_text, enriched_at, enrichment_model"
            " FROM hackathons WHERE id = %s",
            (hackathon_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "not found")
    return row


@app.get("/meta")
def meta() -> dict:
    with db.cursor() as cur:
        cur.execute(
            "SELECT c AS category, count(*)::int AS count FROM hackathons, unnest(categories) c"
            f" WHERE {VISIBLE} AND status IN ('open', 'upcoming') GROUP BY c"
        )
        counts = {r["category"]: r["count"] for r in cur.fetchall()}
        cur.execute(
            f"SELECT count(*)::int AS n FROM hackathons WHERE {VISIBLE} AND status IN ('open', 'upcoming')"
        )
        active = cur.fetchone()["n"]
        cur.execute(
            "SELECT max(finished_at) AS last, min(started_at) AS first FROM source_runs"
            " WHERE source = 'pipeline'"
        )
        runs = cur.fetchone()
        cur.execute(
            "SELECT DISTINCT ON (source) source, started_at, finished_at, fetched, new, errors,"
            " error_text, tokens_used FROM source_runs"
            # A source that hasn't run in two days was removed (runs are every 6 hours).
            " WHERE started_at > now() - interval '2 days'"
            " ORDER BY source, started_at DESC"
        )
        sources = cur.fetchall()
    for s in sources:
        s["healthy"] = s["errors"] == 0 and s["finished_at"] is not None
    return {
        "categories": [{"category": c, "count": counts.get(c, 0)} for c in CATEGORIES],
        "active_count": active,
        "last_refresh": runs["last"],
        # Everything is "first seen" on the first run; the UI skips NEW badges for those.
        "first_run_at": runs["first"],
        "sources": sources,
    }


def _run_refresh() -> None:
    from pipeline.run import run_pipeline

    try:
        run_pipeline()
    except Exception:
        log.exception("manual refresh failed")
    finally:
        _refresh_lock.release()


@app.post("/admin/refresh", status_code=202)
def admin_refresh(
    background: BackgroundTasks,
    x_admin_token: Annotated[str | None, Header()] = None,
) -> dict:
    if not config.ADMIN_TOKEN or not x_admin_token or not secrets.compare_digest(
        x_admin_token, config.ADMIN_TOKEN
    ):
        raise HTTPException(401, "invalid admin token")
    if not _refresh_lock.acquire(blocking=False):
        return {"started": False, "reason": "a refresh is already running"}
    background.add_task(_run_refresh)
    return {"started": True}
