import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

import { Icon, type IconName } from "../components/Icon";
import { Banner, CompactBar, DueTag, GlassButton, LargeTitle, PrimaryButton, SectionHeader, StageTag, Thumb, useScrolled } from "../components/kit";
import { WeekRecap } from "../components/StatsTeasers";
import { meta } from "../components/HackRow";
import type { Hackathon } from "../lib/api";
import { DEFAULT_FILTERS, type Filters } from "../lib/filters";
import { bannerOf, daysLeft, iconOf, isNew, nextRefresh, prizeFull, prizeShort, todayLong, weekday, weekdayDate, fallbackArt, dueTag } from "../lib/format";
import { press, rise, spring } from "../lib/motion";
import { type Stage, usePersonal } from "../lib/personal";
import { linkTo, navigate } from "../lib/router";
import { requestSearchFocus, useData } from "../lib/store";
import { cn } from "../lib/utils";

const DISMISSED = "hackathon-radar:dismissed-warning";

export function Today() {
  const d = useData();
  const personal = usePersonal();
  const scrolled = useScrolled(52);

  const tracked = useMemo(() => {
    const out: { h: Hackathon; status: Stage; days: number }[] = [];
    for (const [id, t] of Object.entries(personal.items)) {
      if (t.status !== "saved" && t.status !== "registered") continue;
      const h = d.live.get(id) ?? t.hackathon;
      const days = h ? daysLeft(h) : null;
      if (h && days !== null && days >= 0) out.push({ h, status: t.status, days });
    }
    return out.sort((a, b) => Date.parse(a.h.registration_deadline!) - Date.parse(b.h.registration_deadline!));
  }, [personal.items, d.live]);

  const { closingWeek, featured, closingTop, fresh } = useMemo(() => {
    const mine = new Set(Object.keys(personal.items));
    const week = d.items.filter((h) => {
      const n = daysLeft(h);
      return n !== null && n >= 0 && n < 7;
    });
    const byPrize = [...week].filter((h) => !mine.has(h.id)).sort((a, b) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
    const since = d.newSince ? Date.parse(d.newSince) : null;
    const isFresh = (h: Hackathon) => (since ? Date.parse(h.first_seen_at) > since : isNew(h, d.meta?.first_run_at ?? null));
    const freshList = d.items.filter(isFresh).sort((a, b) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
    return { closingWeek: week, featured: byPrize[0] ?? null, closingTop: byPrize.slice(1, 6), fresh: freshList };
  }, [d.items, d.newSince, d.meta, personal.items]);

  const goExplore = (patch: Partial<Filters>) => {
    d.setFilters({ ...DEFAULT_FILTERS, sort: d.filters.sort, ...patch });
    navigate("/explore");
  };

  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(DISMISSED);
    } catch {
      return null;
    }
  });
  const showWarning = !!d.warning && d.warning.key !== dismissed;
  // "today", "since yesterday", "since Monday": the section title's wording, for the summary tile.
  const newLabel = freshTitle(d.newSince).replace(/^New (in the )?/, "");

  return (
    <div className="pb-32">
      <CompactBar title="Today" show={scrolled} />
      <LargeTitle
        eyebrow={todayLong()}
        title="Today"
        accessory={
          <GlassButton
            label="Search hackathons"
            icon="search"
            size={40}
            onClick={() => {
              requestSearchFocus();
              navigate("/explore");
            }}
          />
        }
      />

      <AnimatePresence initial={false}>
        {showWarning && (
          <Banner
            onDismiss={() => {
              setDismissed(d.warning!.key);
              try {
                sessionStorage.setItem(DISMISSED, d.warning!.key);
              } catch {
                /* ignore */
              }
            }}
          >
            {d.warning!.text}
          </Banner>
        )}
        {d.slow && d.loading && (
          <Banner icon="refresh" tone="accent">
            <span className="font-semibold">Waking up the server…</span> <span className="text-label-2">It sleeps when idle on the free plan. This takes up to a minute.</span>
          </Banner>
        )}
      </AnimatePresence>

      {d.error && !d.items.length ? (
        <div className="card mx-4 mt-6 rounded-[22px] px-5 py-8 text-center">
          <p className="text-body font-semibold">Couldn't load hackathons</p>
          <p className="mt-1 text-subhead text-label-2">The server didn't answer ({d.error}).</p>
          <PrimaryButton onClick={d.retry} className="mx-auto mt-4 h-11 text-subhead">
            Try again
          </PrimaryButton>
        </div>
      ) : (
        <>
          {/* What the radar found since you last looked comes first: the start of the day. */}
          <NewSection
            loading={d.loading && !d.items.length}
            fresh={fresh}
            title={freshTitle(d.newSince)}
            lastRefresh={d.meta?.last_refresh ?? null}
            onSeeAll={() => goExplore({ newOnly: true })}
          />

          <Glance
            loading={d.loading}
            cells={[
              { kicker: "Closing", icon: "clock", tone: "text-orange", n: closingWeek.length, label: "this week", onClick: () => goExplore({ within: "7", sort: "deadline" }) },
              { kicker: "New", icon: "plus", tone: "text-tint", n: fresh.length, label: newLabel, onClick: () => goExplore({ newOnly: true }) },
              { kicker: "Open", icon: "check", tone: "text-green", n: d.items.length, label: "hackathons", onClick: () => goExplore({}) },
            ]}
          />

          <SectionHeader title="Your deadlines" action={tracked.length ? "All saved" : undefined} href="/saved" />
          {tracked.length ? (
            <div className="no-scrollbar snap-row flex gap-3 overflow-x-auto px-4 pb-2">
              {tracked.slice(0, 8).map((t, i) => (
                <DeadlineCard key={t.h.id} h={t.h} status={t.status} days={t.days} index={i} />
              ))}
            </div>
          ) : (
            <div className="card mx-4 flex items-center gap-4 rounded-[22px] px-4 py-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-soft text-tint">
                <Icon name="bookmark" size={24} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-callout font-semibold">Nothing saved yet</p>
                <p className="text-footnote text-label-2">Swipe left on a hackathon in Explore and tap Save. Its countdown shows up here.</p>
              </div>
            </div>
          )}

          {d.loading && !d.items.length ? (
            <TodaySkeleton />
          ) : (
            <>
              {featured && (
                <>
                  <SectionHeader
                    title="Biggest prize this week"
                    eyebrow={<div className={cn("text-footnote font-semibold tracking-[0.02em] uppercase", dueTag(featured).tone === "red" ? "text-red" : "text-orange")}>{dueTag(featured).text}</div>}
                  />
                  <Hero h={featured} />
                </>
              )}

              {closingTop.length > 0 && (
                <>
                  <SectionHeader title="Closing this week" action={`See all ${closingWeek.length}`} onAction={() => goExplore({ within: "7", sort: "deadline" })} />
                  <ul className="card mx-4 overflow-hidden rounded-[22px]">
                    {closingTop.map((h, i) => (
                      <CompactRow key={h.id} h={h} index={i} last={i === closingTop.length - 1} stage={personal.items[h.id]?.status ?? null} />
                    ))}
                  </ul>
                </>
              )}

            </>
          )}
          <WeekRecap />
        </>
      )}
    </div>
  );
}

