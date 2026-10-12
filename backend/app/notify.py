"""Email notifications, sent with Resend after each refresh.

    python -m app.notify            # check and send whatever is due
    python -m app.notify --dry-run  # print what would be sent; change nothing
    python -m app.notify --test     # send one test email

Three kinds, each switchable in the app's Settings (my_settings):

- Alerts: hackathons that became visible since the last check and match the
  alert rules (minimum prize, categories, formats, international only, skip
  student-only). One email per run, only when something matches. The first
  run just records a starting point, so you don't get every existing listing.
- Reminders: hackathons marked Interested or Registered whose registration
  closes within reminder_days. Once per hackathon (again only if its deadline
  moves later).
- Digest: Monday mornings (UTC), the week's best new matches plus your
  deadlines in the next 7 days.

Needs RESEND_API_KEY and NOTIFY_EMAIL. With Resend's shared test sender
(onboarding@resend.dev, the default NOTIFY_FROM) mail can only go to the
address the Resend account was created with.
"""

import argparse
import html
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from . import config, db
from .categories import VETTED_SOURCES
from .main import LIST_COLUMNS, VISIBLE

log = logging.getLogger("notify")

RESEND_URL = "https://api.resend.com/emails"
DIGEST_WEEKDAY = 0  # Monday
DIGEST_FROM_HOUR = 5  # UTC; the 06:17 refresh is the first one after this

# When a hackathon appeared in the list: vetted sources (web, Unstop) only
# show up once the AI has checked them.
VISIBLE_SINCE = "(CASE WHEN source = ANY(%(vetted)s) THEN enriched_at ELSE first_seen_at END)"


@dataclass
class Email:
    subject: str
    html: str
    text: str


# ---------------------------------------------------------------- queries


def _rules_sql(s: dict) -> tuple[str, dict]:
    """SQL conditions (and params) for the alert rules in settings."""
    where, params = [], {}
    if s["alert_min_prize"]:
        where.append("prize_usd >= %(min_prize)s")
        params["min_prize"] = s["alert_min_prize"]
    if s["alert_categories"]:
        where.append("categories && %(cats)s::text[]")
        params["cats"] = s["alert_categories"]
    if s["alert_formats"]:
        where.append("format = ANY(%(formats)s)")
        params["formats"] = s["alert_formats"]
    if s["alert_international_only"]:
        where.append("international_ok IS TRUE")
    if s["alert_skip_student_only"]:
        where.append("student_only IS NOT TRUE")
    return (" AND ".join(where) or "TRUE"), params


def new_matches(cur, s: dict, since: datetime, until: datetime, limit: int = 25) -> list[dict]:
    rules, params = _rules_sql(s)
    cur.execute(
        f"""
        SELECT {LIST_COLUMNS} FROM hackathons h
        WHERE {VISIBLE} AND status IN ('open', 'upcoming') AND {rules}
          AND (registration_deadline IS NULL OR registration_deadline > %(until)s)
          AND {VISIBLE_SINCE} > %(since)s AND {VISIBLE_SINCE} <= %(until)s
          AND NOT EXISTS (SELECT 1 FROM my_hackathons m WHERE m.hackathon_id = h.id AND m.status = 'hidden')
        ORDER BY prize_usd DESC NULLS LAST, registration_deadline NULLS LAST
        LIMIT %(limit)s
        """,
        {**params, "since": since, "until": until, "limit": limit, "vetted": VETTED_SOURCES},
    )
    return cur.fetchall()


def closing_soon(cur, now: datetime, days: int, only_unreminded: bool) -> list[dict]:
    cur.execute(
        f"""
        SELECT h.*, m.status AS my_status, m.note AS my_note
        FROM (SELECT {LIST_COLUMNS} FROM hackathons) h
        JOIN my_hackathons m ON m.hackathon_id = h.id
        WHERE m.status IN ('saved', 'registered')
          AND h.registration_deadline > %(now)s
          AND h.registration_deadline <= %(now)s + make_interval(days => %(days)s)
          {"AND (m.reminded_at IS NULL OR m.reminded_at < h.registration_deadline - make_interval(days => %(days)s + 1))" if only_unreminded else ""}
        ORDER BY h.registration_deadline
        """,
        {"now": now, "days": days},
    )
    return cur.fetchall()


# ---------------------------------------------------------------- rendering


def _money(h: dict) -> str:
    if h["prize_usd"] is None:
        return "Prize TBA"
    if h["prize_usd"] == 0:
        return "Non-cash prizes"
    return f"{'≈ ' if h['prize_confidence'] == 'low' else ''}${h['prize_usd']:,.0f}"


