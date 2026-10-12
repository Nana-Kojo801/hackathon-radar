"""Personal /me API. Needs a scratch Postgres in TEST_DATABASE_URL."""

import os

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
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages CASCADE")
        cur.execute("DELETE FROM my_settings")
        cur.execute("INSERT INTO my_settings (id) VALUES (1)")
        cur.execute(
            "INSERT INTO hackathons (source, source_url, title, title_key, content_hash, status)"
            " VALUES ('devpost', 'https://a.devpost.com/', 'Alpha Hack', 'alpha hack', 'x', 'ended')"
            " RETURNING id"
        )
        hid = cur.fetchone()["id"]
    c.commit()
    c.close()
    with TestClient(app) as tc:
        tc.hid = str(hid)
        yield tc
    db.pool().close()


def test_key_is_required(client):
    assert client.get("/me").status_code == 401
    assert client.get("/me", headers={"X-Personal-Key": "nope"}).status_code == 401
    assert client.put(f"/me/hackathons/{client.hid}", json={"status": "saved"}).status_code == 401


def test_track_update_and_remove(client):
    r = client.put(f"/me/hackathons/{client.hid}", json={"status": "saved", "note": "  team with Ama  "}, headers=KEY)
    assert r.status_code == 200
    assert r.json()["status"] == "saved" and r.json()["note"] == "team with Ama"

    r = client.put(f"/me/hackathons/{client.hid}", json={"status": "submitted", "note": "team with Ama"}, headers=KEY)
    me = client.get("/me", headers=KEY).json()
    assert len(me["items"]) == 1
    item = me["items"][0]
    assert item["status"] == "submitted"
    # Tracked hackathons come back even after the event has ended.
    assert item["hackathon"]["title"] == "Alpha Hack" and item["hackathon"]["status"] == "ended"

    # A note alone is kept; no stage and no note removes the row.
    client.put(f"/me/hackathons/{client.hid}", json={"status": None, "note": "maybe next year"}, headers=KEY)
    assert client.get("/me", headers=KEY).json()["items"][0]["status"] is None
    r = client.put(f"/me/hackathons/{client.hid}", json={"status": None, "note": ""}, headers=KEY)
    assert r.json()["removed"] is True
    assert client.get("/me", headers=KEY).json()["items"] == []


def test_unknown_hackathon_and_bad_status(client):
    r = client.put("/me/hackathons/00000000-0000-0000-0000-000000000000", json={"status": "saved"}, headers=KEY)
    assert r.status_code == 404
    r = client.put(f"/me/hackathons/{client.hid}", json={"status": "maybe"}, headers=KEY)
    assert r.status_code == 422


def test_settings_partial_update_and_validation(client):
    s = client.get("/me", headers=KEY).json()["settings"]
    assert s["alerts_enabled"] is True and s["alert_min_prize"] == 5000 and s["reminder_days"] == 2

    r = client.put("/me/settings", json={"alert_min_prize": 10000, "alert_categories": ["AI/ML", "web"]}, headers=KEY)
    assert r.status_code == 200
    s = r.json()
    assert s["alert_min_prize"] == 10000 and s["alert_categories"] == ["AI/ML", "web"]
    assert s["digest_enabled"] is True  # untouched

    assert client.put("/me/settings", json={"alert_categories": ["knitting"]}, headers=KEY).status_code == 422
    assert client.put("/me/settings", json={"reminder_days": 30}, headers=KEY).status_code == 422
