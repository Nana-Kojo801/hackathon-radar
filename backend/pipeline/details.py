"""Detail step: fetch listings' own pages for the long description and prize breakdown.

Runs after the sources and before AI enrichment, for listings that are new,
changed, or last fetched over a week ago. Only sources that implement
fetch_detail take part (Devpost today; Devfolio already reads each microsite in
fetch()). A failure leaves the row for the next run and never fails this one.
"""

import logging
import time

from psycopg.types.json import Jsonb

from .normalize import clean_text
from .types import Source

log = logging.getLogger(__name__)

MAX_DETAILS_PER_RUN = 80
REFRESH_AFTER = "7 days"


def run_details(conn, sources: dict[str, Source], limit: int = MAX_DETAILS_PER_RUN) -> dict:
    fetchers = {
        name: src for name, src in sources.items()
        if type(src).fetch_detail is not Source.fetch_detail
    }
    stats = {"candidates": 0, "fetched": 0, "failed": 0}
    if not fetchers:
        return stats
    with conn.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, source, source_url FROM hackathons
            WHERE source = ANY(%s) AND NOT is_hidden AND status <> 'ended'
              AND (details_fetched_at IS NULL OR details_fetched_at < now() - interval '{REFRESH_AFTER}')
            ORDER BY details_fetched_at NULLS FIRST, prize_usd DESC NULLS LAST
            LIMIT %s
            """,
            (list(fetchers), limit),
        )
        rows = cur.fetchall()
    conn.commit()
    stats["candidates"] = len(rows)
    t0 = time.monotonic()
    for row in rows:
        try:
            detail = fetchers[row["source"]].fetch_detail(row) or {}
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE hackathons SET
                        description_detail = COALESCE(%s, description_detail),
                        prizes = CASE WHEN jsonb_array_length(%s) > 0 THEN %s ELSE prizes END,
                        details_fetched_at = now()
                    WHERE id = %s
                    """,
                    (clean_text(detail.get("text"), 8000), Jsonb(detail.get("prizes") or []),
                     Jsonb(detail.get("prizes") or []), row["id"]),
                )
            conn.commit()
            stats["fetched"] += 1
        except Exception as e:
            conn.rollback()
            stats["failed"] += 1
            log.info("detail fetch failed for %s: %s", row["source_url"], e)
    log.info("details: candidates=%d fetched=%d failed=%d (%.1fs)",
             stats["candidates"], stats["fetched"], stats["failed"], time.monotonic() - t0)
    return stats
