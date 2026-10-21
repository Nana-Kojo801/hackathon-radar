"""Run the search now, from Settings, and watch it happen.

The search runs on GitHub Actions (refresh.yml), where its secrets live and
where the snapshot the app reads gets published afterwards (publish-data.yml).
So "Refresh now" asks GitHub to start that workflow, and the progress view
combines GitHub's view of the two workflows (queued, running, done) with the
pipeline's own record of what it's doing (source_runs: each source as it
finishes, and the stage and step numbers on the 'pipeline' row).

Needs GITHUB_TOKEN on the server: a fine-grained token for this repository
with "Actions: Read and write". Without it, the view still shows runs as the
pipeline records them; only starting one is unavailable.

- GET /me/refresh: the latest run, live.
- POST /me/refresh: start one (409 while one is already queued or running).
- POST /schedule/tick: start the scheduled run on time. GitHub starts its own scheduled runs hours
  late (3 to 6 hours was normal) and sometimes skips them, so the Cloudflare Worker's cron calls
  this at each slot. It needs no key: it only starts the run that's due, and only when no run has
  started since the slot, so calling it again does nothing.
"""

import logging
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException

from . import config, db
from .personal import require_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/me", dependencies=[Depends(require_key)])
public_router = APIRouter()

API = "https://api.github.com"
# The schedule: every 6 hours at minute 17 (UTC), as in refresh.yml.
EVERY_HOURS = 6
AT_MINUTE = 17
REFRESH_WORKFLOW = "refresh.yml"
PUBLISH_WORKFLOW = "publish-data.yml"
# The view polls every few seconds; GitHub's answers are reused this long.
CACHE_SECONDS = 4.0

_cache: dict[str, tuple[float, dict | None]] = {}
_lock = threading.Lock()


def configured() -> bool:
    return bool(config.GITHUB_TOKEN and config.GITHUB_REPO)


def _github(method: str, path: str, **kw) -> httpx.Response:
    r = httpx.request(
        method,
        f"{API}/repos/{config.GITHUB_REPO}{path}",
        headers={
            "Authorization": f"Bearer {config.GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": config.USER_AGENT,
        },
        timeout=10,
        **kw,
    )
    if r.status_code >= 400:
        raise HTTPException(502, f"GitHub answered {r.status_code}: check GITHUB_TOKEN can run Actions on {config.GITHUB_REPO}")
    return r


def latest_run(workflow: str) -> dict | None:
    """The workflow's most recent run, in the shape the app uses."""
    with _lock:
        hit = _cache.get(workflow)
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            return hit[1]
    runs = _github("GET", f"/actions/workflows/{workflow}/runs", params={"per_page": 1}).json().get("workflow_runs") or []
    run = None
    if runs:
        r = runs[0]
        run = {
            "id": r["id"],
            "status": r["status"],  # queued, in_progress, completed (and a few waiting states)
            "conclusion": r.get("conclusion"),  # success, failure, cancelled, ... once completed
            "event": r.get("event"),  # schedule or workflow_dispatch
            "created_at": r["created_at"],
            "started_at": r.get("run_started_at"),
            "updated_at": r.get("updated_at"),
            "url": r.get("html_url"),
        }
    with _lock:
        _cache[workflow] = (time.monotonic(), run)
    return run


def _pipeline() -> tuple[dict | None, list[dict]]:
    with db.cursor() as cur:
        cur.execute(
            "SELECT id, started_at, finished_at, stage, progress, fetched, new, errors, tokens_used"
            " FROM source_runs WHERE source = 'pipeline' ORDER BY started_at DESC LIMIT 1"
        )
        run = cur.fetchone()
        if not run:
            return None, []
        cur.execute(
            "SELECT source, started_at, finished_at, fetched, new, errors, error_text FROM source_runs"
            " WHERE started_at >= %s AND source NOT IN ('pipeline', 'enrich') ORDER BY started_at",
            (run["started_at"],),
        )
        return run, cur.fetchall()


@router.get("/refresh")
def refresh_status() -> dict:
    pipeline, sources = _pipeline()
    refresh = publish = None
    error = None
    if configured():
        try:
            refresh = latest_run(REFRESH_WORKFLOW)
            publish = latest_run(PUBLISH_WORKFLOW)
            # Only the publish that follows this refresh counts.
            if publish and refresh and publish["created_at"] < refresh["created_at"]:
                publish = None
        except HTTPException as e:
            error = e.detail
        except httpx.HTTPError as e:
            error = f"GitHub didn't answer: {e}"
    return {"configured": configured(), "error": error, "refresh": refresh, "publish": publish,
            "pipeline": pipeline, "sources": sources}


@router.post("/refresh", status_code=202)
def start_refresh() -> dict:
    if not configured():
        raise HTTPException(503, "Add GITHUB_TOKEN on the server to run the search from the app (see README)")
    current = latest_run(REFRESH_WORKFLOW)
    if current and current["status"] != "completed":
        raise HTTPException(409, "A refresh is already running")
    _github("POST", f"/actions/workflows/{REFRESH_WORKFLOW}/dispatches", json={"ref": "main"})
    with _lock:
        _cache.clear()
    log.info("refresh requested from the app")
    return {"requested_at": datetime.now(timezone.utc)}


def last_slot(now: datetime) -> datetime:
    """The most recent scheduled time at or before now."""
    slot = now.replace(hour=now.hour - now.hour % EVERY_HOURS, minute=AT_MINUTE, second=0, microsecond=0)
    return slot if slot <= now else slot - timedelta(hours=EVERY_HOURS)


@public_router.post("/schedule/tick")
def schedule_tick() -> dict:
    """Start the scheduled refresh if it's due: nothing has started since the latest slot."""
    if not configured():
        return {"started": False, "reason": "GITHUB_TOKEN isn't set on the server"}
    slot = last_slot(datetime.now(timezone.utc))
    with _lock:
        _cache.pop(REFRESH_WORKFLOW, None)
    current = latest_run(REFRESH_WORKFLOW)
    if current and current["status"] != "completed":
        return {"started": False, "reason": "a refresh is running"}
    # Ten minutes' grace: a run started just before the slot (by hand, say) counts.
    if current and datetime.fromisoformat(current["created_at"].replace("Z", "+00:00")) >= slot - timedelta(minutes=10):
        return {"started": False, "reason": "already ran since " + slot.isoformat()}
    _github("POST", f"/actions/workflows/{REFRESH_WORKFLOW}/dispatches", json={"ref": "main"})
    with _lock:
        _cache.clear()
    log.info("scheduled refresh started for the %s slot", slot.isoformat())
    return {"started": True, "slot": slot}
