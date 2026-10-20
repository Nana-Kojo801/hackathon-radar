"""Write a static copy of what the site reads, for GitHub Pages.

    python -m app.snapshot <out_dir>

The free Render instance sleeps when idle and takes 30-60s to wake, so the
frontend reads this copy first and only falls back to the API when it's
missing. It's built right after each refresh, which is the only time the data
changes. The responses come from the API's own endpoints (called in-process),
so the copy matches the API exactly:

    <out_dir>/list.json      GET /hackathons (every open/upcoming hackathon)
    <out_dir>/meta.json      GET /meta, plus generated_at
    <out_dir>/stats.json     GET /stats (the market half of the stats page)
    <out_dir>/h/<id>.json    GET /hackathons/<id>, one per listed hackathon
"""

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

from . import db
from .main import app

log = logging.getLogger("snapshot")

PAGE = 500


def _write(path: Path, data) -> None:
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def build(out: Path) -> dict:
    (out / "h").mkdir(parents=True, exist_ok=True)
    with TestClient(app) as client:
        items: list[dict] = []
        while True:
            r = client.get("/hackathons", params={"limit": PAGE, "offset": len(items)})
            r.raise_for_status()
            page = r.json()
            items.extend(page["items"])
            if len(items) >= page["total"] or not page["items"]:
                break
        _write(out / "list.json", {"items": items, "total": len(items), "limit": len(items), "offset": 0})

        meta = client.get("/meta")
        meta.raise_for_status()
        _write(out / "meta.json", {**meta.json(), "generated_at": datetime.now(timezone.utc).isoformat()})

        stats = client.get("/stats")
        stats.raise_for_status()
        _write(out / "stats.json", stats.json())

        for h in items:
            r = client.get(f"/hackathons/{h['id']}")
            r.raise_for_status()
            _write(out / "h" / f"{h['id']}.json", r.json())

    # Serve files as-is (no Jekyll processing on GitHub Pages).
    (out / ".nojekyll").write_text("")
    (out / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Hackathon Radar data</title>"
        "<p>Data files for <a href='https://hackathon-radar.nkabenyah.workers.dev/'>Hackathon Radar</a>.</p>"
    )
    return {"hackathons": len(items)}


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.snapshot <out_dir>")
    try:
        stats = build(Path(sys.argv[1]))
    finally:
        db.pool().close()
    log.info("snapshot written: %s", stats)


if __name__ == "__main__":
    main()
