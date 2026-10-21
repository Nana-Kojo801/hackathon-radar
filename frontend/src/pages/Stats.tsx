import { motion } from "framer-motion";
import { type ReactNode, useState } from "react";

import { CalendarHeat, Columns, compact, HBars, HeatGrid, Legend, PairBars, Ring, StackBar } from "../components/charts";
import { Icon, type IconName } from "../components/Icon";
import { PrimaryButton, Segmented } from "../components/kit";
import { OverlayPage } from "../components/OverlayPage";
import { categoryLabel, compactMoney, dayMonth, FORMAT_LABEL, SOURCE_NAME } from "../lib/format";
import { usePersonal } from "../lib/personal";
import { linkTo, navigate } from "../lib/router";
import { type MarketStats, type MyStats, type OpenSource, useMarketStats, useMyStats } from "../lib/stats";
import { cn } from "../lib/utils";
import type { Format } from "../lib/api";

type View = "you" | "market";

/** Your hackathon life in numbers, and the market around it. */
export function StatsPage() {
  const p = usePersonal();
  const [view, setView] = useState<View>(p.key ? "you" : "market");
  // The views slide when switched, not on opening the page (it's already sliding in).
  const [switched, setSwitched] = useState(false);
  const me = useMyStats();
  const market = useMarketStats();

  return (
    <OverlayPage title="Stats" backLabel="Settings" backTo="/settings" wide>
      <div className="pb-24">
        <h1 className="mx-5 mt-1 text-large font-bold tracking-[-0.028em]">Stats</h1>
        <p className="mx-5 mt-1 text-subhead text-label-2">{view === "you" ? "How you find, enter and win hackathons." : "What's out there right now, and how the radar is doing."}</p>
        <Segmented
          label="Stats for"
          value={view}
          onChange={(v) => {
            setView(v);
            setSwitched(true);
          }}
          options={[
            { value: "you", label: "You" },
            { value: "market", label: "Market" },
          ]}
          className="mx-4 mt-4 desk:max-w-[320px]"
        />
        {/* Keyed, so the other view slides in (.swap-in in index.css). Two columns on a desktop:
            the hero, headings and tile rows run across both. */}
        <div key={view} className={cn("desk:grid desk:grid-cols-2 desk:items-start", switched && "swap-in")}>
            {view === "you" ? (
              !p.key ? (
                <ConnectPrompt />
              ) : me.data ? (
                <You s={me.data} />
              ) : (
                <Loading error={me.error && me.errorText} retry={me.retry} />
              )
            ) : market.data ? (
              <Market s={market.data} />
            ) : (
              <Loading error={market.error && market.errorText} retry={market.retry} />
            )}
        </div>
      </div>
    </OverlayPage>
  );
}

// ---------------------------------------------------------------- building blocks

function Card({ title, sub, children, className }: { title?: string; sub?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("card mx-4 mt-3 rounded-[22px] p-4", className)}>
      {title && <h3 className="text-headline font-semibold tracking-[-0.02em]">{title}</h3>}
      {sub && <p className="mt-0.5 text-footnote text-label-2">{sub}</p>}
      <div className={cn(title && "mt-4")}>{children}</div>
    </section>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mx-5 mt-8 mb-0.5 text-title3 font-bold tracking-[-0.022em] desk:col-span-2">{children}</h2>;
}

function Tile({ icon, tone = "text-tint", value, label }: { icon: IconName; tone?: string; value: ReactNode; label: ReactNode }) {
  return (
    <div className="card flex min-w-0 flex-col rounded-[20px] p-3.5">
      <Icon name={icon} size={20} className={tone} />
      <div className="mt-2.5 truncate text-title2 font-bold tracking-[-0.025em] tabular">{value}</div>
      <div className="text-footnote leading-snug text-label-2">{label}</div>
    </div>
  );
}