function Glance({ cells, loading }: { loading: boolean; cells: { kicker: string; icon: IconName; tone: string; n: number; label: string; onClick: () => void }[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="card mx-4 mt-4 grid grid-cols-3 rounded-[22px]">
      {cells.map((c, i) => (
        <motion.button
          key={c.kicker}
          type="button"
          onClick={c.onClick}
          whileTap={press}
          className={cn("flex flex-col items-start gap-0.5 px-3.5 pt-3 pb-3 text-left", i > 0 && "border-l hairline")}
        >
          <span className={cn("flex items-center gap-1 text-caption font-semibold", c.tone)}>
            <Icon name={c.icon} size={13} stroke={2.6} />
            {c.kicker}
          </span>
          {loading ? <span className="skeleton my-1 h-6 w-12 rounded-md" /> : <span className="text-[calc(24px*var(--ts))] leading-tight font-bold tracking-[-0.025em] tabular">{c.n}</span>}
          <span className="text-caption text-label-2">{c.label}</span>
        </motion.button>
      ))}
    </motion.div>
  );
}

function DeadlineCard({ h, status, days, index }: { h: Hackathon; status: Stage; days: number; index: number }) {
  const used = Math.min(1, Math.max(0.06, 1 - days / 14));
  const urgent = days <= 1;
  return (
    <motion.a
      href={`/h/${h.id}`}
      onClick={linkTo(`/h/${h.id}`)}
      {...rise(index, 4)}
      whileTap={press}
      className="card flex w-[300px] shrink-0 flex-col rounded-[24px] p-4"
    >
      <div className="flex items-start gap-3">
        <Thumb h={h} size={48} radius={12} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-callout leading-[1.3] font-semibold tracking-[-0.015em]">{h.title}</div>
          <div className="mt-0.5 truncate text-footnote text-label-2">{[h.organizer, prizeFull(h)].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between pt-4">
        <div className={cn("flex items-baseline gap-1.5", urgent ? "text-red" : "text-orange")}>
          <span className="text-[calc(30px*var(--ts))] leading-none font-bold tracking-[-0.03em] tabular">{days === 0 ? "Today" : days}</span>
          {days > 0 && <span className="text-subhead font-semibold">{days === 1 ? "day left" : "days left"}</span>}
        </div>
        <StageTag status={status} className="h-6 rounded-[8px] px-2.5 text-footnote" />
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-track">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${used * 100}%` }}
          transition={{ ...spring, delay: 0.15 + index * 0.05 }}
          className={cn("h-full rounded-full", urgent ? "bg-red-fill" : "bg-orange-fill")}
        />
      </div>
      <div className="mt-2 text-caption text-label-2">Registration closes {weekdayDate(h.registration_deadline)}</div>
    </motion.a>
  );
}

/** A wide banner fills the card; otherwise the square icon sits on a blurred wash of itself. */
function Hero({ h }: { h: Hackathon }) {
  const [bannerFailed, setBannerFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const banner = bannerFailed ? null : bannerOf(h);
  const icon = iconOf(h);
  // Without a banner: an icon image that turns out wide fills the card too.
  const [iconWide, setIconWide] = useState<boolean | null>(null);
  const wide = banner ? true : iconWide;
  const art = fallbackArt(h);
  const src = banner ?? (failed ? null : (icon?.src ?? null));
  const isLogo = !banner && !!icon?.logo;
  return (
    <motion.a
      href={`/h/${h.id}`}
      onClick={linkTo(`/h/${h.id}`)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      whileTap={press}
      className="card mx-4 block overflow-hidden rounded-[26px]"
    >
      <div className="relative h-[184px] overflow-hidden" style={{ background: src ? "var(--card-2)" : art.gradient }}>
        {src ? (
          <>
            {wide === false && <img src={src} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-70 blur-2xl saturate-150" />}
            <img
              src={src}
              alt=""
              onLoad={(e) => !banner && setIconWide(!isLogo && e.currentTarget.naturalWidth / e.currentTarget.naturalHeight > 1.35)}
              onError={() => (banner ? setBannerFailed(true) : setFailed(true))}
              className={cn(
                wide === false
                  ? cn(
                      "absolute top-1/2 left-1/2 h-[128px] w-[128px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] shadow-[0_12px_30px_-8px_rgba(0,0,0,0.45)]",
                      isLogo ? "bg-white object-contain p-5" : "object-cover",
                    )
                  : "absolute inset-0 h-full w-full object-cover",
                wide === null && "opacity-0",
              )}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white">
            <svg width="80" height="80" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
              <path d={art.glyph} />
            </svg>
          </div>
        )}
        <span className="absolute top-3 left-3 flex h-7 items-center gap-1.5 rounded-full bg-black/45 px-2.5 text-footnote font-semibold text-white backdrop-blur-xl">
          <Icon name="clock" size={12} stroke={2.8} />
          {dueTag(h).text}
        </span>
      </div>
      <div className="flex items-end gap-3 px-4 pt-3.5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-title3 font-bold tracking-[-0.02em]">{h.title}</div>
          <div className="mt-0.5 truncate text-subhead text-label-2">{meta(h)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[calc(22px*var(--ts))] leading-tight font-bold tracking-[-0.025em] tabular">{prizeFull(h)}</div>
          <div className="text-caption text-label-2">prize pool</div>
        </div>
      </div>
    </motion.a>
  );
}

function CompactRow({ h, index, last, stage }: { h: Hackathon; index: number; last: boolean; stage: Stage | null }) {
  return (
    <motion.li {...rise(index)}>
      <a href={`/h/${h.id}`} onClick={linkTo(`/h/${h.id}`)} className="flex items-center gap-3 pl-3.5 transition-colors active:bg-fill">
        <Thumb h={h} size={52} radius={13} />
        <div className={cn("flex min-h-[76px] min-w-0 flex-1 items-center gap-2.5 py-3 pr-3.5", !last && "border-b hairline")}>
          <div className="min-w-0 flex-1">
            <div className="truncate text-callout font-semibold tracking-[-0.015em]">{h.title}</div>
            <div className="truncate text-footnote text-label-2">{meta(h)}</div>
            <div className="mt-1.5 flex gap-1.5">
              <DueTag h={h} />
              {stage && <StageTag status={stage} />}
            </div>
          </div>
          <div className="shrink-0 text-callout font-bold tracking-[-0.02em] tabular">{prizeShort(h)}</div>
        </div>
      </a>
    </motion.li>
  );
}

/** "New today", "New since yesterday", "New since Monday": since the start of your previous visit. */
function freshTitle(since: string | null): string {
  if (!since) return "New in the last 2 days";
  const day = (t: Date) => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(new Date(since))) / 86_400_000);
  if (diff <= 0) return "New today";
  if (diff === 1) return "New since yesterday";
  return `New since ${weekday(since)}`;
}

function NewSection({ loading, fresh, title, lastRefresh, onSeeAll }: { loading: boolean; fresh: Hackathon[]; title: string; lastRefresh: string | null; onSeeAll: () => void }) {
  if (loading)
    return (
      <div className="mt-6 space-y-3 px-4">
        <div className="skeleton h-6 w-40 rounded-md" />
        <div className="flex gap-3.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-[150px] w-[150px] shrink-0 rounded-[20px]" />
          ))}
        </div>
      </div>
    );
  if (!fresh.length) {
    const next = nextRefresh(lastRefresh);
    const at = new Date(next.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return (
      <>
        <SectionHeader title={title.replace(/^New/, "Nothing new")} />
        <div className="card mx-4 flex items-center gap-4 rounded-[22px] px-4 py-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-soft text-tint">
            <Icon name="refresh" size={24} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-callout font-semibold">You're up to date</p>
            <p className="text-footnote text-label-2">{next.due ? "The radar is checking for new hackathons now." : `The radar checks again around ${at}.`}</p>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <SectionHeader title={title} eyebrow={<div className="text-footnote font-semibold tracking-[0.02em] text-tint uppercase">{fresh.length} found</div>} action={fresh.length > 3 ? `See all ${fresh.length}` : undefined} onAction={onSeeAll} />
      <div className="no-scrollbar snap-row flex gap-3.5 overflow-x-auto px-4 pb-2">
        {fresh.slice(0, 12).map((h, i) => (
          <Tile key={h.id} h={h} index={i} />
        ))}
      </div>
    </>
  );
}

function Tile({ h, index }: { h: Hackathon; index: number }) {
  return (
    <motion.a href={`/h/${h.id}`} onClick={linkTo(`/h/${h.id}`)} {...rise(index, 4)} whileTap={press} className="w-[150px] shrink-0">
      <span className="relative block">
        <Thumb h={h} size={150} radius={20} />
        <span className="absolute top-2 left-2 flex h-[22px] items-center rounded-full bg-accent px-2 text-[11px] font-bold tracking-[0.04em] text-on-accent">NEW</span>
      </span>
      <div className="mt-2 truncate text-subhead font-semibold tracking-[-0.015em]">{h.title}</div>
      <div className="truncate text-footnote text-label-2">{[prizeShort(h), h.format === "online" ? "Online" : h.location_text?.split(",")[0]].filter(Boolean).join(" · ")}</div>
    </motion.a>
  );
}

function TodaySkeleton() {
  return (
    <div className="mt-8 space-y-3 px-4">
      <div className="skeleton h-6 w-48 rounded-md" />
      <div className="skeleton h-[260px] rounded-[26px]" />
      <div className="skeleton mt-6 h-6 w-40 rounded-md" />
      <div className="skeleton h-[230px] rounded-[22px]" />
    </div>
  );
}
