"""Adding a hackathon by hand (app/add.py). Needs TEST_DATABASE_URL; the web and the AI are stubbed."""

import os

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

KEY = {"X-Personal-Key": "test-key"}


def candidate(**kw):
    c = {"title": "HackerRank x OpenAI Build Challenge", "url": "https://www.hackerrank.com/openai-build",
         "organizer": "HackerRank", "prize_text": "$50,000 in prizes", "location_text": None, "dates_text": None,
         "start_date": "2099-11-01", "end_date": "2099-11-15", "registration_deadline": "2099-10-30",
         "format": "online", "description": "Build with OpenAI models."}
    return {**c, **kw}


@pytest.fixture()
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app import add, config, db
    from app.main import app
    from pipeline import ai

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    monkeypatch.setattr(config, "PERSONAL_KEY", "test-key")
    monkeypatch.setattr(config, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(config, "SEARCH_API_KEY", "tvly-test")
    monkeypatch.setattr(db, "_pool", None)
    monkeypatch.setattr(ai, "client", lambda: object())
    calls = {"ai": 0, "search": [], "published": 0, "finished": []}

    def fake_chat(system, user, schema, name, usage, max_tokens=800):
        calls["ai"] += 1
        return {"candidates": calls.get("answer", [])}

    def fake_search(query, http):
        calls["search"].append(query)
        return [("https://www.hackerrank.com/openai-build", "HackerRank x OpenAI Build Challenge. $50,000 in prizes.")]

    monkeypatch.setattr(ai, "chat_json", fake_chat)
    monkeypatch.setattr(add, "search", fake_search)
    monkeypatch.setattr(add, "read", lambda url, http: (url, "", ""))
    monkeypatch.setattr(add, "finish", lambda hid: calls["finished"].append(hid))
    monkeypatch.setattr(add, "publish", lambda: calls.__setitem__("published", calls["published"] + 1))

    def fake_pictures(cands):
        for c in cands:
            if not c.get("existing_id"):
                c["banner_url"], c["logo_url"] = "https://img.example/banner.jpg", "https://img.example/logo.png"

    monkeypatch.setattr(add, "pictures", fake_pictures)
    c = db.connect()
    db.migrate(c)
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages CASCADE")
    c.commit()
    c.close()
    with TestClient(app) as tc:
        tc.calls = calls
        yield tc
    db.pool().close()


def _insert_listing(url="https://devpost.com/x", title="Existing Hack 2099", source="devpost"):
    from app import db
    from pipeline import store
    from pipeline.normalize import normalize
    from pipeline.types import RawListing

    with db.cursor() as cur:
        store.upsert(cur, normalize(RawListing(source=source, source_url=url, title=title)))
        cur.execute("UPDATE hackathons SET status = 'open', enriched_at = now() WHERE source_url = %s RETURNING id", (url,))
        return str(cur.fetchone()["id"])


def test_needs_the_key(client):
    assert client.post("/me/add/find", json={"text": "anything"}).status_code == 401
    assert client.post("/me/add", json=candidate()).status_code == 401


def test_a_link_the_radar_has_needs_no_ai(client):
    hid = _insert_listing()
    r = client.post("/me/add/find", headers=KEY, json={"text": "look https://devpost.com/x"})
    assert r.status_code == 200
    assert r.json()["candidates"][0]["existing_id"] == hid
    assert client.calls["ai"] == 0


def test_a_name_is_searched_and_known_ones_are_marked(client):
    hid = _insert_listing()
    client.calls["answer"] = [candidate(), candidate(title="Existing Hack 2099", url="https://devpost.com/x")]
    r = client.post("/me/add/find", headers=KEY, json={"text": "hackerrank openai hackathon"})
    body = r.json()
    assert r.status_code == 200 and body["searched"]
    assert client.calls["search"] == ["hackerrank openai hackathon hackathon"]
    assert [c["existing_id"] for c in body["candidates"]] == [None, hid]
    assert body["candidates"][0]["banner_url"] == "https://img.example/banner.jpg"


def test_a_linkedin_post_is_searched_by_the_words_in_its_link(client):
    client.calls["answer"] = [candidate()]
    url = "https://www.linkedin.com/posts/hackerrank_openai-hackathon-activity-7380123456789-AbCd"
    r = client.post("/me/add/find", headers=KEY, json={"text": url})
    assert r.status_code == 200
    assert client.calls["search"] == ["hackerrank openai hackathon hackathon"]


def test_invented_or_social_links_are_dropped(client):
    client.calls["answer"] = [candidate(url="https://www.linkedin.com/posts/x"), candidate(url="not a link")]
    r = client.post("/me/add/find", headers=KEY, json={"text": "some hackathon"})
    assert r.json()["candidates"] == []


def test_adding_shows_it_at_once_and_never_alerts(client):
    r = client.post("/me/add", headers=KEY, json=candidate())
    assert r.status_code == 201
    h = r.json()["hackathon"]
    assert r.json()["created"] and h["added_by_user"] and h["status"] == "upcoming"
    assert client.calls["finished"] == [h["id"]]
    listed = client.get("/hackathons").json()["items"]
    assert [x["id"] for x in listed] == [h["id"]]

    from datetime import datetime, timedelta, timezone

    from app import db, notify

    with db.cursor() as cur:
        s = notify.get_settings(cur) if hasattr(notify, "get_settings") else None
        now = datetime.now(timezone.utc)
        rows = notify.new_matches(cur, s or {"alert_min_prize": 0, "alert_categories": [], "alert_formats": [], "alert_international_only": False, "alert_skip_student_only": False},
                                  now - timedelta(days=1), now + timedelta(minutes=1))
    assert rows == []


def test_adding_twice_returns_the_same_one(client):
    first = client.post("/me/add", headers=KEY, json=candidate()).json()
    second = client.post("/me/add", headers=KEY, json=candidate(url="https://hackerrank.com/openai-build/")).json()
    assert second["hackathon"]["id"] == first["hackathon"]["id"] and not second["created"]


def test_the_ai_check_never_hides_one_you_added(client):
    from app import db
    from pipeline import enrich

    hid = client.post("/me/add", headers=KEY, json=candidate()).json()["hackathon"]["id"]
    with db.cursor() as cur:
        cur.execute("SELECT * FROM hackathons WHERE id = %s", (hid,))
        row = cur.fetchone()
        res = enrich._validated({"is_real_hackathon": False, "summary": "x", "prize_usd": 50000, "prize_confidence": "high",
                                 "prize_notes": None, "format": "online", "categories": [], "international_ok": None,
                                 "student_only": None, "relevance_score": 50, "start_date": None, "end_date": None,
                                 "registration_deadline": None})
        enrich._apply(cur, row, res)
        cur.execute("SELECT is_hidden FROM hackathons WHERE id = %s", (hid,))
        assert cur.fetchone()["is_hidden"] is False


def test_pictures_found_while_picking_are_kept(client):
    h = client.post("/me/add", headers=KEY, json=candidate(banner_url="https://img.example/b.jpg", logo_url="https://img.example/l.png")).json()["hackathon"]
    assert h["banner_url"] == "https://img.example/b.jpg" and h["logo_url"] == "https://img.example/l.png"


def test_you_can_edit_one_you_added(client):
    hid = client.post("/me/add", headers=KEY, json=candidate()).json()["hackathon"]["id"]
    client.calls["finished"].clear()
    r = client.patch(f"/me/add/{hid}", headers=KEY, json=candidate(title="Orchestrate", prize_text="$2,400", registration_deadline="2099-10-25",
                                                                   format="hybrid", description="A 24-hour agent hackathon."))
    assert r.status_code == 200
    d = r.json()
    assert d["title"] == "Orchestrate" and d["prize_text"] == "$2,400" and d["format"] == "hybrid"
    assert d["registration_deadline"].startswith("2099-10-25") and d["description"] == "A 24-hour agent hackathon."
    assert d["summary"] == "A 24-hour agent hackathon."
    assert client.calls["finished"] == [hid]


def test_only_yours_can_be_edited_or_deleted(client):
    other = _insert_listing()
    assert client.patch(f"/me/add/{other}", headers=KEY, json=candidate()).status_code == 404
    assert client.delete(f"/me/add/{other}", headers=KEY).status_code == 404


def test_an_edit_cant_take_another_listings_link(client):
    _insert_listing()
    hid = client.post("/me/add", headers=KEY, json=candidate()).json()["hackathon"]["id"]
    r = client.patch(f"/me/add/{hid}", headers=KEY, json=candidate(url="https://devpost.com/x"))
    assert r.status_code == 409


def test_deleting_removes_it_and_your_progress(client):
    hid = client.post("/me/add", headers=KEY, json=candidate()).json()["hackathon"]["id"]
    assert client.put(f"/me/hackathons/{hid}", headers=KEY, json={"status": "saved", "note": "team"}).status_code == 200
    assert client.delete(f"/me/add/{hid}", headers=KEY).status_code == 204
    assert client.get("/hackathons").json()["items"] == []
    assert client.get("/me", headers=KEY).json()["items"] == []
    assert client.calls["published"] == 1
