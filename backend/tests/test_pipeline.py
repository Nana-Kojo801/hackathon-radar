"""Pipeline isolation tests. Need a scratch Postgres in TEST_DATABASE_URL."""

import os
import time

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


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


def _listing(**kw):
    from pipeline.types import RawListing

    base = dict(source="devpost", source_url="https://a.devpost.com/", title="Alpha Hack 2026",
                prize_text="$5,000", prize_usd=5000.0, dates_text="Nov 01 - 03, 2026")
    base.update(kw)
    return RawListing(**base)


class Broken:
    name, timeout = "broken", 5

    def fetch(self):
        raise RuntimeError("site changed")


class Hanging:
    name, timeout = "hanging", 1

    def fetch(self):
        time.sleep(3)
        return []


class Good:
    name, timeout = "good", 5

    def __init__(self, items):
        self.items = items

    def fetch(self):
        return self.items


def test_failing_and_hanging_sources_do_not_break_run(conn):
    from pipeline.run import run_source

    assert run_source(conn, Broken())["errors"] == 1
    assert run_source(conn, Hanging())["errors"] == 1
    stats = run_source(conn, Good([_listing()]))
    assert stats == {**stats, "fetched": 1, "new": 1, "errors": 0}
    with conn.cursor() as cur:
        cur.execute("SELECT source, errors, error_text FROM source_runs ORDER BY id")
        rows = cur.fetchall()
    assert [r["errors"] for r in rows] == [1, 1, 0]
    assert "site changed" in rows[0]["error_text"]
    assert "timed out" in rows[1]["error_text"]


def test_cross_source_dedupe_keeps_richest(conn):
    from pipeline.dates import parse_iso
    from pipeline.run import run_source

    start, end = parse_iso("2026-11-01"), parse_iso("2026-11-03")
    run_source(conn, Good([_listing(start_date=start, end_date=end)]))
    mlh = _listing(source="mlh", source_url="https://alphahack.org", title="Alpha Hack",
                   prize_text=None, prize_usd=None, start_date=start, end_date=end, student_only=True)
    web = _listing(source="web", source_url="https://a.devpost.com", title="Alpha Hackathon",
                   prize_text="$1", prize_usd=None, description="from a blog")
    assert run_source(conn, Good([mlh, web]))["new"] == 0
    with conn.cursor() as cur:
        cur.execute("SELECT source, source_url, alt_urls, prize_text, student_only FROM hackathons")
        rows = cur.fetchall()
    assert len(rows) == 1
    row = rows[0]
    assert row["source"] == "devpost" and row["prize_text"] == "$5,000"
    assert row["alt_urls"] == ["https://alphahack.org"]
    assert row["student_only"] is True


def test_enrichment_failure_is_retried_next_run(conn, monkeypatch):
    from app import config
    from pipeline import ai, enrich
    from pipeline.run import run_source

    run_source(conn, Good([_listing()]))
    monkeypatch.setattr(config, "OPENAI_API_KEY", "x")

    def boom(*a, **k):
        raise TimeoutError("openai down")

    monkeypatch.setattr(ai, "chat_json", boom)
    monkeypatch.setattr(ai, "client", lambda: object())
    stats = enrich.run_enrichment(conn, {})
    assert stats["failed"] == 1 and stats["enriched"] == 0
    with conn.cursor() as cur:
        cur.execute("SELECT enriched_at, enrich_attempts, prize_usd FROM hackathons")
        row = cur.fetchone()
    assert row["enriched_at"] is None and row["enrich_attempts"] == 1
    assert float(row["prize_usd"]) == 5000  # listing still stored and usable

    def ok(*a, **k):
        return {"summary": "A hack.", "prize_usd": 1.0, "prize_confidence": "low", "prize_notes": None,
                "format": "online", "categories": ["web", "bogus"], "international_ok": None,
                "student_only": None, "relevance_score": 70, "is_real_hackathon": False,
                "start_date": None, "end_date": None, "registration_deadline": None}

    monkeypatch.setattr(ai, "chat_json", ok)
    assert enrich.run_enrichment(conn, {})["enriched"] == 1
    assert enrich.run_enrichment(conn, {})["candidates"] == 0  # hash unchanged -> no second call
    with conn.cursor() as cur:
        cur.execute("SELECT prize_usd, categories, is_hidden, summary FROM hackathons")
        row = cur.fetchone()
    assert float(row["prize_usd"]) == 5000  # structured prize beats the AI guess
    assert row["categories"] == ["web"]
    assert row["is_hidden"] is False  # platform listings are never dropped


