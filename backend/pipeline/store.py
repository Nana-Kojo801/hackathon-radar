"""Upsert normalized listings into Postgres, applying dedupe."""

import json
import logging

from psycopg.types.json import Jsonb

from . import dedupe
from .normalize import Normalized

log = logging.getLogger(__name__)


def _hints(n: Normalized) -> dict:
    r = n.raw
    return {
        k: v
        for k, v in {
            "prize_usd": r.prize_usd,
            "prize_confidence": r.prize_confidence,
            "format": r.format,
            "categories": r.categories or None,
            "international_ok": r.international_ok,
            "student_only": r.student_only,
        }.items()
        if v is not None
    }


def _fields(n: Normalized) -> dict:
    r = n.raw
    return {
        "source": r.source,
        "source_url": n.source_url,
        "title": r.title,
        "title_key": n.title_key,
        "organizer": r.organizer,
        "description": r.description,
        "prize_text": r.prize_text,
        "prize_usd": r.prize_usd,
        "location_text": r.location_text,
        "start_date": r.start_date,
        "end_date": r.end_date,
        "registration_deadline": r.registration_deadline,
    }


def _insert(cur, n: Normalized) -> None:
    r = n.raw
    cur.execute(
        """
        INSERT INTO hackathons (
            source, source_url, title, title_key, organizer, description_raw, image_url, icon_url, banner_url,
            prize_text, prize_usd, prize_confidence, format, location_text, categories,
            international_ok, student_only, start_date, end_date, registration_deadline,
            dates_text, content_hash, hints, raw_payload, prizes
        ) VALUES (
            %(source)s, %(url)s, %(title)s, %(key)s, %(org)s, %(desc)s, %(img)s, %(icon)s, %(banner)s,
            %(prize_text)s, %(prize_usd)s, %(prize_conf)s, %(format)s, %(loc)s, %(cats)s,
            %(intl)s, %(student)s, %(start)s, %(end)s, %(deadline)s,
            %(dates_text)s, %(hash)s, %(hints)s, %(raw)s, %(prizes)s
        )
        """,
        {
            "source": r.source, "url": n.source_url, "title": r.title, "key": n.title_key,
            "org": r.organizer, "desc": r.description, "img": r.image_url,
            "icon": r.icon_url, "banner": r.banner_url,
            "prize_text": r.prize_text, "prize_usd": r.prize_usd,
            "prize_conf": r.prize_confidence if r.prize_usd is not None else None,
            "format": r.format or "unknown", "loc": r.location_text, "cats": r.categories,
            "intl": r.international_ok, "student": r.student_only,
            "start": r.start_date, "end": r.end_date, "deadline": r.registration_deadline,
            "dates_text": r.dates_text, "hash": n.content_hash, "hints": Jsonb(_hints(n)),
            "raw": Jsonb(r.raw_payload, dumps=_dumps), "prizes": Jsonb(r.prizes),
        },
    )


def _dumps(obj) -> str:
    return json.dumps(obj, default=str)


def _update_primary(cur, row: dict, n: Normalized) -> None:
    """Refresh a row from its own (primary) source."""
    r = n.raw
    cur.execute(
        """
        UPDATE hackathons SET
            source = %(source)s,
            source_url = %(url)s,
            alt_urls = array_remove(alt_urls, %(url)s),
            title = %(title)s,
            title_key = %(key)s,
            organizer = COALESCE(%(org)s, organizer),
            description_raw = COALESCE(%(desc)s, description_raw),
            image_url = COALESCE(%(img)s, image_url),
            icon_url = COALESCE(%(icon)s, icon_url),
            banner_url = COALESCE(%(banner)s, banner_url),
            prize_text = %(prize_text)s,
            -- Structured prize/format from the source beat AI guesses.
            prize_usd = COALESCE(%(prize_usd)s, prize_usd),
            prize_confidence = CASE WHEN %(prize_usd)s::numeric IS NOT NULL
                                    THEN %(prize_conf)s ELSE prize_confidence END,
            format = COALESCE(%(format)s, format),
            location_text = COALESCE(%(loc)s, location_text),
            categories = CASE WHEN enriched_at IS NULL AND cardinality(%(cats)s::text[]) > 0
                              THEN %(cats)s::text[] ELSE categories END,
            international_ok = COALESCE(international_ok, %(intl)s),
            student_only = COALESCE(%(student)s, student_only),
            start_date = COALESCE(%(start)s, start_date),
            end_date = COALESCE(%(end)s, end_date),
            registration_deadline = COALESCE(%(deadline)s, registration_deadline),
            dates_text = COALESCE(%(dates_text)s, dates_text),
            enrich_attempts = CASE WHEN content_hash = %(hash)s THEN enrich_attempts ELSE 0 END,
            -- Changed listing: fetch its own page again on the next detail step.
            details_fetched_at = CASE WHEN content_hash = %(hash)s THEN details_fetched_at ELSE NULL END,
            prizes = CASE WHEN jsonb_array_length(%(prizes)s) > 0 THEN %(prizes)s ELSE prizes END,
            content_hash = %(hash)s,
            hints = %(hints)s,
            raw_payload = %(raw)s,
            last_seen_at = now()
        WHERE id = %(id)s
        """,
        {
            "id": row["id"], "source": r.source, "url": n.source_url, "title": r.title,
            "key": n.title_key, "org": r.organizer, "desc": r.description, "img": r.image_url,
            "icon": r.icon_url, "banner": r.banner_url,
            "prize_text": r.prize_text, "prize_usd": r.prize_usd,
            "prize_conf": r.prize_confidence or "high", "format": r.format,
            "loc": r.location_text, "cats": r.categories, "intl": r.international_ok,
            "student": r.student_only, "start": r.start_date, "end": r.end_date,
            "deadline": r.registration_deadline, "dates_text": r.dates_text,
            "hash": n.content_hash, "hints": Jsonb(_hints(n)),
            "raw": Jsonb(r.raw_payload, dumps=_dumps), "prizes": Jsonb(r.prizes),
        },
    )


