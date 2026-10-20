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

Push notifications (app.push) go to every device that turned them on in the
app, for the same events: new matches, big prizes over big_prize_min whatever
the rules, closing-soon reminders and an optional Monday summary. They wait
out quiet hours (in the phone's timezone) and carry the icon badge count.
Pushes need VAPID_PRIVATE_KEY; emails need RESEND_API_KEY and NOTIFY_EMAIL.
Either works without the other.

With Resend's shared test sender
(onboarding@resend.dev, the default NOTIFY_FROM) mail can only go to the
address the Resend account was created with.
"""

import argparse
import html
import logging
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from . import config, db
from .push import Push, send_to, subscriptions
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


def _thumb(h: dict) -> str:
    img = h.get("image_url") or ""
    if img and "thumbnail-placeholder" not in img:
        return (f'<img src="{html.escape(img)}" width="56" height="56" alt="" '
                'style="display:block;width:56px;height:56px;border-radius:13px;object-fit:cover;border:0">')
    return ('<div style="width:56px;height:56px;border-radius:13px;background:#2F6BFF;'
            'background-image:linear-gradient(145deg,#7B61FF,#2F6BFF);color:#fff;font-size:24px;line-height:56px;text-align:center">&#10022;</div>')


def _card_html(h: dict, now: datetime, note: str | None = None) -> str:
    app = f"{config.APP_URL}/h/{h['id']}"
    closes = _closes(h, now)
    note_html = (f'<p style="margin:10px 0 0;padding:8px 10px;background:#f4f4f7;border-radius:10px;color:#3a3a3c;font-size:13.5px;line-height:1.4">'
                 f'{html.escape(note)}</p>') if note else ""
    summary = f'<p style="margin:8px 0 0;color:#6c6c70;font-size:14px;line-height:1.45">{html.escape(h["summary"])}</p>' if h.get("summary") else ""
    where = _FORMAT.get(h["format"]) or ""
    if where and h["format"] != "online" and h.get("location_text"):
        # Just the place, not a street address: "Patiala, Punjab, India" -> "Punjab, India".
        place = ", ".join(p.strip() for p in h["location_text"].split(",")[-2:] if p.strip())
        where = place or where
    meta = " · ".join(x for x in (h.get("organizer"), where) if x)
    return (
        '<tr><td style="padding:0 0 12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:20px">'
        '<tr><td style="padding:14px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        f'<td width="56" valign="top" style="padding-right:12px">{_thumb(h)}</td>'
        '<td valign="top">'
        f'<p style="margin:0;color:#000;font-size:17px;line-height:1.3;font-weight:600">{html.escape(h["title"])}</p>'
        + (f'<p style="margin:2px 0 0;color:#6c6c70;font-size:13px">{html.escape(meta)}</p>' if meta else "")
        + f'<p style="margin:5px 0 0;font-size:13px;color:#6c6c70"><b style="color:#000;font-size:16px">{html.escape(_money(h))}</b>'
        + (f' &nbsp;<span style="color:#c24e00;font-weight:600">{html.escape(closes)}</span>' if closes else "")
        + "</p></td></tr></table>"
        f"{summary}{note_html}"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>'
        f'<td width="50%" style="padding-right:4px"><a href="{app}" style="display:block;text-align:center;background:#0066ff;color:#fff;'
        'font-size:15px;font-weight:600;text-decoration:none;padding:11px 0;border-radius:21px">Open in app</a></td>'
        f'<td width="50%" style="padding-left:4px"><a href="{html.escape(h["source_url"])}" style="display:block;text-align:center;background:#ececf0;color:#000;'
        'font-size:15px;font-weight:600;text-decoration:none;padding:11px 0;border-radius:21px">Register</a></td>'
        "</tr></table>"
        "</td></tr></table></td></tr>"
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
        (f'<p style="margin:22px 4px 8px;font-size:13px;color:#6c6c70;text-transform:uppercase;letter-spacing:.02em">{html.escape(t)}</p>' if t else "")
        + f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'
        for t, rows in sections
    )
    settings = f"{config.APP_URL}/settings"
    return (
        '<div style="background:#f2f2f7;padding:24px 14px;font-family:-apple-system,BlinkMacSystemFont,\'SF Pro Text\',Segoe UI,Roboto,Helvetica,Arial,sans-serif">'
        '<div style="max-width:560px;margin:0 auto">'
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        '<td style="padding-right:10px"><div style="width:32px;height:32px;border-radius:8px;background:#0066ff;'
        'background-image:linear-gradient(160deg,#4d94ff,#0066ff);color:#fff;font-size:18px;line-height:32px;text-align:center">&#9678;</div></td>'
        '<td style="font-size:16px;font-weight:600;color:#000">Hackathon Radar</td></tr></table>'
        f'<h1 style="margin:20px 4px 6px;font-size:26px;line-height:1.2;color:#000;letter-spacing:-.02em">{html.escape(heading)}</h1>'
        f'<p style="margin:0 4px 16px;color:#6c6c70;font-size:15px;line-height:1.45">{html.escape(intro)}</p>'
        f"{body}"
        f'<p style="margin:20px 4px 0;color:#8e8e93;font-size:12.5px;text-align:center">Change what you get in the app under <a href="{settings}" style="color:#6c6c70">Settings</a>.</p>'
        "</div></div>"
    )


def alert_email(rows: list[dict], now: datetime) -> Email:
    n = len(rows)
    subject = f"{n} new hackathon{'s' if n != 1 else ''}: {rows[0]['title']}" + (f" and {n - 1} more" if n > 1 else "")
    intro = "New since the last check, matching your alert rules. Open one in the app to save it in a tap."
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


# ---------------------------------------------------------------- push


def _in_quiet_hours(s: dict, now: datetime) -> bool:
    if not s.get("quiet_hours_enabled"):
        return False
    try:
        tz = ZoneInfo(s.get("timezone") or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tz = timezone.utc
    hour = now.astimezone(tz).hour
    start, end = s["quiet_start"], s["quiet_end"]
    if start == end:
        return False
    return start <= hour < end if start < end else (hour >= start or hour < end)


def big_prizes(cur, s: dict, since: datetime, until: datetime, exclude: list) -> list[dict]:
    cur.execute(
        f"""
        SELECT {LIST_COLUMNS} FROM hackathons h
        WHERE {VISIBLE} AND status IN ('open', 'upcoming') AND prize_usd >= %(min)s
          AND (registration_deadline IS NULL OR registration_deadline > %(until)s)
          AND {VISIBLE_SINCE} > %(since)s AND {VISIBLE_SINCE} <= %(until)s
          AND NOT (id = ANY(%(exclude)s::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM my_hackathons m WHERE m.hackathon_id = h.id AND m.status = 'hidden')
        ORDER BY prize_usd DESC LIMIT 3
        """,
        {"min": s["big_prize_min"], "since": since, "until": until, "exclude": exclude, "vetted": VETTED_SOURCES},
    )
    return cur.fetchall()


def _short_money(h: dict) -> str:
    v = h["prize_usd"]
    if v is None:
        return "Prize TBA"
    if v >= 1_000_000:
        return f"${v / 1_000_000:.1f}M".replace(".0M", "M")
    if v >= 10_000:
        return f"${v / 1000:.0f}K"
    return _money(h)


def _days_text(h: dict, now: datetime) -> str:
    days = (h["registration_deadline"] - now).days
    return "Closes today" if days <= 0 else "Closes tomorrow" if days == 1 else f"Closes in {days} days"


def badge_count(cur, now: datetime) -> int:
    cur.execute(
        "SELECT count(*)::int AS n FROM my_hackathons m JOIN hackathons h ON h.id = m.hackathon_id"
        " WHERE m.status IN ('saved', 'registered') AND h.registration_deadline > %(now)s"
        " AND h.registration_deadline <= %(now)s + interval '7 days'",
        {"now": now},
    )
    return cur.fetchone()["n"]


def run_push(conn, now: datetime | None = None, deliver=send_to, dry_run: bool = False) -> list[Push]:
    """Push whatever is due to every subscribed device. Markers move only after a device accepts."""
    now = now or datetime.now(timezone.utc)
    sent: list[Push] = []
    with conn.cursor() as cur:
        cur.execute("SELECT * FROM my_settings WHERE id = 1")
        s = cur.fetchone()
        subs = subscriptions(cur)
    if s is None or not subs:
        return sent
    if _in_quiet_hours(s, now):
        log.info("push: quiet hours, holding notifications until the next run")
        return sent

    with conn.cursor() as cur:
        badge = badge_count(cur, now)

    def out(p: Push) -> None:
        p.badge = badge
        if dry_run:
            print(f"--- push: {p.title} | {p.body} -> {p.url}")
        else:
            with conn.cursor() as cur:
                if not deliver(subs, p, cur):
                    conn.commit()  # keep removals of dead subscriptions
                    raise RuntimeError("no device accepted the push; will retry next run")
            conn.commit()
        sent.append(p)

    since = s["last_push_at"]
    if since is None:
        log.info("push: first run, starting from now")
    else:
        with conn.cursor() as cur:
            matches = new_matches(cur, s, since, now, limit=10) if s["push_new_matches"] else []
            big = big_prizes(cur, s, since, now, [m["id"] for m in matches]) if s["push_big_prizes"] else []
        if matches:
            first = matches[0]
            if len(matches) == 1:
                out(Push(f"New match: {first['title']}", _facts(first, now), url=f"/h/{first['id']}", tag="matches"))
            else:
                names = ", ".join(f"{m['title']} ({_short_money(m)})" for m in matches[:2])
                more = f" and {len(matches) - 2} more" if len(matches) > 2 else ""
                out(Push(f"{len(matches)} new matches", f"{names}{more}.", url="/explore?new=1", tag="matches"))
        for h in big:
            out(Push(f"Big prize: {_short_money(h)}", f"{h['title']}. {_facts(h, now)}", url=f"/h/{h['id']}", tag=f"big-{h['id']}"))
    if not dry_run:
        with conn.cursor() as cur:
            cur.execute("UPDATE my_settings SET last_push_at = %s WHERE id = 1", (now,))
        conn.commit()

    if s["push_closing_soon"]:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT h.*, m.status AS my_status
                FROM (SELECT {LIST_COLUMNS} FROM hackathons) h
                JOIN my_hackathons m ON m.hackathon_id = h.id
                WHERE m.status IN ('saved', 'registered')
                  AND h.registration_deadline > %(now)s
                  AND h.registration_deadline <= %(now)s + make_interval(days => %(days)s)
                  AND (m.push_reminded_at IS NULL
                       OR m.push_reminded_at < h.registration_deadline - make_interval(days => %(days)s + 1))
                ORDER BY h.registration_deadline LIMIT 3
                """,
                {"now": now, "days": s["reminder_days"]},
            )
            rows = cur.fetchall()
        for h in rows:
            stage = "You're registered" if h["my_status"] == "registered" else "It's on your list"
            out(Push(f"{_days_text(h, now)}: {h['title']}", f"{stage}. Registration closes {h['registration_deadline'].strftime('%a %-d %b, %H:%M UTC')}.",
                     url=f"/h/{h['id']}", tag=f"closing-{h['id']}"))
            if not dry_run:
                with conn.cursor() as cur:
                    cur.execute("UPDATE my_hackathons SET push_reminded_at = %s WHERE hackathon_id = %s", (now, h["id"]))
                conn.commit()

    due = now.weekday() == DIGEST_WEEKDAY and now.hour >= DIGEST_FROM_HOUR
    fresh = s["last_push_digest_at"] is None or s["last_push_digest_at"] < now - timedelta(days=6)
    if s["push_digest"] and due and fresh:
        with conn.cursor() as cur:
            n_new = len(new_matches(cur, s, now - timedelta(days=7), now, limit=50))
            n_deadlines = len(closing_soon(cur, now, 7, only_unreminded=False))
        if n_new or n_deadlines:
            out(Push("Your week in hackathons", f"{n_new} new match{'es' if n_new != 1 else ''} · {n_deadlines} deadline{'s' if n_deadlines != 1 else ''} on your list", url="/", tag="digest"))
        if not dry_run:
            with conn.cursor() as cur:
                cur.execute("UPDATE my_settings SET last_push_digest_at = %s WHERE id = 1", (now,))
            conn.commit()
    return sent


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="print what would be sent; change nothing")
    ap.add_argument("--test", action="store_true", help="send one test email")
    args = ap.parse_args()

    email_ok = bool(config.RESEND_API_KEY and config.NOTIFY_EMAIL)
    push_ok = bool(config.VAPID_PRIVATE_KEY)
    if args.test:
        if not email_ok:
            print("::error::RESEND_API_KEY or NOTIFY_EMAIL is not set.")
            sys.exit(1)
        intro = "If you're reading this, Hackathon Radar can email you. Alerts, reminders and the digest are set up in the app's Settings."
        send(Email("Hackathon Radar test email", _layout("It works", intro, []), intro))
        return
    if not args.dry_run and not email_ok:
        print("::warning::RESEND_API_KEY or NOTIFY_EMAIL is not set; skipping emails (see README > Emails).")
    if not args.dry_run and not push_ok:
        print("::warning::VAPID_PRIVATE_KEY is not set; skipping push notifications (see README > Push notifications).")
    if not (args.dry_run or email_ok or push_ok):
        return

    conn = db.connect()
    failed = False
    try:
        db.migrate(conn)
        if args.dry_run or email_ok:
            try:
                sent = run(conn, dry_run=args.dry_run)
                log.info("emails done: %d%s", len(sent), " (dry run)" if args.dry_run else "")
            except Exception:
                conn.rollback()
                log.exception("emails failed")
                failed = True
        if args.dry_run or push_ok:
            try:
                pushed = run_push(conn, dry_run=args.dry_run)
                log.info("push done: %d%s", len(pushed), " (dry run)" if args.dry_run else "")
            except Exception:
                conn.rollback()
                log.exception("push failed")
                failed = True
    finally:
        conn.close()
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
