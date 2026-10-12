"""Email notifications (alerts, reminders, digest). Needs TEST_DATABASE_URL; nothing is really sent."""

import os
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skipif(not os.getenv("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

# A Monday, 06:17 UTC: when the digest is due.
NOW = datetime(2026, 10, 12, 6, 17, tzinfo=timezone.utc)


@pytest.fixture()
def conn(monkeypatch):
    from app import config, db

    monkeypatch.setattr(config, "DATABASE_URL", os.environ["TEST_DATABASE_URL"])
    c = db.connect()
    db.migrate(c)
    with c.cursor() as cur:
        cur.execute("TRUNCATE hackathons, source_runs, discovered_pages CASCADE")
        cur.execute("DELETE FROM my_settings")
        cur.execute("INSERT INTO my_settings (id, digest_enabled) VALUES (1, false)")
    c.commit()
    yield c
    c.close()


def add(conn, title, *, prize=20000.0, seen=None, deadline=None, source="devpost", enriched=True, **kw):
    cols = dict(source=source, source_url=f"https://{title.replace(' ', '-').lower()}.example/", title=title,
                title_key=title.lower(), content_hash="x", status="open", prize_usd=prize,
                first_seen_at=seen or NOW - timedelta(hours=1), registration_deadline=deadline,
                enriched_at=(seen or NOW - timedelta(hours=1)) if enriched else None, summary=f"About {title}.")
    cols.update(kw)
    names = ", ".join(cols)
    marks = ", ".join(f"%({k})s" for k in cols)
    with conn.cursor() as cur:
        cur.execute(f"INSERT INTO hackathons ({names}) VALUES ({marks}) RETURNING id", cols)
        hid = cur.fetchone()["id"]
    conn.commit()
    return hid


def settings(conn, **kw):
    with conn.cursor() as cur:
        cur.execute("UPDATE my_settings SET " + ", ".join(f"{k} = %({k})s" for k in kw) + " WHERE id = 1", kw)
    conn.commit()


def run(conn, now=NOW):
    from app import notify

    sent = []
    notify.run(conn, now=now, deliver=sent.append)
    return sent


def test_first_run_sets_a_baseline_then_alerts_on_new_matches(conn):
    add(conn, "Old Hack", seen=NOW - timedelta(days=3))
    assert run(conn, NOW - timedelta(days=1)) == []  # baseline only

    add(conn, "Big New Hack", prize=50000.0)
    add(conn, "Small New Hack", prize=500.0)  # below the default $5,000 minimum
    add(conn, "Mystery Prize Hack", prize=None)  # unknown prize doesn't pass a minimum
    add(conn, "Closed Hack", prize=90000.0, deadline=NOW - timedelta(hours=2))  # registration already closed
    sent = run(conn)
    assert len(sent) == 1
    assert "Big New Hack" in sent[0].text and "Small New Hack" not in sent[0].text
    assert "Old Hack" not in sent[0].text and "Mystery" not in sent[0].text and "Closed Hack" not in sent[0].text
    assert sent[0].subject.startswith("1 new hackathon: Big New Hack")
    # Nothing new since: no second email.
    assert run(conn, NOW + timedelta(hours=6)) == []


def test_alert_rules_and_hidden(conn):
    settings(conn, last_alert_at=NOW - timedelta(days=1), alert_min_prize=0, alert_categories=["AI/ML"],
             alert_skip_student_only=True, alert_international_only=True)
    add(conn, "AI Global", categories=["AI/ML"], international_ok=True)
    add(conn, "AI Students", categories=["AI/ML"], international_ok=True, student_only=True)
    add(conn, "AI Regional", categories=["AI/ML"], international_ok=False)
    add(conn, "Web Only", categories=["web"], international_ok=True)
    hidden = add(conn, "AI Hidden", categories=["AI/ML"], international_ok=True)
    with conn.cursor() as cur:
        cur.execute("INSERT INTO my_hackathons (hackathon_id, status) VALUES (%s, 'hidden')", (hidden,))
    conn.commit()
    sent = run(conn)
    assert len(sent) == 1
    text = sent[0].text
    assert "AI Global" in text
    for other in ("AI Students", "AI Regional", "Web Only", "AI Hidden"):
        assert other not in text


def test_vetted_sources_count_from_when_they_became_visible(conn):
    settings(conn, last_alert_at=NOW - timedelta(hours=6))
    # Found two days ago, but the AI only confirmed it just now, so it's news now.
    hid = add(conn, "Unstop Hack", source="unstop", seen=NOW - timedelta(days=2))
    with conn.cursor() as cur:
        cur.execute("UPDATE hackathons SET enriched_at = %s WHERE id = %s", (NOW - timedelta(minutes=5), hid))
    conn.commit()
    add(conn, "Unvetted Hack", source="unstop", enriched=False)
    sent = run(conn)
    assert len(sent) == 1 and "Unstop Hack" in sent[0].text and "Unvetted" not in sent[0].text


def test_reminders_go_out_once(conn):
    settings(conn, alerts_enabled=False, reminder_days=2)
    soon = add(conn, "Closing Hack", deadline=NOW + timedelta(days=1))
    later = add(conn, "Later Hack", deadline=NOW + timedelta(days=10))
    untracked = add(conn, "Untracked Hack", deadline=NOW + timedelta(days=1))
    submitted = add(conn, "Done Hack", deadline=NOW + timedelta(days=1))
    with conn.cursor() as cur:
        for hid, status in ((soon, "registered"), (later, "saved"), (submitted, "submitted")):
            cur.execute("INSERT INTO my_hackathons (hackathon_id, status, note) VALUES (%s, %s, 'bring Kofi')", (hid, status))
    conn.commit()
    assert untracked
    sent = run(conn)
    assert len(sent) == 1
    assert sent[0].subject == "Closing soon: Closing Hack"
    assert "bring Kofi" in sent[0].text and "Later Hack" not in sent[0].text and "Done Hack" not in sent[0].text
    assert run(conn, NOW + timedelta(hours=6)) == []


def test_digest_on_monday_once(conn):
    settings(conn, alerts_enabled=False, reminders_enabled=False, digest_enabled=True, alert_min_prize=0)
    add(conn, "Week Hack", seen=NOW - timedelta(days=3))
    tracked = add(conn, "Tracked Hack", deadline=NOW + timedelta(days=4))
    with conn.cursor() as cur:
        cur.execute("INSERT INTO my_hackathons (hackathon_id, status) VALUES (%s, 'saved')", (tracked,))
    conn.commit()
    assert run(conn, NOW - timedelta(days=1)) == []  # Sunday: not due
    sent = run(conn)
    assert len(sent) == 1 and sent[0].subject.startswith("Your week in hackathons")
    assert "YOUR DEADLINES THIS WEEK" in sent[0].text and "Tracked Hack" in sent[0].text and "Week Hack" in sent[0].text
    assert run(conn, NOW + timedelta(hours=6)) == []  # already sent this week