def _closes(h: dict, now: datetime) -> str | None:
    d = h["registration_deadline"]
    if not d or d <= now:
        return None
    days = (d - now).days
    when = d.strftime("%b %-d, %H:%M UTC")
    if days <= 0:
        return f"Closes today ({when})"
    if days == 1:
        return f"Closes tomorrow ({when})"
    return f"Closes in {days} days ({d.strftime('%b %-d')})"


_FORMAT = {"online": "Online", "in_person": "In person", "hybrid": "Hybrid", "unknown": None}


def _facts(h: dict, now: datetime) -> str:
    where = _FORMAT.get(h["format"])
    if where and h["format"] != "online" and h.get("location_text"):
        where = f"{where}, {h['location_text'].strip().rstrip(',')}"
    return " · ".join(x for x in (_money(h), _closes(h, now), where) if x)


def _card_html(h: dict, now: datetime, note: str | None = None) -> str:
    app = f"{config.APP_URL}/h/{h['id']}"
    summary = f'<p style="margin:6px 0 0;color:#4c4e78;font-size:14px;line-height:1.45">{html.escape(h["summary"])}</p>' if h.get("summary") else ""
    note_html = f'<p style="margin:6px 0 0;color:#08153c;font-size:13.5px"><b>Your note:</b> {html.escape(note)}</p>' if note else ""
    return (
        '<tr><td style="padding:14px 0;border-bottom:1px solid #e6ebf2">'
        f'<a href="{html.escape(h["source_url"])}" style="color:#0a1033;font-size:17px;font-weight:700;text-decoration:none">{html.escape(h["title"])}</a>'
        f'<p style="margin:4px 0 0;color:#017c91;font-size:14px;font-weight:600">{html.escape(_facts(h, now))}</p>'
        f"{summary}{note_html}"
        f'<p style="margin:8px 0 0;font-size:13px"><a href="{html.escape(h["source_url"])}" style="color:#017c91">Hackathon page</a>'
        f' &nbsp;·&nbsp; <a href="{app}" style="color:#5a6390">Open in Hackathon Radar</a></p>'
        "</td></tr>"
    )


def _card_text(h: dict, now: datetime, note: str | None = None) -> str:
    lines = [h["title"], _facts(h, now)]
    if h.get("summary"):
        lines.append(h["summary"])
    if note:
        lines.append(f"Your note: {note}")
    lines.append(h["source_url"])
    return "\n".join(lines)


def _layout(heading: str, intro: str, sections: list[tuple[str | None, str]]) -> str:
    body = "".join(
        (f'<h2 style="margin:26px 0 4px;font-size:15px;color:#5a6390;text-transform:uppercase;letter-spacing:.04em">{html.escape(t)}</h2>' if t else "")
        + f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'
        for t, rows in sections
    )
    settings = f"{config.APP_URL}/settings"
    return (
        '<div style="background:#f1f9fc;padding:24px 12px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
        '<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e6ebf2;border-radius:14px;padding:24px">'
        f'<p style="margin:0;color:#017c91;font-size:13px;font-weight:700;letter-spacing:.04em">HACKATHON RADAR</p>'
        f'<h1 style="margin:6px 0 4px;font-size:22px;color:#0a1033">{html.escape(heading)}</h1>'
        f'<p style="margin:0;color:#4c4e78;font-size:14.5px">{html.escape(intro)}</p>'
        f"{body}"
        f'<p style="margin:24px 0 0;color:#8a90b0;font-size:12px">Change what you get in <a href="{settings}" style="color:#5a6390">Settings</a>.</p>'
        "</div></div>"
    )


def alert_email(rows: list[dict], now: datetime) -> Email:
    n = len(rows)
    subject = f"{n} new hackathon{'s' if n != 1 else ''}: {rows[0]['title']}" + (f" and {n - 1} more" if n > 1 else "")
    intro = "New since the last check, matching your alert rules. Biggest prizes first."
    html_body = _layout(f"{n} new hackathon{'s' if n != 1 else ''}", intro, [(None, "".join(_card_html(h, now) for h in rows))])
    text = intro + "\n\n" + "\n\n".join(_card_text(h, now) for h in rows)
    return Email(subject, html_body, text)


def reminder_email(rows: list[dict], now: datetime) -> Email:
    first = rows[0]
    subject = f"Closing soon: {first['title']}" + (f" and {len(rows) - 1} more" if len(rows) > 1 else "")
    intro = "Registration closes soon for hackathons you're tracking."
    cards = "".join(_card_html(h, now, h.get("my_note")) for h in rows)
    text = intro + "\n\n" + "\n\n".join(_card_text(h, now, h.get("my_note")) for h in rows)
    return Email(subject, _layout("Closing soon", intro, [(None, cards)]), text)