def test_web_duplicates_with_contained_titles_merge(conn):
    from pipeline.dates import parse_iso
    from pipeline.run import run_source

    start, end = parse_iso("2026-06-01"), parse_iso("2027-02-28")
    a = _listing(source="web", source_url="https://decentralizeai.tech/prizes",
                 title="Decentralize AI Hackathon", prize_usd=None, start_date=start, end_date=end)
    b = _listing(source="web", source_url="https://decentralizeai.tech",
                 title="HackerNoon Decentralize AI Hackathon", prize_usd=None, start_date=start, end_date=end)
    other = _listing(source="web", source_url="https://other.example/ai", title="Decentralize AI Hackathon",
                     prize_usd=None, start_date=parse_iso("2027-09-01"), end_date=parse_iso("2027-09-03"))
    assert run_source(conn, Good([a, b, other]))["new"] == 2
    with conn.cursor() as cur:
        cur.execute("SELECT source_url, alt_urls FROM hackathons ORDER BY source_url")
        rows = cur.fetchall()
    assert rows[0]["source_url"] == "https://decentralizeai.tech/prizes"
    assert rows[0]["alt_urls"] == ["https://decentralizeai.tech"]


def test_unvetted_web_finds_are_hidden_from_the_list(conn, monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, db
    from app.main import app
    from pipeline.run import run_source

    run_source(conn, Good([_listing(), _listing(source="web", source_url="https://x.example", title="Web Hack")]))
    monkeypatch.setattr(db, "_pool", None)
    with TestClient(app) as client:
        titles = [h["title"] for h in client.get("/hackathons").json()["items"]]
        assert titles == ["Alpha Hack 2026"]
        with conn.cursor() as cur:
            cur.execute("UPDATE hackathons SET enriched_at = now() WHERE source = 'web'")
        conn.commit()
        assert len(client.get("/hackathons").json()["items"]) == 2
    db.pool().close()
    monkeypatch.setattr(db, "_pool", None)
    assert config.DATABASE_URL == os.environ["TEST_DATABASE_URL"]


def test_details_step_stores_description_and_prizes_without_overwrite(conn):
    from pipeline.details import run_details
    from pipeline.run import run_source
    from pipeline.store import refresh_statuses
    from pipeline.types import Source

    class Detailed(Source):
        name = "devpost"
        calls = 0

        def fetch_detail(self, row):
            Detailed.calls += 1
            return {"text": "A long description " * 30,
                    "prizes": [{"name": "1st", "amount_text": "$3,000", "amount_usd": 3000, "winners": 1, "perks": []}]}

    listing = _listing(start_date=None, end_date=None, description="Themes: AI.")
    run_source(conn, Good([listing]))
    with conn.cursor() as cur:
        refresh_statuses(cur)
    conn.commit()
    assert run_details(conn, {"devpost": Detailed()})["fetched"] == 1
    assert run_details(conn, {"devpost": Detailed()})["candidates"] == 0  # fresh, not refetched
    run_source(conn, Good([_listing(start_date=None, end_date=None, description="Themes: AI.")]))  # same listing again
    with conn.cursor() as cur:
        cur.execute("SELECT description_raw, description_detail, prizes FROM hackathons")
        row = cur.fetchone()
    assert row["description_raw"] == "Themes: AI."
    assert row["description_detail"].startswith("A long description")
    assert row["prizes"][0]["amount_usd"] == 3000
    assert Detailed.calls == 1


def test_registration_counts_are_kept_and_updated(conn):
    from pipeline import store
    from pipeline.normalize import normalize

    with conn.cursor() as cur:
        store.upsert(cur, normalize(_listing(registrations=1200)))
        store.upsert(cur, normalize(_listing(registrations=1500)))
        cur.execute("SELECT registrations FROM hackathons")
        assert cur.fetchone()["registrations"] == 1500
        # A later read without the count keeps the last known one.
        store.upsert(cur, normalize(_listing(registrations=None)))
        cur.execute("SELECT registrations FROM hackathons")
        assert cur.fetchone()["registrations"] == 1500
    conn.commit()
