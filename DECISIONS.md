# Decisions

These are choices made while building v1 that differ from the spec or fill a gap in it. Each one is listed with its reason.

## Sources: what each site actually returns (inspected Oct 2026)

- **Devpost:** the listing page calls `GET https://devpost.com/api/hackathons?status[]=upcoming&status[]=open&page=N&per_page=40`. The response is JSON, and `per_page` is capped at 40. Each item already has the prize (`prize_amount`), the submission period, themes, an online/in-person flag and the organizer, so there's no HTML parsing for the list.
  - Devpost's bot filter returns **403 to non-browser clients that send `Accept: text/html`**. The HTTP client therefore sends `Accept: */*` together with an honest User-Agent.
  - **Invite-only** Devpost hackathons are skipped, since you can't register for them.
  - The listing has no description, and fetching ~140 detail pages every run would be slow and impolite. Instead, the Devpost adapter's `fetch_detail()` fetches a detail page only for listings that are about to be AI-enriched, i.e. ones that are new or changed. That's typically a handful per run.
  - Only stable facts (themes) go into the listing-level description. The listing also carries text like "12 days left", which changes daily and would change the content hash and trigger re-enrichment every day.
  - `registration_deadline` = end of the submission period, because Devpost registration stays open until then. Dates are parsed as end-of-day UTC, so a deadline can be off by a few hours against the organizer's timezone.
- **MLH:** `mlh.io` redirects to `www.mlh.com/seasons/<season>/events`, which is an Inertia.js page. The event list is JSON inside `<script data-page="app">` under `props.upcomingEvents`. Seasons run Aug→Jul and are named after the year they end in (Oct 2026 → season 2027). From May to July, next season is fetched too.
  - `source_url` is the event's own website (`websiteUrl`), which is where you register. The mlh.com page only lists sponsor prizes.
  - MLH has no prize-pool data, so those cards show "—" unless another source (usually Devpost) has the same event, in which case dedupe merges them.
  - `student_only` defaults to true for MLH, since the season list is the student hackathon league.
- **Devfolio:** the listing page `devfolio.co/hackathons` is Next.js, and `__NEXT_DATA__` holds `open_hackathons` / `upcoming_hackathons` but no prizes or descriptions. Each hackathon's microsite `https://<slug>.devfolio.co/` has `aggregatePrizeValue` and `aggregatePrizeCurrency`, a markdown description, the venue and `reg_ends_at`. With only ~20 open at a time, the adapter fetches every microsite, 1 second apart.
- **TAIKAI:** the site is built on its own GraphQL API (`api.taikai.network/api/graphql`, advertised in `/.well-known/api-catalog`). One POST returns every non-closed challenge with its prize, currency, registration window, timeline steps and the full overview/prizes/rules tab texts, so no detail requests are needed. `isClosed` lags (finished 2024 events still show as open), so a challenge is kept only if its deadline or last timeline step is still ahead. There's no format or location field; the AI reads those from the text.
- **ETHGlobal:** `ethglobal.com/events` is a Next.js App Router page, so there's no `__NEXT_DATA__`. The event objects are inside the React Server Components payload (`self.__next_f.push` strings), found by shape (`{"id":N,"name":...}`) and decoded with `json.raw_decode`. Only `type == "hackathon"` and `status == "future"` are kept, usually one to three. The prize comes from the event page's "$N Available in prizes" header, or, because some event pages answer 500, from the sum of sponsor `prizeAmount` values on `/events/<slug>/prizes` (medium confidence). The RSC format is internal and could change with any deploy; if it does, the adapter fails loudly and the source warning banner shows.
- **Unstop:** the pages are a JS shell, but the site's public JSON API (allowed under `/api/public/` in robots.txt) returns ~250 open hackathons in pages of 50, each with the full description, cash prizes per rank, deadline, format and eligibility. `per_page=100` silently drops items, so the adapter uses 50. Listings are mostly Indian student events with prizes in rupees; `student_only` comes from the eligibility "sector" list, so "Hide student-only" filters most of them out. Unstop rows are hidden until AI-vetted (see below).
- **HackerEarth:** the hackathon list renders in the browser from `/api/community/challenges/compete/`, which returns every challenge in one response (no description or prize). Kept: `type == "Hackathon"`, or a "Competitive" challenge with "hackathon" in its name, that hasn't ended. Each hackathon page redirects to its own landing site, so the detail step only reads that site's title and description meta tags. There are usually just one or two open.
- **DoraHacks: not added.** Its API works, but the whole site sits behind an AWS WAF that answers non-browser clients with a CAPTCHA. Getting through means dressing the scraper up as a browser, which goes against "be polite".