def digest_email(new: list[dict], deadlines: list[dict], now: datetime) -> Email:
    sections, text = [], []
    if deadlines:
        sections.append(("Your deadlines this week", "".join(_card_html(h, now, h.get("my_note")) for h in deadlines)))
        text.append("YOUR DEADLINES THIS WEEK\n\n" + "\n\n".join(_card_text(h, now, h.get("my_note")) for h in deadlines))
    if new:
        sections.append(("New this week", "".join(_card_html(h, now) for h in new)))
        text.append("NEW THIS WEEK\n\n" + "\n\n".join(_card_text(h, now) for h in new))
    bits = []
    if new:
        bits.append(f"{len(new)} new")
    if deadlines:
        bits.append(f"{len(deadlines)} deadline{'s' if len(deadlines) != 1 else ''}")
    subject = f"Your week in hackathons: {', '.join(bits)}"
    intro = f"Week of {now.strftime('%b %-d')}."
    return Email(subject, _layout("Your week in hackathons", intro, sections), intro + "\n\n" + "\n\n".join(text))


# ---------------------------------------------------------------- sending


def send(email: Email) -> None:
    r = httpx.post(
        RESEND_URL,
        headers={"Authorization": f"Bearer {config.RESEND_API_KEY}"},
        json={"from": config.NOTIFY_FROM, "to": [config.NOTIFY_EMAIL], "subject": email.subject, "html": email.html, "text": email.text},
        timeout=30,
    )
    if r.status_code >= 400:
        raise RuntimeError(f"Resend answered {r.status_code}: {r.text[:300]}")
    log.info("sent: %s", email.subject)


def run(conn, now: datetime | None = None, deliver=send, dry_run: bool = False) -> list[Email]:
    """Send whatever is due. Each kind is recorded as done only after its email is sent."""
    now = now or datetime.now(timezone.utc)
    sent: list[Email] = []

    def out(email: Email) -> None:
        if dry_run:
            print(f"--- {email.subject}\n{email.text}\n")
        else:
            deliver(email)
        sent.append(email)

    with conn.cursor() as cur:
        cur.execute("SELECT * FROM my_settings WHERE id = 1")
        s = cur.fetchone()
    if s is None:
        log.info("no settings row yet; nothing to do")
        return sent

    # Alerts
    if s["alerts_enabled"]:
        if s["last_alert_at"] is None:
            log.info("alerts: first run, starting from now")
        else:
            with conn.cursor() as cur:
                rows = new_matches(cur, s, s["last_alert_at"], now)
            if rows:
                out(alert_email(rows, now))
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute("UPDATE my_settings SET last_alert_at = %s WHERE id = 1", (now,))
            conn.commit()

    # Reminders
    if s["reminders_enabled"]:
        with conn.cursor() as cur:
            rows = closing_soon(cur, now, s["reminder_days"], only_unreminded=True)
        if rows:
            out(reminder_email(rows, now))
            if not dry_run:
                with conn.cursor() as cur:
                    cur.execute("UPDATE my_hackathons SET reminded_at = %s WHERE hackathon_id = ANY(%s)", (now, [r["id"] for r in rows]))
                conn.commit()

    # Weekly digest
    due = now.weekday() == DIGEST_WEEKDAY and now.hour >= DIGEST_FROM_HOUR
    fresh = s["last_digest_at"] is None or s["last_digest_at"] < now - timedelta(days=6)
    if s["digest_enabled"] and due and fresh:
        with conn.cursor() as cur:
            new = new_matches(cur, s, now - timedelta(days=7), now, limit=10)
            deadlines = closing_soon(cur, now, 7, only_unreminded=False)
        if new or deadlines:
            out(digest_email(new, deadlines, now))
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute("UPDATE my_settings SET last_digest_at = %s WHERE id = 1", (now,))
            conn.commit()
    return sent


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print what would be sent; change nothing")
    ap.add_argument("--test", action="store_true", help="send one test email")
    args = ap.parse_args()

    if not args.dry_run and not (config.RESEND_API_KEY and config.NOTIFY_EMAIL):
        print("::warning::RESEND_API_KEY or NOTIFY_EMAIL is not set; skipping emails (see README > Emails).")
        return
    if args.test:
        intro = "If you're reading this, Hackathon Radar can email you. Alerts, reminders and the digest are set up in the app's Settings."
        send(Email("Hackathon Radar test email", _layout("It works", intro, []), intro))
        return

    conn = db.connect()
    try:
        db.migrate(conn)
        sent = run(conn, dry_run=args.dry_run)
        log.info("notify done: %d email(s)%s", len(sent), " (dry run)" if args.dry_run else "")
    except Exception:
        log.exception("notify failed")
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
