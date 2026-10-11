"""AI enrichment: one structured OpenAI call per new or changed listing.

Cost guards:
- only rows whose content_hash differs from enriched_hash are sent
- at most MAX_ENRICH_PER_RUN calls per run
- descriptions truncated to ~2,000 characters
- tokens logged per run (and stored in source_runs as source='enrich')
- a failed call leaves the row unenriched so the next run retries it
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from app import config
from app.categories import CATEGORIES

from . import ai
from .dates import parse_iso
from .normalize import clean_text
from .types import Source

log = logging.getLogger(__name__)

DESC_LIMIT = 2000
MAX_ATTEMPTS = 4
# Trust the big platforms on "is this a hackathon"; only web finds can be dropped.
DROPPABLE_SOURCES = {"web"}

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "summary", "prize_usd", "prize_confidence", "prize_notes", "format", "categories",
        "international_ok", "student_only", "relevance_score", "is_real_hackathon",
        "start_date", "end_date", "registration_deadline",
    ],
    "properties": {
        "summary": {"type": "string", "description": "One plain sentence: what the hackathon is about."},
        "prize_usd": {
            "type": ["number", "null"],
            "description": "Total prize pool in USD (convert other currencies approximately). Cash plus clearly valued prizes. null if unknown.",
        },
        "prize_confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "prize_notes": {
            "type": ["string", "null"],
            "description": "Short note if prizes are non-cash (credits, hardware, swag), else null.",
        },
        "format": {"type": "string", "enum": ["online", "in_person", "hybrid", "unknown"]},
        "categories": {"type": "array", "items": {"type": "string", "enum": CATEGORIES}},
        "international_ok": {
            "type": ["boolean", "null"],
            "description": "Can people from any country participate? null if not stated.",
        },
        "student_only": {
            "type": ["boolean", "null"],
            "description": "Restricted to students? null if not stated.",
        },
        "relevance_score": {"type": "integer", "description": "0-100"},
        "is_real_hackathon": {"type": "boolean"},
        "start_date": {"type": ["string", "null"], "description": "YYYY-MM-DD or null"},
        "end_date": {"type": ["string", "null"], "description": "YYYY-MM-DD or null"},
        "registration_deadline": {"type": ["string", "null"], "description": "YYYY-MM-DD or null"},
    },
}

SYSTEM = f"""You classify hackathon listings for a personal hackathon finder.
Return JSON matching the schema. Rules:
- summary: one plain sentence, no hype, max ~25 words.
- prize_usd: total prize pool as a number in USD. Convert other currencies approximately
  (e.g. INR/83, EUR*1.08, GBP*1.27). Include cash and clearly-valued prizes. null if unknown.
  prize_confidence: high if an explicit total is given, medium if you summed or converted, low if guessed.
- categories: 1-4 from the fixed list only: {", ".join(CATEGORIES)}.
  Use "open-ended" when any project is allowed.
- international_ok / student_only: only true/false when the text says so or it is obvious; otherwise null.
- relevance_score 0-100: reward clear dates, real prize pools, credible organizers, an actual
  registration page. Penalize vague listings, no prize info, spam, listicles, expired events.
- is_real_hackathon: false for blog posts, listicles, job ads, courses, generic event pages,
  or anything that is not a specific hackathon people can register for.
- dates: ISO YYYY-MM-DD if stated, else null. Don't invent dates."""


def _user_prompt(row: dict) -> str:
    today = datetime.now(timezone.utc).date().isoformat()
    lines = [
        f"Today: {today}",
        f"Source: {row['source']}",
        f"URL: {row['source_url']}",
        f"Title: {row['title']}",
        f"Organizer: {row.get('organizer') or '-'}",
        f"Prize text: {row.get('prize_text') or '-'}",
        f"Location: {row.get('location_text') or '-'}",
        f"Dates text: {row.get('dates_text') or '-'}",
    ]
    for k in ("start_date", "end_date", "registration_deadline"):
        if row.get(k):
            lines.append(f"Known {k}: {row[k].date().isoformat()}")
    if row.get("hints", {}).get("format"):
        lines.append(f"Known format: {row['hints']['format']}")
    desc = clean_text(row.get("description_detail") or row.get("description_raw"), DESC_LIMIT) or "-"
    lines.append(f"Description:\n{desc}")
    return "\n".join(lines)


def _validated(result: dict) -> dict:
    out = dict(result)
    out["categories"] = [c for c in result.get("categories") or [] if c in CATEGORIES][:5]
    try:
        score = int(result.get("relevance_score") or 0)
    except (TypeError, ValueError):
        score = 0
    out["relevance_score"] = max(0, min(100, score))
    prize = result.get("prize_usd")
    out["prize_usd"] = float(prize) if isinstance(prize, (int, float)) and prize >= 0 else None
    for k in ("start_date", "end_date", "registration_deadline"):
        out[k] = parse_iso(result.get(k))
    return out