## Data model additions

The spec's columns are all there. These columns were added:

- `title_key`: normalized title, indexed, used for cross-source dedupe.
- `enriched_hash`: the content hash that was last enriched. A row needs AI work when `enriched_hash IS DISTINCT FROM content_hash`, which covers "new", "changed" and "previous call failed, retry next run" with a single query.
- `enrich_attempts`: a row that fails 4 times in a row stops being retried until its content changes. This stops one weird listing from burning credit on every run.
- `hints` (jsonb): structured facts the platform already gave us (exact prize, format, categories, student-only).
- `is_hidden`: see "dropping non-hackathons" below.
- `raw_payload`, `image_url`, `dates_text`.
- `source_runs` gained `finished_at` and `error_text`. `discovered_pages` caches web-discovery page hashes and their extracted listings.

Use Neon's **direct** connection string, not the `-pooler` one. The pipeline takes a session-level advisory lock, and those don't survive PgBouncer's transaction pooling. At this traffic level the direct connection is fine for the API too.

Migrations are plain SQL files applied by a ~30-line runner (`python -m app.db`, which also runs on API start and at the start of every pipeline run). Alembic/SQLAlchemy would be more machinery than this one-table app needs. The app uses psycopg 3 directly.

## Platform data beats AI guesses

When a platform gives an exact prize (Devpost and Devfolio do), `prize_usd` comes from the platform and is marked `high` confidence (or `medium` if a currency conversion was involved). The AI's prize estimate is only used when the platform has none, which in practice means web finds. The same rule applies to `format`.

A small static FX table (`normalize.FX_TO_USD`) converts INR/EUR/CAD/etc. right away, so listings sort correctly before they've been enriched and even with no OpenAI key at all. For the same reason, platform themes are mapped onto the fixed category list deterministically. The AI later replaces those categories with better ones.

## Dropping non-hackathons

`is_real_hackathon = false` sets `is_hidden = true` instead of deleting the row. If the row were deleted, the next run would rediscover it and pay for another AI call to reject it again. Only **web-discovered** and **Unstop** listings can be hidden this way, and both stay hidden until the AI has looked at them (`VETTED_SOURCES` in `app/categories.py`). Unstop's hackathon category also holds coding contests, CTFs and quizzes. Listings from the other platforms are trusted to be hackathons, since a misfiring AI call shouldn't remove a real $50k event.

## Dedupe

- The canonical URL lowercases the host and also **strips `www.`, forces `https`**, drops fragments and sorts query params, on top of removing tracking params and trailing slashes.
- A title match counts as the same hackathon only if the two sources are different and the dates overlap (with ±2 days of slack). If either side has no dates, the normalized title must be at least 8 characters, so short generic names don't collide.
- "Richest source" = source priority (Devpost = Devfolio = TAIKAI = ETHGlobal > MLH = Unstop = HackerEarth > web) plus the number of filled fields. A lower-priority source never replaces a platform record. Its URL goes into `alt_urls`, and it can only fill fields that are empty. On today's data, 13 MLH events merged into their Devpost pages this way.

- Web finds also dedupe against *each other* (two pages often describe the same event). With overlapping dates, a title containing another counts as a match, e.g. "HackerNoon Decentralize AI Hackathon" = "Decentralize AI Hackathon". The shorter title must be at least 8 characters.
- Web finds stay **hidden from the list until the AI has vetted them**, and enrichment handles unvetted web finds before anything else. Platform listings are usable without the AI; unvetted web finds can be blog posts. The first live run showed exactly that.

## Status

`status` is recomputed from dates on every run. **Registration closed counts as `ended`**: for a discovery tool, an event you can no longer join is over. A row with no dates at all becomes `ended` once no source has seen it for 30 days.

## Web discovery

- Tavily is used only to *find* URLs (5 queries per run, basic depth, ~600 searches/month at a 6-hour cron, inside the free 1,000). The pipeline fetches each page itself (robots.txt respected) so that the links on the page can be kept inline as `anchor [url]`. Listicles are only useful if the AI can see the registration links. If a page blocks the fetch, the search snippet is used instead.
- Domains already covered by adapters (devpost.com, devfolio.co, mlh.*, unstop.com, taikai.network, ethglobal.com, hackerearth.com), plus social and blog platforms, are skipped before any AI call.
- **Page cache:** each page's text hash is stored together with what the AI extracted from it. An unchanged page re-emits its cached listings for free, and the AI is never called twice on the same content. At most `MAX_DISCOVERY_PAGES` (default 12) new or changed pages are extracted per run.
- The link check drops only links that are definitely dead (404/410, or DNS/connection failure). A 403/429/5xx is usually bot-blocking, so those links are kept and the enrichment step decides.
- Prize amounts from web pages are left to the AI, which reports a confidence. Low confidence shows as "~$10k".

