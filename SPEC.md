# Hackathon Radar — Spec

## 1. What it is
A personal discovery tool that finds hackathons from many platforms and the open web, puts them in one list, and sorts by prize money first. It does NOT host hackathons. Every card links out to the original page where you register.

v1 is for one user (me). No auth, no accounts. If it works well, I may make it public later, so nothing should block that, but don't build for it now.

## 2. Hard constraints
- Only recurring cost allowed: OpenAI API (about $5 credit). Everything else must be free tier.
- Fast to build: the whole v1 should be done in one day with Claude Code.
- Sources break. Treat every scraper as unreliable and isolate failures.

## 3. Stack
| Layer | Choice | Why |
|---|---|---|
| Scraper + API | Python 3.12, FastAPI, httpx, BeautifulSoup, Playwright only if a source needs it | Best scraping ecosystem |
| Database | Neon Postgres (free tier) | Real filtering and sorting, no SQLite migration later |
| AI | OpenAI API, small cheap model (set in env as `OPENAI_MODEL`), structured JSON output | Already have a key |
| API hosting | Render free web service | Free. Sleeps when idle, wakes in a few seconds |
| Scheduled scraping | GitHub Actions cron (every 6 hours) | Render free has no cron, Actions is free |
| Frontend | React + Vite + TypeScript + Tailwind on Cloudflare Pages | Free, static, fast |
| Web discovery | A free-tier search API (e.g. Tavily) | Finds hackathons outside the known platforms |

## 4. Architecture
```
GitHub Actions (cron, every 6h)
   -> runs pipeline: sources -> normalize -> dedupe -> AI enrich -> upsert into Neon
Render (FastAPI)  <-- reads --  Neon Postgres
Cloudflare Pages (React)  -- fetch -->  Render API
```
The scraper writes to the DB directly. The API only reads (plus one protected refresh endpoint).

## 5. Sources
Every source is an adapter with the same interface, so adding or removing one never touches the rest:

```python
class Source:
    name: str
    def fetch(self) -> list[RawListing]: ...
```

`RawListing`: source, source_url, title, organizer, description, prize_text, location_text, dates_text, raw_payload.

v1 adapters:
1. **Devpost** — start with its public listing pages / the JSON endpoint the site uses for the hackathon list. Inspect the network behavior first, don't guess. Unofficial, so expect it to change.
2. **MLH** — season events page.
3. **Devfolio** — public hackathon listing.
4. **Web discovery** — run a handful of search queries (e.g. "hackathon prize 2026 register", "online hackathon cash prize", "AI hackathon open now"), fetch the top result pages, and have the AI extract any hackathon listings from them. Discard anything that is not an actual hackathon page with a registration link.

Rules:
- Each adapter runs in its own try/except with a timeout. One failing source must never stop the run.
- Log per source: fetched count, new count, errors.
- Be polite: identify with a User-Agent, small delays, respect robots.txt where reasonable.

## 6. Normalize and dedupe
- Canonical key: normalized `source_url` (strip tracking params, trailing slashes, lowercase host).
- Secondary dedupe: same normalized title + overlapping dates across sources counts as the same hackathon. Keep the record from the richest source and store the other URLs in `alt_urls`.
- Content hash of (title, description, prize_text, dates). Only re-run AI enrichment when the hash changes.

## 7. AI enrichment
One OpenAI call per new or changed listing, structured JSON output. Fields:

| Field | Notes |
|---|---|
| `summary` | One plain sentence: what the hackathon is about |
| `prize_usd` | Total prize pool as a number in USD, null if unknown. Convert other currencies approximately |
| `prize_confidence` | `high` / `medium` / `low` |
| `prize_notes` | Short note if the prize is non-cash (credits, hardware, swag) |
| `format` | `online` / `in_person` / `hybrid` / `unknown` |
| `categories` | From a fixed list: software, web, mobile, AI/ML, data, hardware/IoT, robotics, networking, cybersecurity, web3/blockchain, gaming, health, fintech, climate, education, open-ended |
| `international_ok` | true / false / null |
| `student_only` | true / false / null |
| `relevance_score` | 0-100. Penalize vague listings, dead links, no prize info, spammy pages. Reward clear dates, real prize pools, credible organizers |
| `is_real_hackathon` | false means drop it |

Cost guards (important, the budget is small):
- Never enrich the same content twice (hash check).
- `MAX_ENRICH_PER_RUN` env var, default 60.
- Truncate descriptions to about 2,000 characters before sending.
- Log tokens used per run.

A second, separate step (`pipeline/polish.py`) tidies each open listing's description into Markdown and reads its prizes (name, track, rank, amount, winners, perks). It runs once per description, at most `MAX_POLISH_PER_RUN` (default 40) per run.
- If the OpenAI call fails, store the listing without enrichment and retry next run.

## 8. Data model (Postgres)
Table `hackathons`:
- `id` uuid pk
- `source` text, `source_url` text unique, `alt_urls` text[]
- `title`, `organizer`, `description_raw`
- `prize_text` (raw), `prize_usd` numeric null, `prize_confidence`, `prize_notes`
- `summary`
- `format`, `location_text`
- `categories` text[]
- `international_ok` bool null, `student_only` bool null
- `start_date`, `end_date`, `registration_deadline` (all nullable)
- `status` (`upcoming` / `open` / `ended`), computed from dates on each run
- `relevance_score` int
- `content_hash`, `enriched_at`, `enrichment_model`
- `first_seen_at`, `last_seen_at`

Indexes on `prize_usd`, `registration_deadline`, `status`, GIN on `categories`.

