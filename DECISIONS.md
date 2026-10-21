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
- **HackerEarth: tried and removed.** Its hackathon list comes from a public JSON endpoint (`/api/community/challenges/compete/`) that worked from a dev machine but answers 403 to GitHub Actions runners. It also had only one or two open hackathons, with no prize or description. Migration 005 clears what it stored. Web discovery can still find HackerEarth hackathons. `/meta` only reports sources that ran in the last two days, so a removed source stops showing in the health check on its own.
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
- "Richest source" = source priority (Devpost = Devfolio = TAIKAI = ETHGlobal > MLH = Unstop > web) plus the number of filled fields. A lower-priority source never replaces a platform record. Its URL goes into `alt_urls`, and it can only fill fields that are empty. On today's data, 13 MLH events merged into their Devpost pages this way.

- Web finds also dedupe against *each other* (two pages often describe the same event). With overlapping dates, a title containing another counts as a match, e.g. "HackerNoon Decentralize AI Hackathon" = "Decentralize AI Hackathon". The shorter title must be at least 8 characters.
- Web finds stay **hidden from the list until the AI has vetted them**, and enrichment handles unvetted web finds before anything else. Platform listings are usable without the AI; unvetted web finds can be blog posts. The first live run showed exactly that.

## Status

`status` is recomputed from dates on every run. **Registration closed counts as `ended`**: for a discovery tool, an event you can no longer join is over. A row with no dates at all becomes `ended` once no source has seen it for 30 days.

## Web discovery

- Tavily is used only to *find* URLs (5 queries per run, basic depth, ~600 searches/month at a 6-hour cron, inside the free 1,000). The pipeline fetches each page itself (robots.txt respected) so that the links on the page can be kept inline as `anchor [url]`. Listicles are only useful if the AI can see the registration links. If a page blocks the fetch, the search snippet is used instead.
- Domains already covered by adapters (devpost.com, devfolio.co, mlh.*, unstop.com, taikai.network, ethglobal.com), plus social and blog platforms, are skipped before any AI call.
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
- **Cloudflare:** `frontend/wrangler.jsonc` configures the Worker: static assets with single-page-app fallback, plus a script (`worker/index.ts`) that runs first only for `/` and `/h/<id>` to add link-preview tags (Open Graph and Twitter). It reads the hackathon from the GitHub Pages snapshot with a 2.5-second timeout and 10-minute edge cache, and falls back to the site-wide tags. One static preview image is used for every link; a per-hackathon image would need image rendering in the Worker, which isn't worth it for now. Wrangler is pinned as a dev dependency so Cloudflare's build uses a known version.
- **Devpost descriptions:** only `#challenge-description` is kept, split into paragraphs. The sidebar block (`#challenge-information`) added calendar links and counts. Migration 004 makes the details step refetch Devpost pages once; AI enrichment is keyed on `content_hash`, so this costs no OpenAI tokens.

## Personal features

- **No accounts.** One user, so a single secret (`PERSONAL_KEY`, falling back to `ADMIN_TOKEN`) protects the `/me` endpoints, sent as `X-Personal-Key`. Each device stores it in localStorage after checking it against the API. The public hackathon data stays open.
- **Local first.** The free Render API sleeps and can take a minute to wake, so `lib/personal.ts` applies every change at once, keeps it in localStorage with a pending list, and syncs in the background (retries, plus on focus and when back online). The server copy wins on sync except for changes still pending. Notes are sent after a short pause in typing.
- **Data model.** `my_hackathons` has one row per touched hackathon: a stage (or none, for a note only; `hidden` for "not interested") and a note. It references `hackathons` with `ON DELETE CASCADE`. `my_settings` is a single row for the email rules and their last-sent times. `GET /me` returns tracked hackathons with their data even after the event ends and drops out of the public list.
- **Emails run in GitHub Actions**, right after the refresh that may have found something new, rather than on Render, which can't run scheduled jobs on the free plan. "New" for web and Unstop listings means when the AI confirmed them, since they're hidden until then. Each kind is recorded only after its email goes out, so a failed send is retried next run. Resend's shared test sender only delivers to the account owner's address, which is exactly the need here.
- **PWA.** A plain service worker (`public/sw.js`): pages and the data snapshot network-first with the last copy as the offline fallback; hashed `/assets/*` cache-first. No build plugin, since the rules fit in a page of code.
- **Claude prompt.** Built in the browser from the hackathon's data, because Claude often doesn't know small or new hackathons. `claude.ai/new?q=` prefill is undocumented, so Open in Claude also copies the prompt, and very long links fall back to opening Claude empty.

