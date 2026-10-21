# Hackathon Radar

A personal hackathon finder. It pulls hackathons from Devpost, Devfolio, MLH, TAIKAI, ETHGlobal, Unstop and the open web, runs a cheap AI pass over each one, and shows them in a single list sorted by prize money. Each card links out to the original page so you can register there.

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
    sources/      one adapter per site: devpost, devfolio, mlh, taikai, ethglobal, unstop
    discover.py   web discovery (Tavily search -> page fetch -> AI extraction)
    normalize.py  URL canonicalisation, title keys, content hash, money parsing
    dedupe.py     cross-source matching (same URL, or same title + overlapping dates)
    store.py      upsert + status refresh
    enrich.py     the structured OpenAI call and its cost guards
    run.py        entry point
  tests/
frontend/         React + Vite + TypeScript + Tailwind + Framer Motion + Radix primitives
.github/workflows/refresh.yml   the 6-hourly cron
render.yaml       Render blueprint for the API
DECISIONS.md      choices that differ from (or fill gaps in) the spec
```

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Render, GitHub secret, local `.env` | Neon **direct** (non-pooled) connection string, including `?sslmode=require` |
| `OPENAI_API_KEY` | GitHub secret, and Render (for **Add a hackathon**) | the only paid service |
| `OPENAI_MODEL` | optional | default `gpt-4o-mini`. `gpt-4.1-nano` or `gpt-5-nano` also work |
| `SEARCH_API_KEY` | GitHub secret, and Render (for **Add a hackathon**) | [Tavily](https://tavily.com) key, free tier is 1,000 searches/month |
| `ADMIN_TOKEN` | Render | protects `POST /admin/refresh` |
| `PERSONAL_KEY` | Render | unlocks your personal data (saved hackathons, notes, email settings); each device enters it once in Settings. Falls back to `ADMIN_TOKEN` if unset |
| `RESEND_API_KEY` | GitHub secret | [Resend](https://resend.com) API key, for the email alerts |
| `VAPID_PRIVATE_KEY` | Render and GitHub secret | turns on push notifications; make one with `python -m app.push --generate-key` (see [Push notifications](#push-notifications)) |
| `GITHUB_TOKEN` | Render | lets **Run now** in Settings start the refresh (see [Trigger a manual refresh](#trigger-a-manual-refresh)) |
| `VAPID_SUBJECT` | optional | contact for the push services, default `mailto:` + `NOTIFY_EMAIL` |
| `NOTIFY_EMAIL` | GitHub secret | where the emails go |
| `NOTIFY_FROM` | optional GitHub variable | default `Hackathon Radar <onboarding@resend.dev>`, which can only send to your Resend account's own address |
| `APP_URL` | optional GitHub variable | where links in emails point; default the workers.dev URL |
| `MAX_ENRICH_PER_RUN` | optional | default 60 AI calls per run |
| `MAX_DISCOVERY_PAGES` | optional | default 12 web pages sent to the AI per run |
| `MAX_POLISH_PER_RUN` | optional | default 40 descriptions tidied by the AI per run |
| `MAX_ARTWORK_PER_RUN` | optional | default 60 listings per run looked up for a banner or organizer logo |
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
4. **GitHub Actions (cron):** go to repo Settings → Secrets and variables → Actions and add the secrets `DATABASE_URL`, `OPENAI_API_KEY` and `SEARCH_API_KEY`. You can optionally add the variables `OPENAI_MODEL`, `MAX_ENRICH_PER_RUN`, `MAX_DISCOVERY_PAGES`, `MAX_POLISH_PER_RUN` and `MAX_ARTWORK_PER_RUN`. The workflow runs every 6 hours.
5. **Personal key:** on Render, add `PERSONAL_KEY` to the API's environment: any long random string (a password manager can make one). Then open the app's **Settings** on each device and paste it once.
6. **Push notifications (optional):** run `python -m app.push --generate-key` once and add the printed `VAPID_PRIVATE_KEY` both on Render (Environment) and as a GitHub secret. Then turn notifications on in the app (see [Push notifications](#push-notifications)).
7. **Emails (optional):** create a free [Resend](https://resend.com) account, make an API key, and add the GitHub secrets `RESEND_API_KEY` and `NOTIFY_EMAIL` (the address you signed up to Resend with, when using the default sender). Check it with Actions → *Send test email* → *Run workflow*.
8. **GitHub Pages (fast loading):** go to repo Settings → Pages → Build and deployment and set **Source** to **GitHub Actions**. After each refresh, the *Publish data snapshot* workflow puts a static copy of the data there (see [Fast loading](#fast-loading)). If you skip this, the site still works but waits for the API to wake up.
9. **First fill:** trigger a manual refresh (see below). The first run stores every listing right away but only enriches 60 of them, so it takes about 4 runs (one day of cron, or a few manual runs) before every listing has an AI summary. Listings that aren't enriched yet still show up with their platform data: prize, dates, format and categories.

Note: GitHub pauses scheduled workflows in repos with no activity for 60 days. If that happens, re-enable the workflow from the Actions tab.

## Trigger a manual refresh

Any of these works:

- **In the app:** Settings › Search › **Run now**. It starts the GitHub refresh and shows it live: each platform as it's searched (found and new), then the AI check, tidying, covers, alerts and the snapshot publish, with a timer. When it's done the list reloads. One-time setup: on GitHub, Settings › Developer settings › Fine-grained tokens › *Generate new token*, repository access *Only select repositories* › `hackathon-radar`, permission **Actions: Read and write** (nothing else), then add it on Render as `GITHUB_TOKEN`. Without it the card still follows scheduled runs; only the button is off.
- **GitHub:** Actions → *Refresh hackathons* → *Run workflow*. You can limit it to some sources, e.g. `devpost,mlh`.
- **CLI:** `gh workflow run refresh.yml` (or `gh workflow run refresh.yml -f sources=web`)
- **API:** `curl -X POST -H "X-Admin-Token: $ADMIN_TOKEN" https://<render-url>/admin/refresh`. This runs the pipeline inside the Render instance in the background. It needs the OpenAI/Tavily keys set on Render too.
- **Locally:** `python -m pipeline.run` with `DATABASE_URL` pointing at Neon.