Table `source_runs`: `id`, `source`, `started_at`, `fetched`, `new`, `errors`, `tokens_used`. Used to see which sources are healthy.

## 9. API (FastAPI)
- `GET /hackathons` — query params: `sort` (`prize` default, `deadline`, `new`, `relevance`), `category` (repeatable), `format`, `min_prize`, `international_ok`, `student_only`, `status` (default `open,upcoming`), `q` (text search), `limit`, `offset`
- `GET /hackathons/{id}`
- `GET /meta` — categories with counts, last refresh time, per-source health
- `POST /admin/refresh` — protected by `ADMIN_TOKEN` header, triggers the pipeline
- `GET /health`

CORS: allow only the Cloudflare Pages domain plus localhost.

## 10. Frontend
Single page, dense and information-rich rather than minimal.

- Top bar: search, sort dropdown (Prize / Deadline / Newest / Relevance), "last updated" time
- Filter chips: categories (multi-select), format, international only, hide student-only, min prize slider
- Cards or a compact table toggle. Each shows: title, organizer, prize (big and prominent), format badge, category tags, deadline countdown, one-line AI summary, "NEW" badge if first seen in the last 48h
- Primary button: **Register ->** opens the original `source_url` in a new tab
- Prize-confidence shown subtly (e.g. "~$10k" when confidence is low)
- Loading state that says the server is waking up (free tier cold start), not a blank page
- Saved filter preferences in localStorage so my filters stick
- Mobile-first, since I mostly work from my phone

## 11. Scheduling
GitHub Actions workflow `refresh.yml`: cron every 6 hours plus manual `workflow_dispatch`. Secrets: `DATABASE_URL`, `OPENAI_API_KEY`, `SEARCH_API_KEY`.

## 12. Environment variables
`DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `SEARCH_API_KEY`, `ADMIN_TOKEN`, `MAX_ENRICH_PER_RUN`, `ALLOWED_ORIGINS`

## 13. Same-day build phases
1. **Foundation (about 1h):** repo layout, Neon schema + migrations, FastAPI skeleton, `/health`.
2. **Devpost adapter + storage (about 1h):** end to end, Devpost to DB, sorted by prize via `/hackathons`. Checkpoint: real data visible.
3. **More sources (about 1-2h):** MLH, Devfolio. Normalization and dedupe.
4. **AI enrichment (about 1h):** tagging, prize parsing, summaries, scores, cost guards.
5. **Web discovery layer (about 1h):** search queries, page fetch, AI extraction, junk filtering.
6. **Frontend (about 2h):** list, filters, sorting, click-through, cold-start state.
7. **Deploy (about 1h):** Neon, Render, Cloudflare Pages, GitHub Actions cron. Run one full refresh and sanity check the data.

## 14. Out of scope for v1
Accounts, saved/bookmarked hackathons, email or Telegram alerts, monetization, public launch polish. Good v2 ideas: Telegram alert when a hackathon over a prize threshold appears, a "my entries" tracker, a public read-only version.

## 15. What's been built since v1
v1 shipped as specced. Additions since, so this spec matches the app:
- **Sources:** TAIKAI, ETHGlobal and Unstop adapters. DoraHacks was skipped (its firewall blocks non-browser clients) and HackerEarth removed (it blocks GitHub Actions). Unstop listings, like web finds, stay hidden until the AI confirms they're hackathons.
- **Detail pages** (`/h/<id>`) with the long description, prize breakdown, key dates, **Add to calendar** (Google Calendar or .ics with a reminder) and **Share** (the hackathon's own page, via the share sheet or copied).
- **List:** NEW badge (first seen in 48h), deadline countdowns, multi-select categories, relevance sort, and a warning banner when a source fails or refreshes stop.
- **Fast loading:** a static copy of the data is published to GitHub Pages after every refresh, so the site doesn't wait for the sleeping Render API.
- **Design:** the "Atlantic" UI (light theme, Figtree), desktop and phone layouts.

## 16. Phase 2: a personal tool (built)
The plan for a multi-user Phase 2 was dropped: the app stays personal. No sign-ups, no accounts and no locked site; the link just isn't shared. The features that would have needed accounts were built for one person instead:

- **Installable app (PWA)** for phone and laptop, working offline with the last data.
- **Saved hackathons and an entries tracker:** Interested, Registered, Submitted, Won, Didn't place; notes; "Not interested" to hide one; a My hackathons page. Stored in Neon behind a personal key each device enters once, synced between devices.
- **Email via Resend:** new-hackathon alerts for saved rules (prize, categories, format, international, student-only), closing-soon reminders for tracked hackathons, and a Monday digest.
- **Copy prompt / Open in Claude** on each hackathon: a brief for project ideas. The AI already knows the person, so there's no profile in the app.
- **Share** sends the hackathon's own page, not the app's.

Dropped: sign-up and sign-in, per-user accounts, a public version, a "fits me" ranking from a profile, and Telegram (email instead).

## 17. Phase 3: iPhone-style app (built)
- **Redesign:** an iPhone-style UI, phone first: Today (home), Explore, Saved and Settings tabs; hackathon pages that slide in; a floating glass tab bar; swipe to save or hide; sheets for filters; real cover art.
- **Customisable:** theme (Automatic/Light/Dark), six accent colours, Liquid Glass on/off, text size, list density, home-screen icon and the tab the app opens on.
- **Motion:** smooth, slightly bouncy, firm springs throughout; swipe from the left edge to go back; respects Reduce Motion.
- **Push notifications** to the installed app: new matches, big new prizes, closing soon, an optional weekly summary, quiet hours, and a badge on the app icon.
- **Email** restyled to match the app.
