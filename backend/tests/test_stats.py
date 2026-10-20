"""Stats endpoints and the activity log. Needs a scratch Postgres in TEST_DATABASE_URL."""

import os
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

KEY = {"X-Personal-Key": "test-key"}


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, db
    from app.main import app

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    monkeypatch.setattr(config, "PERSONAL_KEY", "test-key")
    monkeypatch.setattr(db, "_pool", None)
    c = db.connect()
    db.migrate(c)
    ids = []
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages CASCADE")
        cur.execute("DELETE FROM my_settings")
        cur.execute("INSERT INTO my_settings (id) VALUES (1)")
        for i, (prize, cats, fmt) in enumerate([(10000, ["AI/ML"], "online"), (500, ["web"], "in_person"),
                                                (None, ["AI/ML", "web"], "online"), (2000, ["gaming"], "online")]):
            cur.execute(
                "INSERT INTO hackathons (source, source_url, title, title_key, content_hash, status, prize_usd,"
                " categories, format, registration_deadline, first_seen_at, last_seen_at)"
                " VALUES ('devpost', %s, %s, %s, 'x', 'open', %s, %s, %s, now() + interval '10 days',"
                " now() - interval '3 days', now()) RETURNING id",
                (f"https://h{i}.devpost.com/", f"Hack {i}", f"hack {i}", prize, cats, fmt),
            )
            ids.append(str(cur.fetchone()["id"]))
        cur.execute("INSERT INTO source_runs (source, finished_at, fetched, new, tokens_used)"
                    " VALUES ('pipeline', now() - interval '20 days', 4, 4, 900)")
    c.commit()
    c.close()
    with TestClient(app) as tc:
        tc.ids = ids
        yield tc
    db.pool().close()


def test_market_stats_are_public(client):
    r = client.get("/stats")
    assert r.status_code == 200
    s = r.json()
    assert s["totals"]["open"] == 4 and s["totals"]["pool"] == 12500
    assert {b["label"]: b["count"] for b in s["prize_buckets"]}["Not stated"] == 1
    assert s["by_source"] == [{"source": "devpost", "count": 4}]
    assert sum(s["closing"].values()) == 4
    assert len(s["new_per_week"]) == 12 and sum(w["count"] or 0 for w in s["new_per_week"]) == 4
    assert s["runs"][0]["tokens"] == 900


def test_stage_changes_build_the_funnel_and_habits(client):
    a, b, c, _ = client.ids
    for hid, stages in ((a, ["saved", "registered", "submitted", "won"]), (b, ["saved", "registered"]), (c, ["hidden"])):
        for st in stages:
            assert client.put(f"/me/hackathons/{hid}", json={"status": st}, headers=KEY).status_code == 200
    # Re-saving the same stage doesn't log a second change.
    client.put(f"/me/hackathons/{b}", json={"status": "registered", "note": "with Ama"}, headers=KEY)

    s = client.get("/me/stats", headers=KEY).json()
    f = s["funnel"]
    assert (f["listed"], f["saved"], f["registered"], f["submitted"], f["won"], f["hidden"]) == (4, 2, 2, 1, 1, 1)
    assert s["prizes"]["entered_total"] == 10500 and s["prizes"]["biggest"]["id"] == a
    assert s["habits"]["registrations"] == 2 and s["habits"]["last_minute_pct"] == 0
    assert {c["key"]: c["mine"] for c in s["categories"]}["AI/ML"] == 1
    assert s["monthly"][-1]["registered"] == 2 and s["recap"]["saved"] == 2


def test_events_feed_activity(client):
    now = datetime.now(timezone.utc)
    events = [
        {"kind": "open", "source": "email", "at": (now - timedelta(days=1)).isoformat()},
        {"kind": "open", "source": "push", "at": now.isoformat()},
        {"kind": "open", "source": "home_screen"},
        {"kind": "view", "hackathon_id": client.ids[0]},
        # Unknown hackathons are dropped, not errors.
        {"kind": "view", "hackathon_id": "00000000-0000-0000-0000-000000000000"},
    ]
    assert client.post("/me/events", json={"events": events}).status_code == 401
    assert client.post("/me/events", json={"events": events}, headers=KEY).json() == {"logged": 5}
    assert client.post("/me/events", json={"events": [{"kind": "stage"}]}, headers=KEY).status_code == 422

    a = client.get("/me/stats", headers=KEY).json()["activity"]
    assert a["opens"] == 3 and a["views"] == 1
    assert a["sources"] == {"email": 1, "push": 1, "home_screen": 1, "browser": 0}
    assert a["streak"] == 2 and a["longest_streak"] == 2
    assert sum(map(sum, a["heatmap"])) == 3
    assert a["per_week"][-1]["count"] >= 2