A Postgres advisory lock stops two refreshes from running at once.

**The schedule (every 6 hours, at 00:17, 06:17, 12:17 and 18:17 UTC)** is kept by the Cloudflare Worker, not GitHub: GitHub started its scheduled runs 3 to 6 hours late and skipped some. The Worker's cron (`triggers` in `frontend/wrangler.jsonc`) calls `POST /schedule/tick` on the API at each slot and again half an hour later; the API starts the refresh with its `GITHUB_TOKEN` only if none has started since the slot, so extra calls do nothing. GitHub's own schedule stays as a fallback and skips itself when a run already happened in the last 3 hours. Cron logs are in the Cloudflare dashboard under the Worker's Logs.

**Check what Render is running:** open `https://<your-render-url>/health`. `commit` is the deployed commit (compare it with the latest on `main`) and `push` says whether `VAPID_PRIVATE_KEY` is set. `/push/key` returns the public key once push is set up; a 404 there means the deploy is older than the push feature.

## Frontend

An iPhone-style app, built phone first: large titles, grouped cards, a floating glass tab bar, swipe actions and sheets.

**On a computer** (windows 1024px and wider) it has a desktop layout instead: a sidebar in place of the tab bar, with search (Ctrl K or ⌘ K, or `/`), Stats, and shortcuts that open Explore with a filter set (closing this week, new since your last visit, $50K+ prizes, online). Today puts the new arrivals and this week's deadlines beside a column with the counts, your deadlines and the biggest prize. Explore has a filter bar and, from 1200px, a preview of the selected hackathon beside the list (↑ and ↓ move through it, Enter opens the page). Saved is a board with a column per stage: drag a card to move it on. A hackathon's page puts the facts and description on the left and your progress, timeline and Claude on the right. Settings opens its pages beside the list, and Stats uses two columns. Escape closes a page.

