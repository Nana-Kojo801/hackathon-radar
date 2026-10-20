"""Refresh now: starting the GitHub workflow and the live status. Needs TEST_DATABASE_URL; GitHub is stubbed."""

import os

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

KEY = {"X-Personal-Key": "test-key"}


class FakeGitHub:
    def __init__(self):
        self.runs = {"refresh.yml": [], "publish-data.yml": []}
        self.dispatched = 0

    def __call__(self, method, path, **kw):
        import httpx

        if method == "POST":
            self.dispatched += 1
            return httpx.Response(204)
        wf = path.split("/")[3]
        return httpx.Response(200, json={"workflow_runs": self.runs[wf][:1]})


def gh_run(status, conclusion=None, created="2026-10-20T10:00:00Z"):
    return {"id": 1, "status": status, "conclusion": conclusion, "event": "workflow_dispatch", "created_at": created,
            "run_started_at": created, "updated_at": created, "html_url": "https://github.com/x/y/actions/runs/1"}


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, db, refresh
    from app.main import app

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    monkeypatch.setattr(config, "PERSONAL_KEY", "test-key")
    monkeypatch.setattr(config, "GITHUB_TOKEN", "token")
    monkeypatch.setattr(db, "_pool", None)
    fake = FakeGitHub()
    monkeypatch.setattr(refresh, "_github", fake)
    refresh._cache.clear()
    c = db.connect()
    db.migrate(c)
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages CASCADE")
    c.commit()
    c.close()
    with TestClient(app) as tc:
        tc.fake = fake
        yield tc
    db.pool().close()


def test_needs_key_and_token(client, monkeypatch):
    from app import config

    assert client.post("/me/refresh").status_code == 401
    monkeypatch.setattr(config, "GITHUB_TOKEN", "")
    assert client.post("/me/refresh", headers=KEY).status_code == 503
    s = client.get("/me/refresh", headers=KEY).json()
    assert s["configured"] is False and s["refresh"] is None


def test_starts_once_and_refuses_while_running(client):
    from app import refresh

    client.fake.runs["refresh.yml"] = [gh_run("completed", "success")]
    assert client.post("/me/refresh", headers=KEY).status_code == 202
    assert client.fake.dispatched == 1

    refresh._cache.clear()
    client.fake.runs["refresh.yml"] = [gh_run("in_progress", created="2026-10-20T11:00:00Z")]
    assert client.post("/me/refresh", headers=KEY).status_code == 409
    assert client.fake.dispatched == 1


def test_status_follows_the_pipeline(client):
    from pipeline import run as pipeline_run

    from app import db

    client.fake.runs["refresh.yml"] = [gh_run("in_progress", created="2026-10-20T11:00:00Z")]
    # An older publish doesn't belong to this refresh.
    client.fake.runs["publish-data.yml"] = [gh_run("completed", "success", created="2026-10-20T09:00:00Z")]
    conn = db.connect()
    run_id = pipeline_run._start_run(conn, "pipeline")
    pipeline_run._stage(conn, run_id, "sources", "plan", {"sources": ["devpost", "mlh"]})
    src = pipeline_run._start_run(conn, "devpost")
    pipeline_run._finish_run(conn, src, fetched=12, new=3)
    pipeline_run._stage(conn, run_id, "polish", "enrich", {"enriched": 3, "dropped": 1})
    conn.close()

    s = client.get("/me/refresh", headers=KEY).json()
    assert s["refresh"]["status"] == "in_progress" and s["publish"] is None
    assert s["pipeline"]["stage"] == "polish"
    assert s["pipeline"]["progress"]["plan"]["sources"] == ["devpost", "mlh"]
    assert s["pipeline"]["progress"]["enrich"] == {"enriched": 3, "dropped": 1}
    assert [(r["source"], r["fetched"], r["new"]) for r in s["sources"]] == [("devpost", 12, 3)]
