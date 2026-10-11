# Hackathon Radar

A personal hackathon finder. It pulls hackathons from Devpost, MLH, Devfolio and the open web, runs a cheap AI pass over each one, and shows them in a single list sorted by prize money. Each card links out to the original page so you can register there.

```
GitHub Actions (cron, every 6h)
   -> pipeline: sources -> normalize -> dedupe -> AI enrich -> upsert into Neon
Render (FastAPI)  <-- reads --  Neon Postgres
Cloudflare Pages (React)  -- fetch -->  Render API
```

The OpenAI API is the only paid piece. Everything else runs on free tiers.

## Repo layout

```
backend/
  app/            FastAPI app: main.py (routes), db.py (pool + migrations), config.py
  migrations/     plain SQL, applied in order (python -m app.db)
  pipeline/
    sources/      one adapter per site: devpost.py, devfolio.py, mlh.py
    discover.py   web discovery (Tavily search -> page fetch -> AI extraction)
    normalize.py  URL canonicalisation, title keys, content hash, money parsing
    dedupe.py     cross-source matching (same URL, or same title + overlapping dates)
    store.py      upsert + status refresh
    enrich.py     the structured OpenAI call and its cost guards
    run.py        entry point
  tests/
frontend/         React + Vite + TypeScript + Tailwind + Framer Motion + shadcn-style Radix components
.github/workflows/refresh.yml   the 6-hourly cron
render.yaml       Render blueprint for the API
DECISIONS.md      choices that differ from (or fill gaps in) the spec
```

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Render, GitHub secret, local `.env` | Neon **direct** (non-pooled) connection string, including `?sslmode=require` |
| `OPENAI_API_KEY` | GitHub secret (Render too if you use `/admin/refresh`) | the only paid service |
| `OPENAI_MODEL` | optional | default `gpt-4o-mini`. `gpt-4.1-nano` or `gpt-5-nano` also work |
| `SEARCH_API_KEY` | GitHub secret (Render too if you use `/admin/refresh`) | [Tavily](https://tavily.com) key, free tier is 1,000 searches/month |
| `ADMIN_TOKEN` | Render | protects `POST /admin/refresh` |
| `MAX_ENRICH_PER_RUN` | optional | default 60 AI calls per run |
| `MAX_DISCOVERY_PAGES` | optional | default 12 web pages sent to the AI per run |
| `ALLOWED_ORIGINS` | Render | comma-separated, e.g. `https://hackathon-radar.pages.dev,http://localhost:5173` |
| `VITE_API_URL` | Cloudflare Pages (build env) | your Render URL, e.g. `https://hackathon-radar-api.onrender.com` |

Copy `.env.example` to `backend/.env` for local work. Never commit real keys: `.env` is gitignored.

## Run locally

You need Python 3.12+, Node 20+, and a Postgres database. A free Neon branch works, and so does a local Postgres:

```bash
docker run -d --name radar-pg -e POSTGRES_PASSWORD=pg -p 5432:5432 postgres:16
# DATABASE_URL=postgresql://postgres:pg@localhost:5432/postgres
```

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env        # then edit it
python -m app.db               # apply migrations
python -m pipeline.run         # fetch + enrich (no keys? AI/web steps are skipped and logged)
uvicorn app.main:app --reload  # http://localhost:8000/hackathons
```

Useful pipeline flags:

```bash
python -m pipeline.run --sources devpost,mlh   # only some sources
python -m pipeline.run --no-enrich             # skip the OpenAI step entirely
```

Frontend:

```bash
cd frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev   # http://localhost:5173
```

Tests (the DB tests need a throwaway database because they truncate tables):

```bash
cd backend
TEST_DATABASE_URL=postgresql://postgres:pg@localhost:5432/radar_test python -m pytest -q
```

## Deploy (all free tiers)

1. **Neon:** create a project, then copy the **direct** connection string, not the `-pooler` one (in the Connect dialog, turn "Connection pooling" off). It ends with `?sslmode=require`. Tables get created on the first API start or pipeline run.
2. **Render (API):** go to New → Blueprint and pick this repo. `render.yaml` sets up a free web service from `backend/`. When it asks, fill in `DATABASE_URL`, `ALLOWED_ORIGINS` (add your Pages URL after step 3), plus `OPENAI_API_KEY`/`SEARCH_API_KEY` if you want `/admin/refresh` to work. `ADMIN_TOKEN` is generated for you and you can read it in the service's Environment tab.
3. **Cloudflare (frontend):** go to Workers & Pages → Create and import this repo from Git. Cloudflare's default flow now creates a *Worker* with static assets, and a *Pages* project works just as well. Use these settings:
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Output directory: `dist` (Pages only; a Worker's deploy command `npx wrangler deploy` finds it on its own)
   - Build-time variable `VITE_API_URL=https://<your-render-service>.onrender.com`, plus `NODE_VERSION=22` if the build picks an old Node. On a Worker this goes under **Settings → Build → Variables and secrets**, not the runtime variables, because Vite bakes it in at build time.

   Then add the resulting site URL (`https://<project>.pages.dev` or `https://<project>.<you>.workers.dev`) to `ALLOWED_ORIGINS` on Render.
4. **GitHub Actions (cron):** go to repo Settings → Secrets and variables → Actions and add the secrets `DATABASE_URL`, `OPENAI_API_KEY` and `SEARCH_API_KEY`. You can optionally add the variables `OPENAI_MODEL`, `MAX_ENRICH_PER_RUN` and `MAX_DISCOVERY_PAGES`. The workflow runs every 6 hours.
5. **First fill:** trigger a manual refresh (see below). The first run stores every listing right away but only enriches 60 of them, so it takes about 4 runs (one day of cron, or a few manual runs) before every listing has an AI summary. Listings that aren't enriched yet still show up with their platform data: prize, dates, format and categories.

Note: GitHub pauses scheduled workflows in repos with no activity for 60 days. If that happens, re-enable the workflow from the Actions tab.

## Trigger a manual refresh

Any of these works:

- **GitHub:** Actions → *Refresh hackathons* → *Run workflow*. You can limit it to some sources, e.g. `devpost,mlh`.
- **CLI:** `gh workflow run refresh.yml` (or `gh workflow run refresh.yml -f sources=web`)
- **API:** `curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://<render-url>/admin/refresh`. This runs the pipeline inside the Render instance in the background. It needs the OpenAI/Tavily keys set on Render too.
- **Locally:** `python -m pipeline.run` with `DATABASE_URL` pointing at Neon.

A Postgres advisory lock stops two refreshes from running at once.

## Frontend

The UI follows the "Atlantic" design: a light theme with two pages.

- **Explore hackathons (`/`):** search, filters (format, international, student-only, one or more categories, minimum prize), sort (prize, deadline, newest, relevance), a cards/table switch, and pages of 10. On a phone the filters open in a bottom sheet. Cards show a countdown to the registration deadline for the coming month ("Closes in 12 days") and a **NEW** badge on hackathons first seen in the last 48 hours.
- **Hackathon details (`/h/<id>`):** the key facts strip, tabs that follow your scroll (Overview, Eligibility, Key dates, Prize details, Source), the prize breakdown, and a Register button. The button sits in a sidebar on desktop and is pinned to the bottom on a phone.

How it behaves:

- **Links:** every hackathon has its own link, `/h/<id>`, which you can share. The Cloudflare Worker serves the app for these paths.
- **Going back** returns you to the same place in the list, with your filters kept.
- **Speed:** filtering, sorting and search all happen in the browser, so they respond instantly.
- **Accessibility:** animations follow the device's "reduce motion" setting.

## API

- `GET /hackathons`: takes `sort` (`prize` default, `deadline`, `new`, `relevance`), `category` (repeatable), `format`, `min_prize`, `international_ok`, `student_only`, `status` (default `open,upcoming`), `q`, `limit`, `offset`. Returns `{items, total, limit, offset}`.
- `GET /hackathons/{id}`: everything in the list plus `description` (the long text) and `prizes` (the breakdown, with each prize's amount per winner and the winner count).
- `GET /meta`: category counts, last refresh time, and the latest run per source with fetched/new/errors/tokens.
- `POST /admin/refresh`: needs the `X-Admin-Token` header.
- `GET /health`

## Checking source health

Look at `GET /meta` → `sources`, or query the `source_runs` table. Each source has one row per run with `fetched`, `new`, `errors`, `error_text` and `tokens_used`. The `enrich` row holds the AI token count for the run, and the `pipeline` row holds the run totals. The list page shows a warning banner when a source failed on its last run, or when no refresh has finished in 13 hours (two missed runs). Dismissing it hides it until the problem changes.

## Cost

With `gpt-4o-mini`, one enrichment call is about 1.2k input tokens and 150 output tokens, which comes to roughly $0.0003. One web-extraction call is about 2k input tokens and 500 output, roughly $0.0006.

- **First full run:** 60 enrichments plus 12 extracted pages comes to about $0.03. Backfilling all ~220 current listings costs about $0.07 in total.
- **Steady state:** only new or changed listings and pages go to the AI, so a typical 6-hourly run costs well under a cent. Expect less than $1/month.

Every run logs its token counts and an estimated cost, e.g. `enrich: ... tokens=17471 (in=13721 out=3750) est_cost=$0.0043`.

## Adding a source

Write a class with `name`, `timeout` and `fetch() -> list[RawListing]` in `backend/pipeline/sources/`, and register it in `sources/__init__.py`. List order is the dedupe priority, so put richer sources first. If you want a longer description fetched just before enrichment, also implement `fetch_detail(row)`. A source that raises an error or times out gets logged and skipped, and the rest of the run carries on.
