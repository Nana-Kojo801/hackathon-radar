"""Push notifications: subscribe routes and what app.notify pushes. Needs TEST_DATABASE_URL; nothing is really sent."""

import os
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

KEY = {"X-Personal-Key": "test-key"}
NOW = datetime(2026, 10, 13, 12, 17, tzinfo=timezone.utc)  # a Tuesday
SUB = {"endpoint": "https://push.example.com/abc123", "keys": {"p256dh": "B" * 40, "auth": "A" * 16}}


@pytest.fixture()
def conn(monkeypatch):
    from app import config, db

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    c = db.connect()
    db.migrate(c)
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages, push_subscriptions CASCADE")
        cur.execute("DELETE FROM my_settings")
        cur.execute("INSERT INTO my_settings (id, alert_min_prize) VALUES (1, 5000)")
        cur.execute("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (%s, %s, %s)",
                    (SUB["endpoint"], SUB["keys"]["p256dh"], SUB["keys"]["auth"]))
    c.commit()
    yield c
    c.close()


def add(conn, title, *, prize=20000.0, seen=None, deadline=None, **kw):
    cols = dict(source="devpost", source_url=f"https://{title.replace(' ', '-').lower()}.example/", title=title,
                title_key=title.lower(), content_hash="x", status="open", prize_usd=prize,
                first_seen_at=seen or NOW - timedelta(hours=1), registration_deadline=deadline,
                enriched_at=seen or NOW - timedelta(hours=1))
    cols.update(kw)
    with conn.cursor() as cur:
        cur.execute(f"INSERT INTO hackathons ({', '.join(cols)}) VALUES ({', '.join(f'%({k})s' for k in cols)}) RETURNING id", cols)
        hid = cur.fetchone()["id"]
    conn.commit()
    return hid


def settings(conn, **kw):
    with conn.cursor() as cur:
        cur.execute("UPDATE my_settings SET " + ", ".join(f"{k} = %({k})s" for k in kw) + " WHERE id = 1", kw)
    conn.commit()


def run(conn, now=NOW, accept=True):
    from app import notify

    got = []

    def deliver(subs, push, cur):
        got.append(push)
        return len(subs) if accept else 0

    notify.run_push(conn, now=now, deliver=deliver)
    return got


def test_first_run_sets_a_baseline_then_pushes_matches_and_big_prizes(conn):
    assert run(conn, NOW - timedelta(days=1)) == []
    add(conn, "Mid Hack", prize=20000)
    add(conn, "Mega Hack", prize=500000, categories=["gaming"])
    settings(conn, alert_categories=["AI/ML"])
    add(conn, "AI Hack", prize=30000, categories=["AI/ML"])
    pushes = run(conn)
    titles = [p.title for p in pushes]
    assert titles[0] == "New match: AI Hack"
    assert titles[1] == "Big prize: $500K" and "Mega Hack" in pushes[1].body
    assert len(pushes) == 2 and all(p.badge == 0 for p in pushes)
    assert run(conn, NOW + timedelta(hours=6)) == []


def test_closing_soon_pushes_once_with_badge(conn):
    from app import notify

    settings(conn, last_push_at=NOW)
    hid = add(conn, "Closing Hack", deadline=NOW + timedelta(days=1, hours=3), seen=NOW - timedelta(days=5))
    with conn.cursor() as cur:
        cur.execute("INSERT INTO my_hackathons (hackathon_id, status) VALUES (%s, 'registered')", (hid,))
    conn.commit()
    pushes = run(conn)
    assert len(pushes) == 1
    assert pushes[0].title == "Closes tomorrow: Closing Hack" and pushes[0].url == f"/h/{hid}"
    assert pushes[0].badge == 1 and "registered" in pushes[0].body
    assert run(conn, NOW + timedelta(hours=6)) == []
    assert notify.badge_count(conn.cursor(), NOW) == 1


def test_quiet_hours_hold_pushes_until_later(conn):
    settings(conn, last_push_at=NOW - timedelta(hours=6), quiet_hours_enabled=True, quiet_start=22, quiet_end=8,
             timezone="Africa/Accra")
    add(conn, "Night Hack")
    assert run(conn, NOW.replace(hour=23)) == []
    assert [p.title for p in run(conn, NOW)] == ["New match: Night Hack"]


def test_failed_delivery_keeps_the_marker(conn):
    settings(conn, last_push_at=NOW - timedelta(hours=6))
    add(conn, "Retry Hack")
    with pytest.raises(RuntimeError):
        run(conn, accept=False)
    assert [p.title for p in run(conn, NOW + timedelta(hours=6))] == ["New match: Retry Hack"]


def test_no_subscriptions_means_no_work(conn):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM push_subscriptions")
    conn.commit()
    settings(conn, last_push_at=NOW - timedelta(hours=6))
    add(conn, "Lonely Hack")
    assert run(conn) == []


@pytest.fixture()
def client(monkeypatch, conn):
    from fastapi.testclient import TestClient

    from app import config, db
    from app.main import app

    monkeypatch.setattr(config, "PERSONAL_KEY", "test-key")
    monkeypatch.setattr(db, "_pool", None)
    with TestClient(app) as tc:
        yield tc
    db.pool().close()


def test_key_route_and_subscriptions(client, monkeypatch):
    from app import config, push

    monkeypatch.setattr(config, "VAPID_PRIVATE_KEY", "")
    assert client.get("/push/key").json() == {"key": None}
    monkeypatch.setattr(config, "VAPID_PRIVATE_KEY", push.generate_key())
    key = client.get("/push/key").json()["key"]
    assert key and len(key) == 87  # 65-byte uncompressed point, base64url

    assert client.post("/me/push", json=SUB).status_code == 401
    other = {**SUB, "endpoint": "https://push.example.com/second"}
    r = client.post("/me/push", json=other, headers=KEY)
    assert r.status_code == 200 and r.json()["devices"] == 2
    assert client.post("/me/push", json={**other, "endpoint": "http://insecure"}, headers=KEY).status_code == 422
    r = client.request("DELETE", "/me/push", json={"endpoint": other["endpoint"]}, headers=KEY)
    assert r.json()["devices"] == 1
    assert client.get("/me", headers=KEY).json()["settings"]["push_devices"] == 1


def test_push_settings(client):
    r = client.put("/me/settings", json={"push_digest": True, "quiet_hours_enabled": True, "quiet_start": 23,
                                         "timezone": "Africa/Accra", "big_prize_min": 250000}, headers=KEY)
    s = r.json()
    assert s["push_digest"] is True and s["quiet_start"] == 23 and s["quiet_end"] == 8
    assert s["timezone"] == "Africa/Accra" and s["big_prize_min"] == 250000
    assert client.put("/me/settings", json={"timezone": "Mars/Base"}, headers=KEY).status_code == 422
    assert client.put("/me/settings", json={"quiet_end": 24}, headers=KEY).status_code == 422
