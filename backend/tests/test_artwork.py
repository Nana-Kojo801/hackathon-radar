"""Artwork step: covers and organizer logos for listings without an image.

The page parser runs everywhere; the step itself needs TEST_DATABASE_URL and
has the network stubbed out."""

import os

import pytest

from pipeline import artwork

PAGE = """<html><head>
<meta property="og:image" content="/img/cover.png">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="https://cdn.example.org/touch.png" sizes="180x180">
<link rel="icon" href="data:;base64,AAA=">
<script type="application/ld+json">{"@type": "Organization", "logo": {"url": "https://example.org/logo.png"}}</script>
</head><body></body></html>"""


def test_head_parser_finds_images_icons_and_logos():
    head = artwork._Head()
    head.feed(PAGE)
    assert head.images == ["/img/cover.png"]
    assert (180, "https://cdn.example.org/touch.png") in head.icons and (32, "/favicon-32.png") in head.icons
    assert all(not u.startswith("data:") for _, u in head.icons)
    assert head.logos == ["https://example.org/logo.png"]


def test_aggregators_are_recognised():
    assert artwork._is_aggregator("https://hackathonhub.eu/events/x")
    assert artwork._is_aggregator("https://foo.devpost.com/")
    assert not artwork._is_aggregator("https://qhack.ai/prizes")


db_only = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture()
def conn(monkeypatch):
    from app import config, db

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    c = db.connect()
    db.migrate(c)
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages, organizer_sites CASCADE")
        cur.execute("INSERT INTO organizer_sites (name, domain) VALUES ('Xanadu', 'xanadu.ai')")
    c.commit()
    yield c
    c.close()


def add(conn, title, url, **kw):
    cols = dict(source="web", source_url=url, title=title, title_key=title.lower(), content_hash="x", status="open")
    cols.update(kw)
    with conn.cursor() as cur:
        cur.execute(f"INSERT INTO hackathons ({', '.join(cols)}) VALUES ({', '.join(f'%({k})s' for k in cols)}) RETURNING id", cols)
        hid = cur.fetchone()["id"]
    conn.commit()
    return hid


@db_only
def test_step_keeps_event_covers_and_drops_generic_ones(conn, monkeypatch):
    qhack = add(conn, "QHack", "https://qhack.ai/", organizer="Xanadu")
    hub1 = add(conn, "Hub One", "https://hackathonhub.eu/events/one")
    hub2 = add(conn, "Hub Two", "https://hackathonhub.eu/events/two")
    has_image = add(conn, "Has Image", "https://x.example/", image_url="https://x.example/real.png")
    seen_domains = []

    def fake_find(http, row, org_domain):
        seen_domains.append(org_domain)
        if row["title"] == "QHack":
            return {"page_image_url": "https://qhack.ai/og.png", "logo_url": "https://xanadu.ai/icon-512.png"}
        # The aggregator gives every event the same share image and its own icon.
        return {"page_image_url": "https://hackathonhub.eu/og-image.png", "logo_url": "https://hackathonhub.eu/touch.png"}

    monkeypatch.setattr(artwork, "find_artwork", fake_find)
    stats = artwork.run_artwork(conn)
    assert stats["candidates"] == 3 and "xanadu.ai" in seen_domains

    with conn.cursor() as cur:
        cur.execute("SELECT id, page_image_url, logo_url, artwork_attempts FROM hackathons")
        rows = {r["id"]: r for r in cur.fetchall()}
    assert rows[qhack]["page_image_url"] == "https://qhack.ai/og.png"
    assert rows[qhack]["logo_url"] == "https://xanadu.ai/icon-512.png"
    for hid in (hub1, hub2):
        assert rows[hid]["page_image_url"] is None and rows[hid]["logo_url"] is None
        assert rows[hid]["artwork_attempts"] == 1
    assert rows[has_image]["page_image_url"] is None

    # Nothing is re-read right away.
    assert artwork.run_artwork(conn)["candidates"] == 0


@db_only
def test_api_uses_the_found_cover_and_logo(conn, monkeypatch):
    from fastapi.testclient import TestClient

    from app import config, db
    from app.main import app

    hid = add(conn, "QHack", "https://qhack.ai/", page_image_url="https://qhack.ai/og.png", logo_url="https://xanadu.ai/i.png")
    placeholder = add(conn, "Placeholder", "https://p.example/", image_url="https://d.devpost.com/thumbnail-placeholder.png",
                      logo_url="https://p.example/i.png")
    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    monkeypatch.setattr(db, "_pool", None)
    with TestClient(app) as client:
        h = client.get(f"/hackathons/{hid}").json()
        p = client.get(f"/hackathons/{placeholder}").json()
    db.pool().close()
    assert h["image_url"] == "https://qhack.ai/og.png" and h["logo_url"] == "https://xanadu.ai/i.png"
    assert p["image_url"].endswith("thumbnail-placeholder.png") and p["logo_url"] == "https://p.example/i.png"
