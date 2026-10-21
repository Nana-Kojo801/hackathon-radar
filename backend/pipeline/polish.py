"""Polish step: an AI-tidied description, and prizes read from the text.

Platform descriptions arrive in every shape: Devpost's plain paragraphs,
Devfolio's Markdown, Unstop's sentences broken across lines, page chrome from
web finds. This step rewrites each one into short, consistent Markdown
(headings, bullets, links) without adding facts, and, when the platform gave no
prize breakdown, lists the prizes the text mentions so the app can lay them out.

Runs after enrichment, for open listings whose description changed since it
was last polished, biggest prizes first, at most MAX_POLISH_PER_RUN per run.
A failed call is retried next run; a listing that fails 3 times waits for its
description to change. About 1.5k tokens in and 600 out per listing.
"""

import hashlib
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor

from psycopg.types.json import Jsonb

from app import config

from . import ai

log = logging.getLogger(__name__)

MAX_POLISH_PER_RUN = int(os.getenv("MAX_POLISH_PER_RUN", "40") or 40)
MAX_ATTEMPTS = 3
MIN_LENGTH = 160  # shorter ones are shown as they are
INPUT_LIMIT = 6000

SYSTEM = """You tidy hackathon descriptions for a phone app. Rewrite the text as clean Markdown.

Rules:
- Keep every fact, name, date, amount, requirement and URL exactly. Never add, guess or embellish.
- Drop page chrome and noise: navigation, cookie notices, "register now" spam, repeated titles, emoji used as bullets.
- Start with one or two plain sentences on what the hackathon is about. No heading before them.
- Then use '### ' headings only where the text has distinct parts, chosen from: Tracks, What to build, Prizes, Eligibility, Judging, How to take part, Timeline, Resources, About the organizer. Skip parts the text doesn't cover.
- Use '- ' bullets for lists. Bold sparingly with **...**.
- Under Prizes, write each prize as a person would ("- **Best AI Agent** (AI Agents track): $1,000"), never as a list of fields like "Rank: 1" or "Amount: 1000".
- Write links as [label](url). Turn bare URLs and emails into links.
- Keep the original language.
- At most about 350 words: cut repetition, never facts that matter for entering.

Also list the prizes the text names (empty when it names none): for each, the award name, its track when the text groups prizes by track, its rank (1 for first place, 2 for second, ...; null for special awards), the amount in USD as a number when stated in or clearly convertible to USD (null otherwise), the amount as written, the number of winners, and any non-cash perks."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["markdown", "prizes"],
    "properties": {
        "markdown": {"type": "string"},
        "prizes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "track", "rank", "amount_usd", "amount_text", "winners", "perks"],
                "properties": {
                    "name": {"type": "string"},
                    "track": {"type": ["string", "null"]},
                    "rank": {"type": ["integer", "null"]},
                    "amount_usd": {"type": ["number", "null"]},
                    "amount_text": {"type": ["string", "null"]},
                    "winners": {"type": "integer"},
                    "perks": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


def description_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _clean_markdown(md: str) -> str:
    md = re.sub(r"\n{3,}", "\n\n", md.strip())
    # Only http(s) and mailto links; anything else becomes plain text.
    return re.sub(r"\[([^\]]+)\]\((?!https?://|mailto:)[^)]*\)", r"\1", md)


# A prize written out as its fields ("Rank: 1", "Amount Text: $1,000"): the model copying its own
# structured answer into the text.
FIELD_LINE = re.compile(r"^\s*(?:[-*]\s*)?(?:Track|Rank|Amount(?: USD| Text)?|Winners|Perks):", re.I | re.M)
PRIZES_SECTION = re.compile(r"(^### Prizes[ \t]*\n)(.*?)(?=^### |\Z)", re.M | re.S)


def _prize_line(p: dict) -> str:
    name = f"**{p['name']}**" + (f" ({p['track']} track)" if p.get("track") and p["track"] not in p["name"] else "")
    amount = p.get("amount_text") or (f"${p['amount_usd']:,.0f}" if p.get("amount_usd") else None)
    extra = [amount] if amount else []
    if p.get("winners", 1) > 1:
        extra.append(f"{p['winners']} winners")
    extra += p.get("perks") or []
    return f"- {name}" + (f": {', '.join(extra)}" if extra else "")


def _fix_prize_fields(md: str, prizes: list[dict]) -> str:
    """Rewrite a Prizes section written as field lists from the prizes read alongside it."""
    def fix(m: re.Match) -> str:
        if len(FIELD_LINE.findall(m.group(2))) < 2:
            return m.group(0)
        if not prizes:
            return ""
        return m.group(1) + "\n".join(_prize_line(p) for p in prizes) + "\n\n"

    return PRIZES_SECTION.sub(fix, md).strip()


def _clean_prizes(prizes: list[dict]) -> list[dict]:
    out = []
    for p in prizes[:40]:
        name = (p.get("name") or "").strip()[:120]
        if not name:
            continue
        amount = p.get("amount_usd")
        out.append({
            "name": name,
            "track": ((p.get("track") or "").strip()[:80]) or None,
            "rank": p["rank"] if isinstance(p.get("rank"), int) and 0 < p["rank"] < 50 else None,
            "amount_usd": float(amount) if isinstance(amount, (int, float)) and 0 < amount < 100_000_000 else None,
            "amount_text": ((p.get("amount_text") or "").strip()[:60]) or None,
            "winners": max(1, min(int(p.get("winners") or 1), 500)),
            "perks": [str(x).strip()[:120] for x in (p.get("perks") or []) if str(x).strip()][:6],
        })
    return out


def polish_one(row: dict, usage: ai.Usage) -> dict:
    text = row["description"][:INPUT_LIMIT]
    user = f"Hackathon: {row['title']}\nOrganizer: {row.get('organizer') or 'unknown'}\n\nDescription:\n{text}"
    res = ai.chat_json(SYSTEM, user, SCHEMA, "polished_about", usage, max_tokens=1400)
    prizes = _clean_prizes(res.get("prizes") or [])
    md = _fix_prize_fields(_clean_markdown(res.get("markdown") or ""), prizes)
    if len(md) < 40:
        raise ValueError("markdown came back empty")
    return {"markdown": md[:8000], "prizes": prizes}


def run_polish(conn, limit: int | None = None) -> dict:
    limit = MAX_POLISH_PER_RUN if limit is None else limit
    stats = {"candidates": 0, "polished": 0, "failed": 0, "tokens_used": 0}
    try:
        ai.client()
    except ai.AIUnavailable as e:
        log.warning("polish skipped: %s", e)
        return stats
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, title, organizer, source_url, about_hash,
                   COALESCE(description_detail, description_raw) AS description
            FROM hackathons
            WHERE NOT is_hidden AND status <> 'ended'
              AND length(COALESCE(description_detail, description_raw, '')) >= %s
              AND about_attempts < %s
            ORDER BY (about_hash IS NULL) DESC, prize_usd DESC NULLS LAST, first_seen_at DESC
            """,
            (MIN_LENGTH, MAX_ATTEMPTS),
        )
        # Only descriptions that changed since they were last polished.
        rows = [r for r in cur.fetchall() if r["about_hash"] != description_hash(r["description"])][:limit]
    conn.commit()
    stats["candidates"] = len(rows)

    usage = ai.Usage()
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [(r, pool.submit(polish_one, r, usage)) for r in rows]
        for row, fut in futures:
            try:
                res = fut.result()
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE hackathons SET about_md = %s, about_prizes = %s, about_hash = %s, about_attempts = 0"
                        " WHERE id = %s",
                        (res["markdown"], Jsonb(res["prizes"]), description_hash(row["description"]), row["id"]),
                    )
                conn.commit()
                stats["polished"] += 1
            except Exception as e:
                conn.rollback()
                stats["failed"] += 1
                log.warning("polish failed for %s: %s", row["source_url"], e)
                with conn.cursor() as cur:
                    cur.execute("UPDATE hackathons SET about_attempts = about_attempts + 1 WHERE id = %s", (row["id"],))
                conn.commit()

    stats["tokens_used"] = usage.total
    cost = usage.cost_usd(config.OPENAI_MODEL)
    log.info("polish: candidates=%d polished=%d failed=%d tokens=%d est_cost=%s", stats["candidates"], stats["polished"],
             stats["failed"], usage.total, f"${cost:.4f}" if cost is not None else "n/a")
    return stats
