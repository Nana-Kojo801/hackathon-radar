"""Polish step: AI-tidied descriptions and prizes from the text. Needs TEST_DATABASE_URL; the AI is stubbed."""

import os

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

LONG = "Build for Fire TV and Alexa. " * 10 + "\n\nRules: https://example.com/rules"


@pytest.fixture()
def conn(monkeypatch):
    from app import config, db

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    c = db.connect()
    db.migrate(c)
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages CASCADE")
    c.commit()
    yield c
    c.close()


def add(conn, title, description, **kw):
    cols = dict(source="devpost", source_url=f"https://{title.lower().replace(' ', '-')}.example/", title=title,
                title_key=title.lower(), content_hash="x", status="open", description_detail=description)
    cols.update(kw)
    with conn.cursor() as cur:
        cur.execute(f"INSERT INTO hackathons ({', '.join(cols)}) VALUES ({', '.join(f'%({k})s' for k in cols)}) RETURNING id", cols)
        hid = cur.fetchone()["id"]
    conn.commit()
    return hid


@pytest.fixture()
def fake_ai(monkeypatch):
    from pipeline import ai

    calls = []

    def chat_json(system, user, schema, name, usage, max_tokens=800):
        calls.append(user)
        if "Broken" in user:
            raise ValueError("boom")
        usage.add(100, 50)
        return {
            "markdown": "Build for Amazon devices.\n\n\n\n### Resources\n- [Rules](https://example.com/rules)\n- [bad](javascript:alert(1))",
            "prizes": [
                {"name": "Fire TV 1st", "track": "Fire TV", "rank": 1, "amount_usd": 25000, "amount_text": "$25,000", "winners": 1, "perks": ["AWS credits"]},
                {"name": "", "track": None, "rank": None, "amount_usd": None, "amount_text": None, "winners": 1, "perks": []},
            ],
        }

    monkeypatch.setattr(ai, "client", lambda: object())
    monkeypatch.setattr(ai, "chat_json", chat_json)
    return calls


def test_polishes_once_per_description_and_cleans_output(conn, fake_ai):
    from pipeline.polish import run_polish

    hid = add(conn, "Amazon Hack", LONG)
    add(conn, "Tiny Hack", "Too short to bother.")
    add(conn, "Ended Hack", LONG, status="ended")
    stats = run_polish(conn)
    assert stats == {"candidates": 1, "polished": 1, "failed": 0, "tokens_used": 150}
    with conn.cursor() as cur:
        cur.execute("SELECT about_md, about_prizes FROM hackathons WHERE id = %s", (hid,))
        row = cur.fetchone()
    assert "\n\n\n" not in row["about_md"] and "[Rules](https://example.com/rules)" in row["about_md"]
    assert "javascript:" not in row["about_md"] and "bad" in row["about_md"]
    assert row["about_prizes"] == [{"name": "Fire TV 1st", "track": "Fire TV", "rank": 1, "amount_usd": 25000.0,
                                    "amount_text": "$25,000", "winners": 1, "perks": ["AWS credits"]}]
    # Unchanged description: nothing to do. Changed: polished again.
    assert run_polish(conn)["candidates"] == 0
    with conn.cursor() as cur:
        cur.execute("UPDATE hackathons SET description_detail = %s WHERE id = %s", (LONG + " New rule.", hid))
    conn.commit()
    assert run_polish(conn)["polished"] == 1


def test_failures_retry_then_stop(conn, fake_ai):
    from pipeline.polish import MAX_ATTEMPTS, run_polish

    add(conn, "Broken Hack", LONG)
    for _ in range(MAX_ATTEMPTS):
        assert run_polish(conn)["failed"] == 1
    assert run_polish(conn)["candidates"] == 0


def test_detail_endpoint_returns_polished_copy(conn, fake_ai, monkeypatch):
    from fastapi.testclient import TestClient

    from app import db
    from app.main import app
    from pipeline.polish import run_polish

    hid = add(conn, "Amazon Hack", LONG, enriched_at="2026-10-01T00:00:00Z")
    run_polish(conn)
    monkeypatch.setattr(db, "_pool", None)
    with TestClient(app) as client:
        body = client.get(f"/hackathons/{hid}").json()
    db.pool().close()
    assert body["about"].startswith("Build for Amazon devices.") and body["about_prizes"][0]["rank"] == 1