- **Today (`/`):** what needs you. Counts for closing this week / new since your last visit / open, countdown cards for the hackathons you saved, the biggest prize closing this week, the rest of this week's deadlines and the new arrivals. Each count opens Explore with that filter.
- **Explore (`/explore`):** search, removable filter chips with quick suggestions, a sort menu, and a filter sheet (sort, closes within, format, minimum prize, worldwide, student-only, new only, categories, platforms). The list loads more as you scroll. Swipe a row left for **Save** and **Hide**.
- **A hackathon (`/h/<id>`):** slides in over the tab you came from. Cover art, the key facts (prize, closes in, format, who can enter), your progress (Interested → Registered → Submitted → Won/Didn't place) and a note, **Brainstorm ideas with Claude**, the description, prizes, share, calendar (Google Calendar or an .ics with a reminder) and a floating **Register** button. Swipe from the left edge to go back.
- **Saved (`/saved`):** your hackathons by stage: what closes this week (with your notes), later ones, submitted, results and hidden.
- **Settings (`/settings`):** connect the device, notifications, email alerts, reminders, the digest, appearance and which tab the app opens on.

**Appearance** (Settings › Appearance, saved per device): Automatic/Light/Dark theme, six accent colours or any custom colour, **Liquid Glass** (clear, light-bending glass on the tab bar, buttons and menus, and a subtle glass finish on cards over a faint tinted wash; off gives a calmer frosted look), five text sizes, compact or comfortable lists, and three home-screen icons (iPhone picks up a new icon when the app is removed from the Home Screen and added again).

**Motion:** everything moves on springs (`frontend/src/lib/motion.ts`) tuned to be quick with a small, firm bounce: pages push in like iOS navigation, sheets and menus spring out of their buttons, the tab bar's selection pill and toggles bounce, rows follow your finger. The device's Reduce Motion setting turns animations off.

How it behaves:

- **Links:** every hackathon has its own link, `/h/<id>`, which you can share. The Cloudflare Worker serves the app for these paths.
- **Link previews:** when one of this app's own links is pasted into WhatsApp, Messages, Slack and so on, the card shows the hackathon's name, prize, deadline, location and summary, with the Hackathon Radar image (`public/og-image.png`). A small Worker script (`frontend/worker/index.ts`, configured in `frontend/wrangler.jsonc`) runs only for `/` and `/h/<id>`: it reads the hackathon from the GitHub Pages snapshot and adds the preview tags to the page. Everything else is served straight from the static files. If you rename the Worker in Cloudflare, change `name` in `wrangler.jsonc` to match.
- **Going back** returns you to the same place in the list; each tab keeps its own scroll position, and your filters are kept.
- **Speed:** filtering, sorting and search all happen in the browser, so they respond instantly.

**Icons** are [Phosphor](https://phosphoricons.com) (MIT): `frontend/scripts/icons.mjs` copies the ones the app uses, in regular, bold and fill weights, into `src/components/icons.generated.ts`. To add one, add it to the script's list and run it against the `@phosphor-icons/core` package (instructions at the top of the script). The Claude mark on the brainstorm card is from [Simple Icons](https://simpleicons.org) (CC0).

## Personal features

The app is for one person, so there are no accounts. Your personal data lives in Neon behind the personal key (`PERSONAL_KEY`), which each device enters once in **Settings**. Your phone and laptop share it.

- **Install it:** on a phone, open the site and use *Add to Home Screen* (iPhone: Share → Add to Home Screen; Android/Chrome: menu → Install app). On a laptop, Chrome or Edge shows an install icon in the address bar. It opens without browser bars and works offline with the data it last loaded.
- **Track hackathons:** swipe a row left and tap **Save**, or use the bookmark on a hackathon's page; set its stage and keep a note there. **Hide** (or **Not interested**) takes it out of every list; it waits under Saved › Hidden. Saving works before the device is connected too: it's kept on the device and syncs once you connect. Changes show at once and sync in the background, since the free API can take a minute to wake.
- **Ask Claude for ideas:** **Brainstorm ideas with Claude** opens Claude with a brief that has everything known about the hackathon (dates, prizes, themes, rules, the organizer's description), or copies it. Claude's `?q=` prefill isn't documented, so the prompt is copied either way.
- **Share** sends the hackathon's own page (Devpost, Devfolio, ...), not this app's link.
- **Add a hackathon the radar hasn't found:** paste its link or type its name (the **+** on Saved, **Add a hackathon** in the desktop sidebar, or **Find it with AI** when a search in Explore comes up empty). On an Android phone with the app installed, share a post (LinkedIn, X, ...) to **Hack Radar** to start there. The server reads the link, or searches the web with Tavily when there's only a name or a social post, and the AI picks out the details. You check them (anything the pages don't say is left empty, never guessed), and **Add and save** puts it in Explore, marked **Added by you**, and on your Saved list. In the background the AI adds its summary, prize and themes, the artwork step looks for a banner and logo, and the public snapshot is republished. If it's already on the radar, you're taken to it instead. While you pick, each match shows the banner and logo from its page. A hackathon you added has **Edit details** and **Delete hackathon** on its page: edits are read again by the AI (summary, prize amount, themes), and deleting removes it from Explore and your list. Needs `OPENAI_API_KEY` and `SEARCH_API_KEY` on Render; about a cent per add at most.
- **Badge:** the installed app's icon shows how many saved hackathons close this week (Settings › Notifications › Badge on app icon).
- **Stats** (Settings › Your stats, or **Your week** at the bottom of Today): **You** shows the share of listed hackathons you register for, your funnel from opened to won, win rate, month by month, how often and when you open the app, whether emails, notifications or the Home Screen bring you back, how long you take to register, the themes and formats you lean towards, and the prize pools you go for. **Market** shows open prize money, new hackathons per week, a calendar of deadlines ahead, prize sizes, themes, platforms and the radar's own health. Activity is counted from when the stats page shipped; stage history from before that was rebuilt from when each hackathon was first saved.

## Push notifications

Notifications reach the phone like any app's, so you hear about a match even when you skip the email. They're sent by the same step as the emails, after every refresh:

- **New matches:** hackathons that fit your alert rules (Settings › Email alerts).
- **Big new prizes:** anything over a threshold you pick (default $100K), whatever the rules.
- **Closing soon:** saved hackathons, a set number of days before registration closes.
- **Weekly summary:** optional, Monday mornings.

Quiet hours hold notifications until the first check after they end, in the phone's timezone. Tapping a notification opens the hackathon (or Explore filtered to the new ones).

Set up once: `cd backend && python -m app.push --generate-key`, then add the printed `VAPID_PRIVATE_KEY` on Render and as a GitHub secret. On the phone: add the app to the Home Screen (iPhone needs this, iOS 16.4 or later), open it from there, connect the device, then Settings › Notifications › Allow notifications. **Send a test notification** checks the whole path.

## Emails

`python -m app.notify` runs after every refresh (the last step of the *Refresh hackathons* workflow) and sends, via Resend, whatever you've switched on in **Settings** (it also sends the push notifications):

- **New hackathon alerts:** hackathons that appeared since the last check and match your rules (minimum prize, categories, formats, international only, skip student-only). One email per refresh, only when something matches. The very first run just records a starting point.
- **Closing soon:** for hackathons marked Interested or Registered, once, a set number of days before registration closes.
- **Weekly digest:** Monday mornings (UTC): the week's best matches and your deadlines for the next 7 days.

`python -m app.notify --dry-run` prints what would be sent (emails and pushes) without sending or recording anything. Without `RESEND_API_KEY` and `NOTIFY_EMAIL` the emails are skipped with a warning; without `VAPID_PRIVATE_KEY` the pushes are.

## Fast loading

The free Render API sleeps after 15 minutes idle and takes 30-60 seconds to wake. To avoid that wait, the site reads a static copy of the data first:

- After every refresh, `.github/workflows/publish-data.yml` runs `python -m app.snapshot` and publishes the result to GitHub Pages (`https://<user>.github.io/<repo>/`): `list.json`, `meta.json` and one `h/<id>.json` per hackathon. The files are the API's own responses, so the two never differ.
- The frontend fetches those files first (`SNAPSHOT_URL` in `frontend/src/lib/api.ts`, overridable with `VITE_SNAPSHOT_URL`, or `off`). It falls back to the API if a file is missing, and asks the API too if the copy is more than 13 hours old.
- Run it by hand from Actions → *Publish data snapshot* → *Run workflow*.

## API

- `GET /hackathons`: takes `sort` (`prize` default, `deadline`, `new`, `relevance`), `category` (repeatable), `format`, `min_prize`, `international_ok`, `student_only`, `status` (default `open,upcoming`), `q`, `limit`, `offset`. Returns `{items, total, limit, offset}`.
- `GET /hackathons/{id}`: everything in the list plus `description` (the long text) and `prizes` (the breakdown, with each prize's amount per winner and the winner count).
- `GET /meta`: category counts, last refresh time, and the latest run per source with fetched/new/errors/tokens.
- `GET /push/key`: the public key for push subscriptions (null when push isn't set up).
- `GET /stats`: market numbers for the stats page (also in the snapshot as `stats.json`).
- `/me/...` (needs `X-Personal-Key`): `GET /me`, `PUT /me/hackathons/{id}`, `PUT /me/settings`, `POST /me/add/find`, `POST /me/add`, `PATCH`/`DELETE /me/add/{id}` (add, edit and delete hackathons you added), `POST`/`DELETE /me/push` (this device's push subscription), `POST /me/push/test`, `GET /me/stats` and `POST /me/events` (app opens and hackathons viewed, for the stats page).
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