function Hero({ eyebrow, lead, figure, line, pills }: { eyebrow: string; lead: string; figure: string; line: ReactNode; pills: string[] }) {
  return (
    <div className="mx-4 mt-4 overflow-hidden rounded-[24px] p-5 text-on-accent desk:col-span-2" style={{ background: "linear-gradient(140deg, var(--accent-hi) 0%, var(--accent) 72%)" }}>
      <div className="text-footnote font-semibold tracking-[0.03em] uppercase opacity-80">{eyebrow}</div>
      <div className="mt-2 text-callout font-medium opacity-90">{lead}</div>
      <div className="text-[56px] leading-[1.05] font-bold tracking-[-0.04em]">{figure}</div>
      <div className="mt-1 text-subhead opacity-85">{line}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {pills.map((p) => (
          <span key={p} className="rounded-full bg-[color-mix(in_srgb,var(--on-accent)_16%,transparent)] px-3 py-1 text-footnote font-semibold">
            {p}
          </span>
        ))}
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-[14px] bg-card-2 px-3.5 py-3 text-footnote text-label-2">{children}</p>;
}

function Loading({ error, retry }: { error: string | null; retry: () => void }) {
  if (error)
    return (
      <Card className="mt-4 desk:col-span-2">
        <p className="text-subhead text-label-2">{error}</p>
        <PrimaryButton onClick={retry} className="mt-3 h-10 w-full text-subhead">
          Try again
        </PrimaryButton>
      </Card>
    );
  return (
    <div className="mt-4 space-y-3 px-4 desk:col-span-2" aria-busy="true">
      {[180, 120, 220].map((h, i) => (
        <div key={i} className="animate-pulse rounded-[22px] bg-fill" style={{ height: h }} />
      ))}
    </div>
  );
}

function ConnectPrompt() {
  return (
    <Card className="mt-4 desk:col-span-2">
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-soft text-tint">
          <Icon name="key" size={22} />
        </span>
        <div>
          <p className="text-callout font-semibold">Connect to see your stats</p>
          <p className="mt-0.5 text-footnote text-label-2">Your saves, stages and activity live on your server behind your personal key. The Market tab works without it.</p>
        </div>
      </div>
      <PrimaryButton onClick={() => navigate("/settings")} className="mt-4 h-11 w-full text-subhead">
        Connect in Settings
      </PrimaryButton>
    </Card>
  );
}

const pct = (v: number | null | undefined, digits = 0) => (v == null || !isFinite(v) ? "–" : `${(v * 100).toFixed(digits)}%`);
const days = (v: number | null) => (v == null ? "–" : v < 1 ? "< 1 day" : `${Math.round(v)} day${Math.round(v) === 1 ? "" : "s"}`);
const weekLabel = (iso: string) => dayMonth(iso);
const BLOCKS = ["12a", "3a", "6a", "9a", "12p", "3p", "6p", "9p"];
const BLOCK_RANGE = ["midnight–3 AM", "3–6 AM", "6–9 AM", "9 AM–noon", "noon–3 PM", "3–6 PM", "6–9 PM", "9 PM–midnight"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SOURCES: { key: OpenSource; label: string; color: string }[] = [
  { key: "email", label: "Email", color: "var(--viz-1)" },
  { key: "push", label: "Notification", color: "var(--viz-2)" },
  { key: "home_screen", label: "Home Screen", color: "var(--viz-3)" },
  { key: "browser", label: "Browser", color: "var(--viz-4)" },
];
const platform = (s: string) => (s === "web" ? "Web" : (SOURCE_NAME[s] ?? s));

// ---------------------------------------------------------------- you

function You({ s }: { s: MyStats }) {
  const f = s.funnel;
  const results = f.won + f.not_placed;
  const a = s.activity;
  const steps = [
    ...(f.opened && f.opened_since ? [{ label: "Opened", value: f.opened }] : []),
    { label: "Saved", value: f.saved },
    { label: "Registered", value: f.registered },
    { label: "Submitted", value: f.submitted },
    { label: "Won", value: f.won },
  ];
  const savedTotal = Math.max(1, f.saved);
  const taste = s.categories.filter((c) => c.key !== "open-ended").slice(0, 6);
  // The theme you over-index on most, in share points (a 2-save niche doesn't win on ratio alone).
  const lean = taste
    .filter((c) => c.mine >= 3)
    .map((c) => ({ ...c, gap: c.mine / savedTotal - c.market / Math.max(1, f.listed) }))
    .sort((x, y) => y.gap - x.gap)[0];
  const topSource = SOURCES.map((x) => ({ ...x, n: a.sources[x.key] })).sort((x, y) => y.n - x.n)[0];
  const busiest = a.heatmap.flatMap((row, r) => row.map((v, c) => ({ r, c, v }))).sort((x, y) => y.v - x.v)[0];

  return (
    <>
      <Hero
        eyebrow={`Since ${dayMonth(s.since)}`}
        lead="You register for"
        figure={pct(f.listed ? f.registered / f.listed : 0, 1)}
        line={`of hackathons listed: ${f.registered} of ${f.listed.toLocaleString()}.`}
        pills={[`${f.saved} saved`, `${f.registered} registered`, `${f.won} won`]}
      />

      <Heading>This week</Heading>
      <div className="mx-4 mt-2.5 grid grid-cols-2 gap-3 desk:col-span-2 desk:grid-cols-4">
        <Tile icon="home" value={s.recap.opens} label="times you opened the app" />
        <Tile icon="eye" value={s.recap.views} label="hackathons you looked at" />
        <Tile icon="bookmark" tone="text-orange" value={s.recap.saved} label="saved" />
        <Tile icon="ticket" tone="text-green" value={s.recap.registered} label="registered for" />
      </div>

      <Heading>Your funnel</Heading>
      <Card title="From listed to won" sub={`${f.listed.toLocaleString()} hackathons listed since ${dayMonth(s.since)}${f.opened_since ? `; opens counted from ${dayMonth(f.opened_since)}` : ""}.`}>
        <Funnel steps={steps} />
      </Card>

      <Card title="Results">
        {results ? (
          <div className="flex items-center gap-5">
            <Ring value={f.won} total={results}>
              <div className="text-title2 font-bold tracking-[-0.025em] tabular">{pct(f.won / results)}</div>
              <div className="text-caption text-label-2">win rate</div>
            </Ring>
            <div className="min-w-0 flex-1 space-y-2.5">
              <ResultLine color="var(--accent)" label="Won" value={f.won} />
              <ResultLine color="var(--fill)" label="Didn't place" value={f.not_placed} />
              <ResultLine label="Waiting on results" value={Math.max(0, f.submitted - results)} />
            </div>
          </div>
        ) : (
          <Empty>No results yet. When a hackathon you entered ends, mark it Won or Didn't place and your win rate shows here.</Empty>
        )}
      </Card>

      <Card title="Month by month" sub="Hackathons you saved and registered for.">
        <Columns
          series={[
            { name: "Saved", color: "color-mix(in srgb, var(--accent) 38%, var(--card-2))" },
            { name: "Registered", color: "var(--accent)" },
          ]}
          data={s.monthly.map((m) => ({ label: monthLabel(m.month), values: [m.saved, m.registered] }))}
          tip={(i) => monthLabel(s.monthly[i].month, true)}
          xLabels="all"
        />
        <Legend
          className="mt-3"
          items={[
            { label: "Saved", color: "color-mix(in srgb, var(--accent) 38%, var(--card-2))" },
            { label: "Registered", color: "var(--accent)" },
          ]}
        />
      </Card>

      <Heading>How you use the app</Heading>
      <div className="mx-4 mt-2.5 grid grid-cols-3 gap-3 desk:col-span-2">
        <Tile icon="flame" tone="text-orange" value={a.streak} label={`day streak`} />
        <Tile icon="trophy" tone="text-tint" value={a.longest_streak} label="longest streak" />
        <Tile icon="calendar" tone="text-green" value={a.active_days_30} label="active days of 30" />
      </div>
      {a.since ? (
        <>
          <Card title="Opens per week" sub={`${a.opens} opens and ${a.views} hackathons viewed since ${dayMonth(a.since)}.`}>
            <Columns data={a.per_week.map((w) => ({ label: weekLabel(w.week), values: [w.count] }))} tip={(i) => `Week of ${weekLabel(a.per_week[i].week)}`} />
          </Card>
          <Card title="When you check" sub={busiest?.v ? `Most often ${WEEKDAYS[busiest.r]}s, ${BLOCK_RANGE[busiest.c]} (${s.timezone.replace("_", " ")}).` : "Last 90 days."}>
            {/* Its cells are square, so on a wide card it's kept to a phone's width. */}
            <div className="desk:mx-auto desk:max-w-[400px]">
              <HeatGrid
                grid={a.heatmap}
                rows={WEEKDAYS.map((d) => d.slice(0, 2))}
                cols={BLOCKS}
                describe={(r, c, v) => `${WEEKDAYS[r]}, ${BLOCK_RANGE[c]}: ${v} open${v === 1 ? "" : "s"}`}
              />
            </div>
          </Card>
          <Card title="How you get here" sub={topSource?.n ? `${topSource.label === "Email" ? "Emails bring" : topSource.label === "Notification" ? "Notifications bring" : `The ${topSource.label} brings`} you back most often.` : undefined}>
            <StackBar parts={SOURCES.map((x) => ({ label: x.label, value: a.sources[x.key], color: x.color }))} />
          </Card>
        </>
      ) : (
        <Card>
          <Empty>Opens are counted from now on. Come back in a few days to see when and how you use the app.</Empty>
        </Card>
      )}

      <Heading>Habits</Heading>
      <div className="mx-4 mt-2.5 grid grid-cols-3 gap-3 desk:col-span-2">
        <Tile icon="clock" value={days(s.habits.save_to_register_days)} label="from saving to registering" />
        <Tile icon="calendar" tone="text-green" value={days(s.habits.lead_days)} label="before the deadline you register" />
        <Tile icon="alert" tone="text-orange" value={pct(s.habits.last_minute_pct)} label="registered in the last 48 h" />
      </div>
      <p className="mx-5 mt-2 text-footnote text-label-2">Typical (median) values over {s.habits.registrations} registration{s.habits.registrations === 1 ? "" : "s"}.</p>

      <Heading>What you go for</Heading>
      <Card
        title="Themes"
        sub={lean && lean.gap > 0.05 ? `You lean towards ${categoryLabel(lean.key)}: ${pct(lean.mine / savedTotal)} of your saves, ${pct(lean.market / Math.max(1, f.listed))} of listings.` : "Share of your saves vs all listings."}
      >
        {taste.length ? (
          <PairBars
            a={{ name: "Your saves", color: "var(--accent)" }}
            b={{ name: "All listings", color: "var(--viz-muted)" }}
            rows={taste.map((c) => ({ label: categoryLabel(c.key), a: c.mine / savedTotal, b: c.market / Math.max(1, f.listed) }))}
          />
        ) : (
          <Empty>Save a few hackathons to see what you go for.</Empty>
        )}
      </Card>
      <Card title="Format">
        <PairBars
          a={{ name: "Your saves", color: "var(--accent)" }}
          b={{ name: "All listings", color: "var(--viz-muted)" }}
          rows={s.formats.filter((x) => x.market > 0).map((x) => ({ label: FORMAT_LABEL[x.key as Format] ?? x.key, a: x.mine / savedTotal, b: x.market / Math.max(1, f.listed) }))}
        />
      </Card>
      <Card title="Prize money" sub="Average prize pool.">
        <HBars
          format={(n) => compactMoney(n)}
          rows={[
            { label: "You enter", value: s.prizes.entered_avg ?? 0 },
            { label: "You save", value: s.prizes.saved_avg ?? 0, color: "color-mix(in srgb, var(--accent) 38%, var(--card-2))" },
            { label: "All listings", value: s.prizes.market_avg ?? 0, color: "var(--viz-muted)" },
          ]}
        />
        <div className="mt-4 flex items-baseline justify-between border-t hairline pt-3">
          <span className="text-subhead text-label-2">Prize pools you've entered</span>
          <span className="text-headline font-bold tabular">{compactMoney(s.prizes.entered_total)}</span>
        </div>
        {s.prizes.biggest && (
          <a href={`/h/${s.prizes.biggest.id}`} onClick={linkTo(`/h/${s.prizes.biggest.id}`)} className="mt-3 flex items-center gap-3 rounded-[14px] bg-card-2 px-3 py-2.5">
            <Icon name="trophy" size={20} className="shrink-0 text-orange" />
            <span className="min-w-0 flex-1">
              <span className="block text-caption text-label-2">Biggest you've entered</span>
              <span className="block truncate text-subhead font-semibold">{s.prizes.biggest.title}</span>
            </span>
            <span className="text-subhead font-bold tabular">{compactMoney(s.prizes.biggest.prize_usd)}</span>
            <Icon name="chevron" size={14} className="text-label-3" />
          </a>
        )}
      </Card>
    </>
  );
}

/** The last n days as yyyy-mm-dd (UTC), oldest first. */
function lastDays(n: number): string[] {
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

function monthLabel(m: string, long = false): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-GB", { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });
}

function ResultLine({ color, label, value }: { color?: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      {color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /> : <span className="w-2.5 shrink-0" />}
      <span className="min-w-0 flex-1 text-subhead">{label}</span>
      <span className="text-subhead font-semibold tabular">{value}</span>
    </div>
  );
}

/** Stages as bars against the first one, with the step-to-step conversion. */
function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, ...steps.map((st) => st.value));
  return (
    <div className="space-y-1">
      {steps.map((st, i) => {
        const prev = steps[i - 1]?.value;
        return (
          <div key={st.label}>
            {i > 0 && (
              <div className="flex items-center gap-1.5 py-0.5 pl-[92px] text-caption text-label-2">
                <Icon name="chevronDown" size={12} />
                {/* You can save without opening, so a later step can be bigger than the one before. */}
                {prev && st.value <= prev ? `${pct(st.value / prev)} went on` : ""}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="w-[80px] shrink-0 text-subhead">{st.label}</span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <motion.div
                  className="h-[22px] rounded-r-[4px]"
                  style={{ width: `${Math.max(2, (st.value / top) * 100)}%`, background: "var(--accent)", transformOrigin: "left", opacity: 1 - i * 0.12 }}
                  initial={{ scaleX: 0 }}
                  whileInView={{ scaleX: 1 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ type: "spring", stiffness: 300, damping: 24, delay: i * 0.07 }}
                />
                <span className="shrink-0 text-subhead font-bold tabular">{st.value}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- market

function Market({ s }: { s: MarketStats }) {
  const t = s.totals;
  const weeks = s.new_per_week;
  const counted = weeks.filter((w) => w.count != null);
  const closingTotal = Object.values(s.closing).reduce((a, b) => a + b, 0);
  const busiestDay = Object.entries(s.closing).sort((a, b) => b[1] - a[1])[0];
  const runDays = lastDays(14).map((day) => s.runs.find((r) => r.day === day) ?? { day, fetched: 0, new: 0, tokens: 0, runs: 0, errors: 0 });
  const runs = s.runs.reduce((a, r) => ({ runs: a.runs + r.runs, errors: a.errors + r.errors, tokens: a.tokens + r.tokens, new: a.new + r.new }), { runs: 0, errors: 0, tokens: 0, new: 0 });

  return (
    <>
      <Hero
        eyebrow="Right now"
        lead="Open prize money"
        figure={compactMoney(t.pool)}
        line={`across ${t.open.toLocaleString()} open hackathons on ${t.platforms} platforms.`}
        pills={[`${t.new_7d} new this week`, t.median_prize ? `Typical prize ${compactMoney(t.median_prize)}` : "Prizes vary", `${closingTotal} closing in 8 weeks`]}
      />

      <Heading>Flow</Heading>
      <Card title="New hackathons per week" sub={counted.length < weeks.length ? "Counted from the radar's first run; earlier weeks were the starting backlog." : undefined}>
        {counted.length ? (
          <Columns data={weeks.map((w) => ({ label: weekLabel(w.week), values: [w.count] }))} tip={(i) => `Week of ${weekLabel(weeks[i].week)}`} />
        ) : (
          <Empty>Weekly counts start after the radar's first full week.</Empty>
        )}
      </Card>
      <Card title="Deadlines ahead" sub={busiestDay ? `Busiest day: ${new Date(busiestDay[0] + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, with ${busiestDay[1]} closing.` : "Registration deadlines over the next 8 weeks."}>
        <div className="desk:mx-auto desk:max-w-[400px]">
          <CalendarHeat
            counts={s.closing}
            describe={(d, v) => `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}: ${v} closing`}
          />
        </div>
      </Card>

      <Heading>What's on offer</Heading>
      <Card title="Prize sizes" sub="Open hackathons by total prize pool.">
        <HBars rows={s.prize_buckets.map((b) => ({ label: b.label, value: b.count, color: b.label === "Not stated" ? "var(--viz-muted)" : undefined }))} labelWidth={84} />
      </Card>
      <Card title="Themes" sub="Open hackathons by theme; one can have several.">
        <HBars rows={s.categories.filter((c) => c.category !== "open-ended").slice(0, 8).map((c) => ({ label: categoryLabel(c.category), value: c.count }))} />
      </Card>
      <Card title="Platforms">
        <HBars rows={s.by_source.map((x) => ({ label: platform(x.source), value: x.count }))} labelWidth={84} />
      </Card>

      <Heading>Radar health</Heading>
      <div className="mx-4 mt-2.5 grid grid-cols-3 gap-3 desk:col-span-2">
        <Tile icon="refresh" value={runs.runs} label="refreshes in 14 days" />
        <Tile icon={runs.errors ? "alert" : "check"} tone={runs.errors ? "text-orange" : "text-green"} value={runs.errors} label="source errors" />
        <Tile icon="sparkle" value={compact(runs.tokens)} label="AI tokens used" />
      </div>
      <Card title="New listings found per day" sub={`${runs.new} in the last 14 days.`}>
        <Columns data={runDays.map((r) => ({ label: dayMonth(r.day), values: [r.new] }))} height={110} />
      </Card>
      <Card title="AI tokens per day" sub="Enrichment, web discovery and description tidying.">
        <Columns data={runDays.map((r) => ({ label: dayMonth(r.day), values: [r.tokens] }))} height={110} series={[{ name: "Tokens", color: "var(--viz-muted)" }]} />
      </Card>
      <p className="mx-5 mt-3 text-footnote text-label-2">Updated {new Date(s.generated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.</p>
    </>
  );
}