## The iPhone-style redesign

- **Why:** the app is used on a phone, mostly opened from the alert emails, and the Atlantic design read as dated. The new UI follows iOS conventions (large titles, inset grouped lists, a floating tab bar, sheets, swipe actions) so it feels native once installed. The designs were reviewed as mockups before building.
- **Structure:** four tabs (Today, Explore, Saved, Settings) plus pages that slide in over them (a hackathon, Appearance, Notifications, Email alerts). Tabs scroll the window, so each keeps its own position; pushed pages are fixed layers with their own scroll. The router is still a small hand-written one (`lib/router.ts`).
- **Today replaces the paged list as the home screen.** It opens with what the radar found since your last visit ("New today", "New since yesterday", ...; when there's nothing, it says so and when the radar checks next), then the summary row, your deadlines, the biggest prize closing this week and this week's other deadlines. "Since your last visit" is the start of the previous app open more than an hour ago, capped at two weeks (`lastVisit` in `lib/filters.ts`).
- **Explore drops pages** for a list that renders 30 rows at a time as you scroll (all filtering stays in the browser). The Cards/Table toggle is gone; density (compact/comfortable) moved to Appearance.
- **Cover art:** the listings' own images (most platforms provide one), with a gradient tile and a glyph chosen by category when there's none or the image is a platform placeholder.
- **Appearance is per device** (localStorage, like iOS display settings), applied as CSS variables and data attributes on `<html>` before the first paint: theme, accent, Liquid Glass, text size (scales the iOS text styles), density, icon and start tab. The home-screen icon is drawn on a canvas in the chosen style and set as `apple-touch-icon`; iPhone reads it when the app is added, so a change needs a re-add.
- **Liquid Glass** is approximated in CSS: a mostly clear fill, `backdrop-filter` blur and saturation, a bright gradient rim and a top sheen. With it off, glass surfaces use a calmer, more opaque frosted fill. "Reduce transparency" switches both to solid.
- **Motion:** small controls (toggles, selection thumbs, row swipes) use Framer Motion springs (`lib/motion.ts`). Page pushes, the swipe back, sheets, menus and the tab bar pill run on the compositor instead: the same springs are sampled into CSS `linear()` easings (`lib/transition.ts`) and played with the Web Animations API or CSS animations. Driving them from JavaScript every frame was choppy on the phone, most visibly entering and leaving a hackathon. Menus and sheets animate on Radix's `data-state`, so Radix starts the entrance only after the menu is positioned and waits for the exit before unmounting (the old version blinked at the end). The sheet's drag offset is reset on every open; it used to carry over, which left the second open stuck halfway. A shared-layout (`layoutId`) indicator inside a closing sheet stopped it from finishing its exit, so the segmented control moves its thumb by position.
- **Custom accent:** any colour can be picked next to the presets. Text drawn in the accent (`--tint`, `--ink`) is nudged darker or lighter until it reaches 4.5:1 contrast with the background, and text on accent fills (`--on-accent`) is black or white, whichever reads better.
- **App icon: "Scope"**, code brackets around a crosshair (building, and finding the right event), with no letter in it. Chosen from five directions; it replaced an H with signal waves. The shapes live in `lib/mark.ts`, shared by the in-app icon and the canvas drawing in `lib/appearance.ts`, which produces it in the chosen style and accent (the brackets take the accent). The static icons in `public/` are the classic style: a dark slate tile, blue brackets, a lime dot.
- **Notification badge:** Android draws a notification's small icon (status bar and notification header) from the image's alpha alone, so passing the full-colour icon showed a white square. `public/badge-96.png` is a one-colour version of the mark (white on transparent) passed as the notification's `badge`; the colour icon stays as its `icon`.
- **Tidied descriptions:** platform descriptions arrive raw (broken lines, pasted Markdown, bare links). After enrichment, `pipeline/polish.py` asks the model for clean Markdown (fixed set of headings, lists, links kept) and for the prizes the text names, with track and rank. It runs once per description (hash check), up to `MAX_POLISH_PER_RUN` (default 40) per run, biggest prizes first, three attempts at most. The app shows the tidied copy when there is one and otherwise parses the raw text forgivingly (`lib/richtext.tsx`); only http(s) and mailto links are rendered.
- **Prizes adapt to what a hackathon has:** a summary card, then a podium when there are 1st/2nd/3rd prizes, cards per track, and a grid of special awards. Track and rank come from the AI step or are read from platform prize names ("AI Track - 1st Place").
- **Next refresh** in Settings counts down to the next cron slot (`:17` past every sixth hour UTC). GitHub often starts scheduled runs late, so a slot that has passed without a refresh shows "Any minute" for up to 90 minutes.
- **Push notifications** use Web Push with VAPID, sent from GitHub Actions right after the emails (`app.notify.run_push`). One secret, `VAPID_PRIVATE_KEY`; the public key is derived from it and served at `/push/key`, so the two can't drift apart. A send that no device accepts raises, so the markers stay put and the next run retries; subscriptions the push service reports gone (404/410) are deleted. Quiet hours are kept in the phone's timezone, which the app sends when notifications are turned on. Closing-soon pushes have their own `push_reminded_at`, separate from the email's `reminded_at`.
- **Saving without a key** works: changes stay pending on the device and go up when it's connected.
- **Email layout** matches the app: cards with the listing's image, the prize and deadline, and **Open in app** / **Register** buttons.

## Covers, glass cards and the scroll bar

- **Two kinds of artwork:** a square icon for lists and cards, and a wide banner across the top of a hackathon's page. Platforms give one or both (Devfolio a logo and cover; MLH a logo and background; Devpost a square thumbnail, with the header photo read from its page by the detail step; TAIKAI and ETHGlobal a cover; Unstop a logo), stored as `icon_url` and `banner_url` (migration 012). For what's missing, `pipeline/artwork.py` looks: a banner from the share image of the hackathon's own page, an icon from the organizer's website (the AI maps organizer names to domains in one batched call, cached in `organizer_sites`) or the event site's own icon. Every image's shape is read from the first bytes of the file, so a square thumbnail never becomes a banner (Devpost's share image is its thumbnail) or a banner an icon. Listing sites use one share image and one icon for every event, so an image shared by several listings, or a logo shared by different organizers, is dropped.
- **Where they show:** square spots use the platform's icon, else the organizer's logo padded on a white tile, else the one listing image cropped. A hackathon's page with a banner runs it edge to edge under the floating buttons (its height follows the image's shape, between 1.5:1 and 2.6:1; a much wider strip is shown whole over a blurred stretch of itself), on a dark base since banner art is made for one, with the icon overlapping its bottom edge and the title below, App Store style. Without a banner the page keeps the icon beside the title over a soft wash of it. Today's hero card prefers the banner too.
- **Liquid Glass on cards:** glass only reads when there's something behind it, so in Liquid Glass mode the page gets a faint accent-tinted wash and cards turn slightly clear with a bright rim and a sheen. Cards don't use backdrop blur: the wash is already soft, and blurring every card in a long list makes phone scrolling stutter. Reduce Transparency turns it all off.
- **Bars that appear on scroll** (the compact title bar, a pushed page's header) are a solid fill in the page colour that fades with plain opacity, with no backdrop blur. Safari flickered whenever anything about a blurred backdrop animated: first fading its opacity, then transitioning the blur itself. A see-through fill without blur let text ghost through, so it's solid, like iOS's opaque bars. The scrolled state also flips back 12px lower than it flipped on, so a scroll resting near the threshold can't toggle it.
- **Tabs stay mounted once visited** (hidden with `hidden`, each with its own saved scroll), and switching slides them sideways in the tab bar's direction: the old tab out, the new one in, a full width, with a swift spring (`tab` in `lib/transition.ts`: 90% there by 120ms, settled by 300ms). While they move, both pages are clipped (`clip-path`) to the screen, so one screenful moves rather than a whole page. The page container has `overflow-x: clip`: without it, the page waiting off to the side made the document twice as wide as the screen for the length of the slide, and mobile Chrome (the app is used on Android) positions fixed elements against that wider layout, so the centred tab bar jumped half off screen and crept back. The bar has its own permanent layer (`will-change: transform`). The other tabs are built in the background, one at a time when the phone is idle, so a first visit doesn't stall its slide. Only transforms animate (fading content that holds glass glitches in Safari). During the slide the old tab is taken out of the flow with `position: absolute`, placed so it stays where it was on screen while the window scrolls to the new tab's position. Not `position: fixed`: iPhone Safari composites fixed elements together, and a moving fixed tab dragged the floating tab bar along with it (or off screen). a transformed tab is what its fixed compact bar is positioned against, so `--tab-scroll` keeps the bar at the top of the screen. When the slide ends the old tab is hidden in the same frame its pinning comes off; a second tap mid-slide continues from where the first left off. Remounting a tab on every switch (the old way) reloaded its images and replayed its animations. A hidden tab ignores the window's scroll (`TabActiveContext`), so its bar comes back as it was left. Reduce Motion switches instantly.
- **Switching segments and tabs inside a page** (Saved, Stats, prize groups) swaps the content at once and slides the new one in with a CSS animation (`.swap-in`). Animating the old content out too (framer's `exit`, which lifts it out of the layout while it fades) flickered in Safari when it was removed.
- **Icons are Phosphor**, replacing the hand-drawn line set: a professionally drawn, consistent family, rounded in the spirit of SF Symbols, with a solid version of every icon for selected states (the active tab, coloured Settings tiles, the facts tiles). Only the icons the app uses are copied in (`scripts/icons.mjs`), in three weights, so the bundle doesn't carry the whole set. The `stroke` prop now picks a weight (bold from 2.4).
- **Your progress** is a stepper (saved, registered, submitted, result; tap a stage to jump to it), a line on where things stand, and one big button for the next step ("I'm interested", "I've registered", "I've submitted", then Won / Didn't place). Four equal tiles in a row were cramped on a phone and didn't say what to do next.
- **The Claude card** uses Claude's own mark (from Simple Icons, CC0) in its coral, on a cream tile like the Claude app icon.
- **Key facts on a hackathon's page** are a 2x2 grid of tiles (icon and label, the value large, two lines of detail) instead of four narrow columns, which crowded anything longer than a number, like a non-cash prize note.
- **Prizes, redesigned again:** one card instead of a gradient banner, a podium and tiles. The pool, a thin bar showing how it splits between main places, tracks and special awards (in steps of the accent, matching dots on the group tabs), then the selected group as an iOS-style list with gold, silver and bronze place badges.

## Stats page

- **Where it lives:** a card near the top of Settings (like the account card in iPhone Settings) and a **Your week** card at the bottom of Today. Not a fifth tab: it's a page you visit now and then, and four tabs keep the bar roomy.
- **What it's built from:** the current stage of each tracked hackathon (`my_hackathons`), plus a new activity log (`my_events`): app opens with where they came from, hackathons opened, and stage changes (logged by `PUT /me/hackathons`). Before the log there was no history, so migration 009 rebuilds one: a "saved" at each hackathon's first-tracked time and its current stage at its last update. Opens and views start empty and fill in from the day it ships.
- **Where opens come from:** links in emails carry `?from=email` and the service worker adds `?from=push` to notification taps; otherwise an open is "Home Screen" when the app runs standalone and "Browser" when not. The tag is removed from the address bar straight away. An open is counted once per visit: a tagged link always counts, otherwise only after 30 minutes away.
- **Queued on the device:** events go to localStorage and up in batches (and on hiding the app), so they survive the sleeping API and a device that isn't connected yet. The server clamps their times to the last 30 days.
- **"Listed"** (the denominator of "you register for X%") is every visible hackathon seen by the radar since your first activity, plus anything you tracked.
- **Charts are hand-drawn SVG and HTML** (`components/charts.tsx`), not a library: there are only a few shapes, they need to match the app's look and theme, and a chart library would roughly double the bundle. Marks follow one spec: 4px rounded data-ends on a square baseline, hairline grids, the accent for "you", a recessive grey for comparisons, one-hue heat maps, values in label colours. The four-colour palette for "How you get here" was checked for colour-blind separation in both themes. Every chart can be tapped (or hovered) for exact values.
- **Market stats are public** and go into the snapshot like the list, so that tab loads instantly and works on a device that isn't connected.

## Refresh now

- **It starts the GitHub workflow, not a run on Render.** The secrets, the alert step and the snapshot publish all live in Actions, and the free Render instance is small and sleeps. So `POST /me/refresh` dispatches `refresh.yml` with a fine-grained token (`GITHUB_TOKEN`, Actions read and write on this repo only), and refuses while a run is already queued or running.
- **Progress comes from two places:** GitHub's view of the refresh and publish workflows (queued, running, finished, failed) and the pipeline's own record: each source's row as it finishes, plus `stage` and per-step numbers (`progress`) on the run's `pipeline` row (migration 011). The app polls `GET /me/refresh` every 3 seconds while a run is going and every 30 seconds otherwise, only while Settings is on screen; GitHub's answers are cached for 4 seconds.
- Scheduled runs show up the same way, so the card is also a live view of the 6-hourly refresh.

## Telling the user what actually failed

- Requests that fail carry the HTTP status, and `lib/errors.ts` turns a failure into one plain sentence: a 404 means the server is running an older version (it answers, but doesn't have the route), 401 a rejected key, 5xx an error on the server, and push-subscription errors get their own wording. Before this, turning on notifications said "couldn't reach the server" for everything, which sent us looking at the wrong thing when Render simply hadn't deployed the push routes.
- `GET /health` reports the commit the server is running (`RENDER_GIT_COMMIT`) and whether push is configured, so a deploy can be checked from the browser.


## Desktop layout

- **One app, two layouts.** From 1024px wide (`desk:` in CSS, `useDesktop()` in `lib/desktop.ts`) the app swaps the tab bar for a sidebar and gives each page a desktop arrangement; below that it's the phone app unchanged (a tablet in portrait still gets the phone layout in a centred column). Pages decide their own desktop layout and reuse the phone pieces, so a fix to a card shows up in both.
- **Sidebar, not tabs.** Today, Explore, Saved and Stats, search, and shortcuts that set Explore's filters (with live counts), with Settings and the sync status at the bottom. Switching pages is instant: the sideways tab slide is a phone gesture.
- **Pages still push in from the right,** but beside the sidebar, which stays put, and without the page underneath drifting (it would slide under the sidebar). Escape goes back.
- **Explore is a list with a preview pane** (from 1200px, where both fit): one click shows a hackathon beside the list, a double click or Enter opens its page, the arrow keys move through the list. Filters are a row of menus and toggles instead of the sheet, which stays for categories and platforms.
- **Saved is a board** with a column per stage (Saved, Registered, Submitted, Results). Moving a hackathon on is one drag; the Results column splits into Won and Didn't place while you drag. Hidden hackathons are one button away.
- **Settings opens its pages beside the list** (Appearance by default) rather than pushing them over it: the same pages, rendered without their own back bar (`InlinePage` in `components/OverlayPage.tsx`).
- **A hackathon's page** has its banner as a rounded card across the top, the register button in the header instead of a floating bar, the facts in a row of four, and a right column with your progress, a timeline of its dates, Claude and Not interested.

## Adding a hackathon by hand

- **The radar's own tools, run on request.** Adding uses what web discovery already uses (Tavily, the page reader, OpenAI), on the API server (`app/add.py`), behind the personal key so only your devices spend the AI credit. A link is read directly (with Tavily's extract as a fallback for pages built in the browser); a name, or a social post, is searched for. LinkedIn posts rarely open without a login, so the words in the post's link (`/posts/hackerrank_openai-hackathon-activity-…`) become the search.
- **You confirm before anything is stored,** with up to three candidates to pick from and every field editable. The AI is told to leave anything the pages don't state empty and to use only links that appear on them; social links and made-up URLs are dropped.
- **Stored as a web find, marked `added_by_user`** (migration 013), so dedupe, artwork, the snapshot and a later merge with a platform listing all work as for any listing. Unlike other web finds it shows before the AI has vetted it, the vetting never hides it, and it never triggers an alert (you added it). It's visible in Explore for everyone, like any listing, labelled **Added by you**.
- **It shows at once:** the app adds it to its list and opens its page (read from the API until the snapshot has it), saves it, and the server republishes the snapshot after filling in the summary and artwork. The app checks for that republish over the next couple of minutes; a new snapshot counts as newer by when it was built, not only by refresh time, and an open hackathon page is read again, so the banner and logo appear without reopening the app.
- **Sharing from another app** uses the web app manifest's `share_target`: the installed app appears in Android's share sheet and opens at `/add`.
- **Pictures while you pick:** each candidate's page is read for its share image (kept when it's wide enough to be a banner) and its logo, the same checks the artwork step uses, a few seconds at most and never failing the search. Whatever is found is stored with the listing when you add it, so it has its art from the start.
- **Yours to edit and delete.** Only hackathons with `added_by_user` can be changed (`PATCH /me/add/{id}`) or deleted (`DELETE /me/add/{id}`); a platform's listing can't. An edit keeps your dates and format over the AI's, replaces the summary when you change the description, and has the AI read it again. A link another listing already has is refused. Deleting takes your progress and note on it too. The app swaps in the edited copy at once and republishes the snapshot in the background.

## Refresh status that tells the truth

- The list is loaded once, so "last refreshed" and "next refresh" went stale: after a scheduled time passed, Settings kept saying a run was starting, even after it had finished. The app now checks the snapshot when it comes back to the screen and every few minutes, and reloads when a newer one is out.
- The Search card in Settings uses the server's live record of runs. Scheduled runs show their steps like manual ones. When a scheduled time passes and GitHub hasn't started the run yet (it often starts them late), the card says it's waiting for it, instead of claiming it's running. The duplicate Last/Next refresh rows only show on a device that isn't connected.

## No flicker after a hackathon's page slides in

- The page used to fetch its details and banner only once it appeared, so they landed just after the slide: content appeared, and the banner header resized to the image's shape, moving the whole page. Now a touch on a hackathon starts loading both (`lib/prefetch.ts`), the header's height is fixed from the start (the banner's shape when known, else the usual 1.91:1), and the banner fades in if it's late. The header and facts no longer play their own entrance animation on top of the slide.

## New today, an on-time schedule, folding run steps

- **"New today" means found today**, by the device's clock: every hackathon first seen since midnight, from all of the day's runs, not just those since your last visit (opening the app after the morning run used to hide the morning's finds once the next run landed). Explore's "New today" filter and the sidebar shortcut use the same day. Just after midnight, before the day's first finds, Today shows yesterday's as "New yesterday".
- **The 6-hourly refresh runs on time.** GitHub's scheduled runs started 3 to 6 hours late and some never came, so a refresh due at 18:17 needed Run now. The Cloudflare Worker (already serving the app) has a cron at each slot that calls the API's `POST /schedule/tick`, which starts the run through GitHub with the server's `GITHUB_TOKEN` when none has started since the slot. No key: all it can do is start the run that's due, once. A second cron 30 minutes later covers a slow wake-up of the free API. GitHub's schedule stays as a fallback that skips itself if a run happened in the last 3 hours.
- **The run's steps fold away:** open while a run is going or just failed, folded when it's done, with a button to show or hide them.