## API semantics

- `international_ok=true` means "hide events known to be region-locked": the query is `international_ok IS NOT FALSE`. Most listings never say, and a strict `= true` would hide nearly everything.
- `student_only=false` ("hide student-only") hides only listings known to be student-only.
- `format=online` (or `in_person`) also matches `hybrid`.
- `GET /hackathons` returns `{items, total, limit, offset}` rather than a bare list, so the UI can show counts and a "show more" button.
- `/meta` also returns `first_run_at`. The UI uses it to skip the NEW badge on the very first run, when everything is "new".
- `POST /admin/refresh` runs the pipeline in a background thread on the Render instance and returns `202`. A Postgres advisory lock stops it from overlapping with the cron.

## AI

- The default model is `gpt-4o-mini`: a cheap, non-reasoning model with structured outputs. The wrapper also handles reasoning models (`gpt-5-nano` etc.) via `max_completion_tokens` and `reasoning_effort=minimal`.
- Enrichment also returns `start_date` / `end_date` / `registration_deadline` (YYYY-MM-DD or null). These only fill gaps, which matters for web finds that have no structured dates.
- AI output is validated before storing: categories are filtered to the fixed list, the score is clamped to 0–100, and the prize must be a number ≥ 0.
- Calls run 4 at a time, and a failed call never fails the run.

## Extras not in the spec

- A `ci.yml` workflow runs pyflakes and the test suite against a Postgres service, and builds the frontend.
- The pipeline exits non-zero only when *every* source fails (network or DB trouble). A single failing source is logged and recorded in `source_runs`, but the run still passes.
- The frontend shows a warning banner when the last run had a failing source.

## Not done from this environment

- **Deployment:** this build environment has no Neon, Render, Cloudflare or GitHub-secrets access. Everything is ready for it: `render.yaml`, `refresh.yml` and the Pages settings in the README.
- **Real OpenAI/Tavily calls:** no keys were available here. The enrichment and discovery code paths were exercised end-to-end through the real `openai` SDK against a local stand-in server that returns schema-shaped responses. Token and cost numbers in the README are estimates from prompt sizes.

## Detail pages and prize breakdowns (added with the H redesign)

- **The bug:** each refresh, the short Devpost listing text (just the themes) overwrote the long description fetched from the hackathon's own page on the previous run.
- **The fix:** long descriptions now live in `description_detail` and breakdowns in `prizes`. The listing text can no longer touch them.
- **The details step:** a separate pipeline step fills those columns. It runs before AI enrichment for listings that are new or changed, or whose page was last fetched over a week ago, up to 80 per run. It costs no AI tokens.
- **Devpost prizes:** each prize card lists an amount *per winner* plus a winner count. Both are stored, so the parts add up to the stated pool (e.g. 15 winners × €2,000).
- **Devfolio prizes:** these come from `prizeDetails` on the microsite the adapter already reads.

## Frontend (Atlantic design)

- **Design:** built one-to-one from the Atlantic comps (Discovery and Hackathon Details, desktop and phone). Colors and the 900px desktop breakpoint live as Tailwind v4 `@theme` tokens in `index.css`; the font is Figtree.
- **Components:** shadcn-style Button, Badge, Select and Sheet on Radix primitives, restyled to the comps rather than shadcn's defaults.
- **Animation:** page transitions are a timer plus CSS keyframes (never an animation callback, so a dropped frame cannot leave a blank screen). Framer Motion handles the staggered list rows, the sliding Cards/Table toggle, the tab underline, section reveals and the expanding description. Radix popovers and the sheet use CSS keyframes.
- **Routing:** a ~30-line router in `lib/router.ts`, with no react-router. The list stays mounted under the detail page so its scroll position and filters survive a round trip.
- **Data:** the list loads once (about 200 rows) and is filtered and paged in the browser. The detail endpoint is fetched when a hackathon opens, while the list data already fills the header.
- **Cloudflare:** `wrangler.jsonc` was removed; the Worker created in the dashboard already serves `index.html` for unknown paths.
- **Devpost descriptions:** only `#challenge-description` is kept, split into paragraphs. The sidebar block (`#challenge-information`) added calendar links and counts. Migration 004 makes the details step refetch Devpost pages once; AI enrichment is keyed on `content_hash`, so this costs no OpenAI tokens.
