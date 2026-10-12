"""Personal tracking API: saved hackathons, stages, notes, "not interested",
and the email settings.

The app has one user and no accounts. Every route here needs the personal key
(env PERSONAL_KEY, or ADMIN_TOKEN when that's unset) in the X-Personal-Key
header; each device stores it once. The public hackathon data stays open.
"""

import secrets
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from . import config, db
from .categories import CATEGORIES, FORMATS

Status = Literal["saved", "registered", "submitted", "won", "not_placed", "hidden"]

ITEM_COLUMNS = """
    m.hackathon_id, m.status, m.note, m.updated_at,
    h.id, h.source, h.source_url, h.alt_urls, h.title, h.organizer, h.summary, h.image_url,
    h.prize_text, h.prize_usd::float AS prize_usd, h.prize_confidence, h.prize_notes,
    h.format, h.location_text, h.categories, h.international_ok, h.student_only,
    h.start_date, h.end_date, h.registration_deadline, h.status AS event_status, h.relevance_score,
    h.first_seen_at, h.last_seen_at, (h.enriched_at IS NOT NULL) AS enriched
"""
HACKATHON_KEYS = (
    "id", "source", "source_url", "alt_urls", "title", "organizer", "summary", "image_url",
    "prize_text", "prize_usd", "prize_confidence", "prize_notes", "format", "location_text",
    "categories", "international_ok", "student_only", "start_date", "end_date",
    "registration_deadline", "relevance_score", "first_seen_at", "last_seen_at", "enriched",
)
SETTINGS_COLUMNS = """
    alerts_enabled, alert_min_prize::float AS alert_min_prize, alert_categories, alert_formats,
    alert_international_only, alert_skip_student_only, reminders_enabled, reminder_days,
    digest_enabled, last_alert_at, last_digest_at, updated_at
"""


def require_key(x_personal_key: Annotated[str | None, Header()] = None) -> None:
    key = config.PERSONAL_KEY
    if not key:
        raise HTTPException(503, "personal features are off: set PERSONAL_KEY on the server")
    if not x_personal_key or not secrets.compare_digest(x_personal_key, key):
        raise HTTPException(401, "wrong personal key")


router = APIRouter(prefix="/me", dependencies=[Depends(require_key)])


def _item(row: dict) -> dict:
    h = {k: row[k] for k in HACKATHON_KEYS}
    h["status"] = row["event_status"]
    return {"hackathon_id": row["hackathon_id"], "status": row["status"], "note": row["note"],
            "updated_at": row["updated_at"], "hackathon": h}


def _settings(cur) -> dict:
    cur.execute(f"SELECT {SETTINGS_COLUMNS} FROM my_settings WHERE id = 1")
    row = cur.fetchone()
    if row is None:  # migration seeds it; recreate if someone deleted it
        cur.execute("INSERT INTO my_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        cur.execute(f"SELECT {SETTINGS_COLUMNS} FROM my_settings WHERE id = 1")
        row = cur.fetchone()
    return row


@router.get("")
def get_me() -> dict:
    """Everything personal: tracked hackathons (any event status, ended included) and settings."""
    with db.cursor() as cur:
        cur.execute(
            f"SELECT {ITEM_COLUMNS} FROM my_hackathons m JOIN hackathons h ON h.id = m.hackathon_id"
            " ORDER BY m.updated_at DESC"
        )
        items = [_item(r) for r in cur.fetchall()]
        settings = _settings(cur)
    return {"items": items, "settings": settings}


class TrackBody(BaseModel):
    status: Status | None = None
    note: str = Field(default="", max_length=5000)


@router.put("/hackathons/{hackathon_id}")
def track(hackathon_id: UUID, body: TrackBody) -> dict:
    """Set a hackathon's stage and note. No stage and an empty note removes it."""
    note = body.note.strip()
    with db.cursor() as cur:
        cur.execute("SELECT 1 FROM hackathons WHERE id = %s", (hackathon_id,))
        if cur.fetchone() is None:
            raise HTTPException(404, "hackathon not found")
        if body.status is None and not note:
            cur.execute("DELETE FROM my_hackathons WHERE hackathon_id = %s", (hackathon_id,))
            return {"hackathon_id": hackathon_id, "status": None, "note": "", "removed": True}
        cur.execute(
            """
            INSERT INTO my_hackathons (hackathon_id, status, note) VALUES (%s, %s, %s)
            ON CONFLICT (hackathon_id) DO UPDATE SET
                status = EXCLUDED.status, note = EXCLUDED.note, updated_at = now()
            RETURNING hackathon_id
            """,
            (hackathon_id, body.status, note),
        )
        cur.execute(
            f"SELECT {ITEM_COLUMNS} FROM my_hackathons m JOIN hackathons h ON h.id = m.hackathon_id"
            " WHERE m.hackathon_id = %s",
            (hackathon_id,),
        )
        return _item(cur.fetchone())


class SettingsBody(BaseModel):
    alerts_enabled: bool | None = None
    alert_min_prize: float | None = Field(default=None, ge=0, le=100_000_000)
    alert_categories: list[str] | None = None
    alert_formats: list[str] | None = None
    alert_international_only: bool | None = None
    alert_skip_student_only: bool | None = None
    reminders_enabled: bool | None = None
    reminder_days: int | None = Field(default=None, ge=1, le=14)
    digest_enabled: bool | None = None


@router.put("/settings")
def update_settings(body: SettingsBody) -> dict:
    changes = body.model_dump(exclude_none=True)
    bad = [c for c in changes.get("alert_categories", []) if c not in CATEGORIES]
    bad += [f for f in changes.get("alert_formats", []) if f not in FORMATS]
    if bad:
        raise HTTPException(422, f"unknown values: {', '.join(bad)}")
    with db.cursor() as cur:
        if changes:
            assignments = ", ".join(f"{k} = %({k})s" for k in changes)
            cur.execute(f"UPDATE my_settings SET {assignments}, updated_at = now() WHERE id = 1", changes)
        return _settings(cur)
