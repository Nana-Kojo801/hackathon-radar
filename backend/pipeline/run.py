"""Pipeline entry point: sources -> normalize -> dedupe -> upsert -> AI enrich -> AI polish -> artwork.

Each step is recorded on the run's source_runs row (stage, progress) as it goes,
for the live view behind "Refresh now" in Settings.

    python -m pipeline.run                    # full run
    python -m pipeline.run --sources devpost  # only some sources
    python -m pipeline.run --no-enrich        # skip the AI step
"""

import argparse
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from psycopg.types.json import Jsonb

from app import db

from . import artwork, details, enrich, polish, store
from .normalize import normalize
from .sources import all_sources
from .types import Source

log = logging.getLogger("pipeline")

LOCK_ID = 4_242_001  # pg advisory lock so cron and manual refreshes never overlap


def _start_run(conn, source: str) -> int:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO source_runs (source) VALUES (%s) RETURNING id", (source,))
        run_id = cur.fetchone()["id"]
    conn.commit()
    return run_id


def _finish_run(conn, run_id: int, **stats) -> None:
    cols = ", ".join(f"{k} = %({k})s" for k in stats)
    with conn.cursor() as cur:
        cur.execute(
            f"UPDATE source_runs SET finished_at = now(){', ' + cols if cols else ''}"
            " WHERE id = %(id)s",
            {**stats, "id": run_id},
        )
    conn.commit()


def _stage(conn, run_id: int, stage: str, step: str | None = None, stats: dict | None = None) -> None:
    """Record the step the run is on (and the last step's numbers) for the progress view in Settings."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE source_runs SET stage = %s, progress = progress || %s WHERE id = %s",
                (stage, Jsonb({step: stats} if step else {}), run_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        log.exception("could not record progress")


def run_source(conn, source: Source) -> dict:
    """Fetch and store one source. Never raises."""
    run_id = _start_run(conn, source.name)
    stats = {"fetched": 0, "new": 0, "errors": 0, "error_text": None, "tokens_used": 0}
    t0 = time.monotonic()
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        listings = pool.submit(source.fetch).result(timeout=source.timeout)
        stats["fetched"] = len(listings)
        for raw in listings:
            try:
                with conn.cursor() as cur:
                    result = store.upsert(cur, normalize(raw))
                conn.commit()
                if result == "new":
                    stats["new"] += 1
            except Exception as e:
                conn.rollback()
                stats["errors"] += 1
                stats["error_text"] = f"upsert {raw.source_url}: {e}"[:500]
                log.warning("[%s] upsert failed for %s: %s", source.name, raw.source_url, e)
    except FutureTimeout:
        stats["errors"] += 1
        stats["error_text"] = f"timed out after {source.timeout}s"
        log.error("[%s] timed out after %ss", source.name, source.timeout)
    except Exception as e:
        stats["errors"] += 1
        stats["error_text"] = f"{type(e).__name__}: {e}"[:500]
        log.exception("[%s] fetch failed", source.name)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
    stats["tokens_used"] = getattr(source, "tokens_used", 0)
    try:
        conn.rollback()
        _finish_run(conn, run_id, **stats)
    except Exception:
        log.exception("[%s] could not record run stats", source.name)
    log.info(
        "[%s] fetched=%d new=%d errors=%d tokens=%d (%.1fs)%s",
        source.name, stats["fetched"], stats["new"], stats["errors"], stats["tokens_used"],
        time.monotonic() - t0, f" last_error={stats['error_text']}" if stats["error_text"] else "",
    )
    return stats


def run_pipeline(only: list[str] | None = None, do_enrich: bool = True) -> dict:
    conn = db.connect()
    try:
        db.migrate(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s) AS ok", (LOCK_ID,))
            if not cur.fetchone()["ok"]:
                log.warning("another pipeline run holds the lock; skipping")
                return {"skipped": True}
        conn.commit()

        pipeline_run = _start_run(conn, "pipeline")
        summary: dict = {"sources": {}}
        available = all_sources()
        sources = [s for s in available if not only or s.name in only]
        _stage(conn, pipeline_run, "sources", "plan", {"sources": [s.name for s in sources]})
        for source in sources:
            summary["sources"][source.name] = run_source(conn, source)

        with conn.cursor() as cur:
            store.refresh_statuses(cur)
        conn.commit()

        _stage(conn, pipeline_run, "details")
        summary["details"] = details.run_details(conn, {s.name: s for s in available})
        _stage(conn, pipeline_run, "enrich", "details", summary["details"])

        if do_enrich:
            summary["enrich"] = enrich.run_enrichment(conn, {s.name: s for s in available})
            with conn.cursor() as cur:
                store.refresh_statuses(cur)  # AI may have filled in dates
            conn.commit()
            _stage(conn, pipeline_run, "polish", "enrich", summary["enrich"])
            summary["polish"] = polish.run_polish(conn)
            _stage(conn, pipeline_run, "artwork", "polish", summary["polish"])

        summary["artwork"] = artwork.run_artwork(conn)
        _stage(conn, pipeline_run, "done", "artwork", summary["artwork"])

        total_fetched = sum(s["fetched"] for s in summary["sources"].values())
        total_new = sum(s["new"] for s in summary["sources"].values())
        errors = sum(s["errors"] for s in summary["sources"].values())
        tokens = (
            sum(s["tokens_used"] for s in summary["sources"].values())
            + (summary.get("enrich") or {}).get("tokens_used", 0)
            + (summary.get("polish") or {}).get("tokens_used", 0)
            + (summary.get("artwork") or {}).get("tokens_used", 0)
        )
        _finish_run(conn, pipeline_run, fetched=total_fetched, new=total_new,
                    errors=errors, tokens_used=tokens)
        log.info("pipeline done: fetched=%d new=%d source_errors=%d tokens=%d",
                 total_fetched, total_new, errors, tokens)
        summary.update(fetched=total_fetched, new=total_new, errors=errors, tokens_used=tokens)
        return summary
    finally:
        try:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute("SELECT pg_advisory_unlock(%s)", (LOCK_ID,))
            conn.commit()
        except Exception:
            pass
        conn.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser()
    p.add_argument("--sources", help="comma-separated source names (default: all)")
    p.add_argument("--no-enrich", action="store_true")
    args = p.parse_args()
    only = [s.strip() for s in args.sources.split(",")] if args.sources else None
    summary = run_pipeline(only=only, do_enrich=not args.no_enrich)
    # One broken source is normal and must not fail the cron job; all of them
    # failing at once means something bigger is wrong (network, DB), so say so.
    results = list(summary.get("sources", {}).values())
    if results and all(r["errors"] and not r["fetched"] for r in results):
        raise SystemExit("every source failed")


if __name__ == "__main__":
    main()