def _merge_secondary(cur, row: dict, n: Normalized) -> None:
    """A poorer source saw the same hackathon: remember its URL, fill gaps only."""
    r = n.raw
    cur.execute(
        """
        UPDATE hackathons SET
            alt_urls = CASE WHEN %(url)s = ANY(alt_urls) OR source_url = %(url)s
                            THEN alt_urls ELSE array_append(alt_urls, %(url)s) END,
            organizer = COALESCE(organizer, %(org)s),
            prize_text = COALESCE(prize_text, %(prize_text)s),
            prize_usd = COALESCE(prize_usd, %(prize_usd)s),
            location_text = COALESCE(location_text, %(loc)s),
            start_date = COALESCE(start_date, %(start)s),
            end_date = COALESCE(end_date, %(end)s),
            registration_deadline = COALESCE(registration_deadline, %(deadline)s),
            student_only = COALESCE(student_only, %(student)s),
            icon_url = COALESCE(icon_url, %(icon)s),
            banner_url = COALESCE(banner_url, %(banner)s),
            last_seen_at = now()
        WHERE id = %(id)s
        """,
        {
            "id": row["id"], "url": n.source_url, "org": r.organizer, "icon": r.icon_url, "banner": r.banner_url,
            "prize_text": r.prize_text, "prize_usd": r.prize_usd, "loc": r.location_text,
            "start": r.start_date, "end": r.end_date, "deadline": r.registration_deadline,
            "student": r.student_only,
        },
    )


def upsert(cur, n: Normalized) -> str:
    """Returns 'new', 'updated' or 'merged'."""
    prio = dedupe.SOURCE_PRIORITY.get(n.raw.source, 0)
    row = dedupe.find_by_url(cur, n.source_url)
    if row:
        own = row["source"] == n.raw.source or prio > dedupe.SOURCE_PRIORITY.get(row["source"], 0)
        if row["source_url"] == n.source_url and own:
            _update_primary(cur, row, n)
            return "updated"
        _merge_secondary(cur, row, n)
        return "merged"

    row = dedupe.find_by_title(cur, n)
    if row:
        existing = {**row, "description": row["description_raw"]}
        # A poorer source (e.g. a web find) never replaces a platform record.
        if (prio >= dedupe.SOURCE_PRIORITY.get(row["source"], 0)
                and dedupe.richness(_fields(n)) > dedupe.richness(existing)):
            # The new source is richer: it becomes the primary record.
            cur.execute(
                "UPDATE hackathons SET alt_urls = array_append(array_remove(alt_urls, source_url), source_url)"
                " WHERE id = %s",
                (row["id"],),
            )
            _update_primary(cur, row, n)
        else:
            _merge_secondary(cur, row, n)
        return "merged"

    _insert(cur, n)
    return "new"


def refresh_statuses(cur) -> None:
    """Recompute status from dates. Registration closed counts as ended:
    for a discovery tool, an event you can no longer join is over."""
    cur.execute(
        """
        UPDATE hackathons SET status = CASE
            WHEN COALESCE(end_date, start_date) < now() THEN 'ended'
            WHEN registration_deadline < now() THEN 'ended'
            WHEN start_date > now() THEN 'upcoming'
            WHEN start_date IS NULL AND end_date IS NULL AND registration_deadline IS NULL
                 AND last_seen_at < now() - interval '30 days' THEN 'ended'
            ELSE 'open'
        END
        """
    )