def enrich_one(row: dict, usage: ai.Usage) -> dict:
    """One AI call for one listing. Raises on failure."""
    result = ai.chat_json(SYSTEM, _user_prompt(row), SCHEMA, "hackathon_enrichment", usage)
    return _validated(result)


def _apply(cur, row: dict, res: dict) -> None:
    hints = row.get("hints") or {}
    hint_prize = hints.get("prize_usd")
    hidden = not res["is_real_hackathon"] and row["source"] in DROPPABLE_SOURCES
    cur.execute(
        """
        UPDATE hackathons SET
            summary = %(summary)s,
            prize_usd = %(prize_usd)s,
            prize_confidence = %(prize_conf)s,
            prize_notes = %(prize_notes)s,
            format = %(format)s,
            categories = %(cats)s,
            international_ok = %(intl)s,
            student_only = %(student)s,
            relevance_score = %(score)s,
            is_hidden = is_hidden OR %(hidden)s,
            start_date = COALESCE(start_date, %(start)s),
            end_date = COALESCE(end_date, %(end)s),
            registration_deadline = COALESCE(registration_deadline, %(deadline)s),
            enriched_hash = content_hash,
            enriched_at = now(),
            enrichment_model = %(model)s,
            enrich_attempts = 0
        WHERE id = %(id)s
        """,
        {
            "id": row["id"],
            "summary": clean_text(res.get("summary"), 400),
            "prize_usd": hint_prize if hint_prize is not None else res["prize_usd"],
            "prize_conf": (hints.get("prize_confidence") or "high") if hint_prize is not None
            else res.get("prize_confidence"),
            "prize_notes": clean_text(res.get("prize_notes"), 300),
            "format": hints.get("format") or res.get("format") or "unknown",
            "cats": res["categories"] or hints.get("categories") or [],
            "intl": res["international_ok"] if res["international_ok"] is not None
            else hints.get("international_ok"),
            "student": hints["student_only"] if hints.get("student_only") is not None
            else res["student_only"],
            "score": res["relevance_score"],
            "hidden": hidden,
            "start": res["start_date"], "end": res["end_date"],
            "deadline": res["registration_deadline"],
            "model": config.OPENAI_MODEL,
        },
    )


def run_enrichment(conn, sources: dict[str, Source], limit: int | None = None) -> dict:
    limit = config.MAX_ENRICH_PER_RUN if limit is None else limit
    stats = {"candidates": 0, "enriched": 0, "failed": 0, "dropped": 0, "tokens_used": 0}
    with conn.cursor() as cur:
        cur.execute("INSERT INTO source_runs (source) VALUES ('enrich') RETURNING id")
        run_id = cur.fetchone()["id"]
    conn.commit()

    error_text = None
    try:
        ai.client()
    except ai.AIUnavailable as e:
        log.warning("enrichment skipped: %s", e)
        error_text = str(e)
        rows = []
    else:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT * FROM hackathons
                WHERE enriched_hash IS DISTINCT FROM content_hash
                  AND NOT is_hidden AND status <> 'ended' AND enrich_attempts < %s
                -- Unvetted web finds first: they stay hidden from the list until enriched,
                -- while platform listings are already usable without the AI.
                ORDER BY (enriched_at IS NULL) DESC, (source = 'web') DESC,
                         prize_usd DESC NULLS LAST, first_seen_at DESC
                LIMIT %s
                """,
                (MAX_ATTEMPTS, limit),
            )
            rows = cur.fetchall()
        conn.commit()
    stats["candidates"] = len(rows)

    usage = ai.Usage()
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [(r, pool.submit(enrich_one, r, usage)) for r in rows]
        for row, fut in futures:
            try:
                res = fut.result()
                with conn.cursor() as cur:
                    _apply(cur, row, res)
                conn.commit()
                stats["enriched"] += 1
                if not res["is_real_hackathon"] and row["source"] in DROPPABLE_SOURCES:
                    stats["dropped"] += 1
            except Exception as e:
                conn.rollback()
                stats["failed"] += 1
                error_text = f"{row['source_url']}: {type(e).__name__}: {e}"[:500]
                log.warning("enrich failed for %s: %s", row["source_url"], e)
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE hackathons SET enrich_attempts = enrich_attempts + 1 WHERE id = %s",
                        (row["id"],),
                    )
                conn.commit()

    stats["tokens_used"] = usage.total
    cost = usage.cost_usd(config.OPENAI_MODEL)
    log.info(
        "enrich: candidates=%d enriched=%d failed=%d dropped=%d tokens=%d (in=%d out=%d) est_cost=%s",
        stats["candidates"], stats["enriched"], stats["failed"], stats["dropped"], usage.total,
        usage.prompt, usage.completion, f"${cost:.4f}" if cost is not None else "n/a",
    )
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE source_runs SET finished_at = now(), fetched = %s, new = %s, errors = %s,"
            " error_text = %s, tokens_used = %s WHERE id = %s",
            (stats["candidates"], stats["enriched"], stats["failed"], error_text,
             usage.total, run_id),
        )
    conn.commit()
    return stats
