import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { Icon, type IconName } from "../components/Icon";
import { Banner, CompactBar, Cover, DeskHeader, DueTag, GlassButton, LargeTitle, PrimaryButton, SectionHeader, StageTag, Thumb, useScrolled } from "../components/kit";
import { WeekRecap } from "../components/StatsTeasers";
import { meta } from "../components/HackRow";
import type { Hackathon } from "../lib/api";
import { useDesktop } from "../lib/desktop";
import { dayStart, DEFAULT_FILTERS, type Filters } from "../lib/filters";
import { bannerOf, countdown, daysLeft, iconOf, nextRefresh, prizeFull, prizeShort, timeAgo, todayLong, weekdayDate, fallbackArt, dueTag } from "../lib/format";
import { press, rise, spring } from "../lib/motion";
import { type Stage, usePersonal } from "../lib/personal";
import { useRefresh } from "../lib/refresh";
import { type Spotlight, spotlights } from "../lib/spotlights";
import { prefetchOn } from "../lib/prefetch";
import { linkTo, navigate } from "../lib/router";
import { requestSearchFocus, useData } from "../lib/store";
import { cn } from "../lib/utils";

const DISMISSED = "hackathon-radar:dismissed-warning";

export function Today() {
  const d = useData();
  const desktop = useDesktop();
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

  const { closingWeek, closingTop, fresh, freshToday, freshDay } = useMemo(() => {
    const mine = new Set(Object.keys(personal.items));
    const week = d.items.filter((h) => {
      const n = daysLeft(h);
      return n !== null && n >= 0 && n < 7;
    });
    const byPrize = [...week].filter((h) => !mine.has(h.id)).sort((a, b) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
    // Everything found today, from every run since midnight. Before today's first finds (just after
    // midnight), yesterday's, so the section isn't empty for the first hours of the day.
    const today = Date.parse(d.newSince ?? dayStart());
    const yesterday = Date.parse(dayStart(1));
    const byPrizeDesc = (a: Hackathon, b: Hackathon) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1);
    const foundToday = d.items.filter((h) => Date.parse(h.first_seen_at) >= today).sort(byPrizeDesc);
    const foundYesterday = foundToday.length ? [] : d.items.filter((h) => Date.parse(h.first_seen_at) >= yesterday && Date.parse(h.first_seen_at) < today).sort(byPrizeDesc);
    return {
      closingWeek: week,
      // The biggest is the spotlight's "Biggest prize this week".
      closingTop: byPrize.slice(1, 6),
      fresh: foundToday.length ? foundToday : foundYesterday,
      freshToday: foundToday.length,
      freshDay: foundToday.length || !foundYesterday.length ? ("today" as const) : ("yesterday" as const),
    };
  }, [d.items, d.newSince, personal.items]);

  const spots = useMemo(
    () => spotlights(d.items, new Set(Object.keys(personal.items)), Date.parse(d.newSince ?? dayStart())),
    [d.items, personal.items, d.newSince],
  );

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
  const freshName = freshDay === "today" ? "New today" : "New yesterday";
  // "See all" opens Explore's "New today" filter, so only for today's.
  const seeAllNew = freshDay === "today" ? () => goExplore({ newOnly: true }) : undefined;

  const banners = (
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
  );
  const glance = [
    { kicker: "Closing", icon: "clock" as IconName, tone: "text-orange", n: closingWeek.length, label: "this week", onClick: () => goExplore({ within: "7", sort: "deadline" }) },
    { kicker: "New", icon: "plus" as IconName, tone: "text-tint", n: freshToday, label: "today", onClick: () => goExplore({ newOnly: true }) },
    { kicker: "Open", icon: "check" as IconName, tone: "text-green", n: d.items.length, label: "hackathons", onClick: () => goExplore({}) },
  ];

  if (desktop) {
    // Two columns: what's new and closing on the left; the numbers, your deadlines and the biggest prize in a rail.
    return (
      <div className="mx-auto max-w-[1160px] px-10 pt-8 pb-16">
        <DeskHeader eyebrow={todayLong()} title="Today" accessory={<RefreshNow />} />
        <div className="-mx-4">{banners}</div>
        {d.error && !d.items.length ? (
          <div className="card mt-6 rounded-[22px] px-5 py-10 text-center">
            <p className="text-body font-semibold">Couldn't load hackathons</p>
            <p className="mt-1 text-subhead text-label-2">The server didn't answer ({d.error}).</p>
            <PrimaryButton onClick={d.retry} className="mx-auto mt-4 h-11 text-subhead">
              Try again
            </PrimaryButton>
          </div>
        ) : (
          <div className="mt-6 flex items-start gap-7">
            <div className="min-w-0 flex-1">
              <NewGrid
                loading={d.loading && !d.items.length}
                fresh={fresh}
                title={freshName}
                lastRefresh={d.meta?.last_refresh ?? null}
                onSeeAll={seeAllNew}
              />
              {closingTop.length > 0 && (
                <>
                  <DeskSection title="Closing this week" action={`See all ${closingWeek.length}`} onAction={() => goExplore({ within: "7", sort: "deadline" })} />
                  <ul className="card overflow-hidden rounded-[22px]">
                    {closingTop.map((h, i) => (
                      <CompactRow key={h.id} h={h} index={i} last={i === closingTop.length - 1} stage={personal.items[h.id]?.status ?? null} />
                    ))}
                  </ul>
                </>
              )}
            </div>
            <aside aria-label="At a glance" className="flex w-[340px] shrink-0 flex-col gap-5">
              <Glance loading={d.loading} cells={glance} className="mx-0 mt-0" />
              <DeadlineList tracked={tracked} />
              {spots.length > 0 && (
                <section aria-label="Spotlight">
                  <h2 className="mb-2 text-headline font-semibold tracking-[-0.02em]">Spotlight</h2>
                  <Spotlights spots={spots} rail />
                </section>
              )}
              <WeekRecap className="mx-0 mt-0" />
            </aside>
          </div>
        )}
      </div>
    );
  }

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

      {banners}

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
            title={freshName}
            lastRefresh={d.meta?.last_refresh ?? null}
            onSeeAll={seeAllNew}
          />

          <Glance loading={d.loading} cells={glance} />

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
              {spots.length > 0 && (
                <>
                  <SectionHeader title="Spotlight" />
                  <Spotlights spots={spots} />
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

function Glance({ cells, loading, className }: { loading: boolean; className?: string; cells: { kicker: string; icon: IconName; tone: string; n: number; label: string; onClick: () => void }[] }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className={cn("card mx-4 mt-4 grid grid-cols-3 rounded-[22px]", className)}>
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
      onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)}
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
function Hero({ h, className, stacked, spot }: { h: Hackathon; className?: string; stacked?: boolean; spot?: Spotlight }) {
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
      onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      whileTap={press}
      className={cn("card mx-4 block overflow-hidden rounded-[26px]", className)}
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
        {spot && (
          <span className="absolute top-3 left-3 flex h-7 max-w-[calc(100%-150px)] items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-footnote font-semibold text-white backdrop-blur-xl">
            <Icon name={spot.icon} size={13} filled />
            <span className="truncate">{spot.label}</span>
          </span>
        )}
        <span className={cn("absolute top-3 flex h-7 items-center gap-1.5 rounded-full bg-black/45 px-2.5 text-footnote font-semibold text-white backdrop-blur-xl", spot ? "right-3" : "left-3")}>
          <Icon name="clock" size={12} stroke={2.8} />
          {dueTag(h).text}
        </span>
      </div>
      <div className={cn("flex gap-3 px-4 pt-3.5 pb-4", stacked ? "flex-col gap-2" : "items-end")}>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-title3 font-bold tracking-[-0.02em]">{h.title}</div>
          <div className="mt-0.5 truncate text-subhead text-label-2">{meta(h)}</div>
          {spot?.why && spot.key !== "prize" && spot.key !== "last" && (
            <div className="mt-1 flex items-center gap-1 text-footnote font-semibold" style={{ color: spot.tone }}>
              <Icon name={spot.icon} size={13} filled />
              {spot.why}
            </div>
          )}
        </div>
        <div className={cn("shrink-0", !stacked && "text-right")}>
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
      <a href={`/h/${h.id}`} onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)} className="flex items-center gap-3 pl-3.5 transition-colors active:bg-fill">
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

function NewSection({ loading, fresh, title, lastRefresh, onSeeAll }: { loading: boolean; fresh: Hackathon[]; title: string; lastRefresh: string | null; onSeeAll?: () => void }) {
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
      <SectionHeader title={title} eyebrow={<div className="text-footnote font-semibold tracking-[0.02em] text-tint uppercase">{fresh.length} found</div>} action={onSeeAll && fresh.length > 3 ? `See all ${fresh.length}` : undefined} onAction={onSeeAll} />
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
    <motion.a href={`/h/${h.id}`} onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)} {...rise(index, 4)} whileTap={press} className="w-[150px] shrink-0">
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

// ---------------------------------------------------------------- desktop

function DeskSection({ title, eyebrow, action, href, onAction }: { title: string; eyebrow?: ReactNode; action?: string; href?: string; onAction?: () => void }) {
  return (
    <div className="mt-8 mb-3 flex items-end justify-between gap-3 first:mt-0">
      <div className="min-w-0">
        {eyebrow}
        <h2 className="text-title2 font-bold tracking-[-0.022em]">{title}</h2>
      </div>
      {action &&
        (href ? (
          <a href={href} onClick={linkTo(href)} className="mb-0.5 shrink-0 text-subhead font-medium text-tint hover:underline">
            {action}
          </a>
        ) : (
          <button type="button" onClick={onAction} className="mb-0.5 shrink-0 text-subhead font-medium text-tint hover:underline">
            {action}
          </button>
        ))}
    </div>
  );
}

/** New listings as cards with their art, three to a row. */
function NewGrid({ loading, fresh, title, lastRefresh, onSeeAll }: { loading: boolean; fresh: Hackathon[]; title: string; lastRefresh: string | null; onSeeAll?: () => void }) {
  if (loading)
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[260px] rounded-[20px]" />
        ))}
      </div>
    );
  if (!fresh.length) {
    const next = nextRefresh(lastRefresh);
    const at = new Date(next.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return (
      <>
        <DeskSection title={title.replace(/^New/, "Nothing new")} />
        <div className="card flex items-center gap-4 rounded-[22px] px-5 py-5">
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
      <DeskSection
        title={title}
        eyebrow={<div className="text-footnote font-semibold tracking-[0.02em] text-tint uppercase">{fresh.length} found</div>}
        action={onSeeAll && fresh.length > 6 ? `See all ${fresh.length}` : undefined}
        onAction={onSeeAll}
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
        {fresh.slice(0, 6).map((h, i) => (
          <motion.a
            key={h.id}
            href={`/h/${h.id}`}
            onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)}
            {...rise(i, 4)}
            className="card flex flex-col overflow-hidden rounded-[20px] transition-transform duration-200 hover:-translate-y-0.5"
          >
            <Cover h={h} className="h-[132px]">
              <span className="absolute top-2.5 left-2.5 flex h-[22px] items-center rounded-full bg-accent px-2 text-[11px] font-bold tracking-[0.04em] text-on-accent">NEW</span>
            </Cover>
            <div className="flex flex-1 flex-col gap-0.5 px-4 pt-3 pb-4">
              <div className="line-clamp-2 text-callout leading-[1.3] font-semibold tracking-[-0.015em]">{h.title}</div>
              <div className="truncate text-footnote text-label-2">{meta(h)}</div>
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <span className="text-body font-bold tracking-[-0.02em] tabular">{prizeShort(h)}</span>
                <DueTag h={h} />
              </div>
            </div>
          </motion.a>
        ))}
      </div>
    </>
  );
}

/** Your saved and registered hackathons by deadline, with how much of the last two weeks is used up. */
function DeadlineList({ tracked }: { tracked: { h: Hackathon; status: Stage; days: number }[] }) {
  return (
    <section className="card rounded-[22px] px-4 pt-4 pb-1.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-headline font-semibold tracking-[-0.02em]">Your deadlines</h2>
        {tracked.length > 0 && (
          <a href="/saved" onClick={linkTo("/saved")} className="text-subhead font-medium text-tint hover:underline">
            All saved
          </a>
        )}
      </div>
      {tracked.length ? (
        <ul className="mt-1">
          {tracked.slice(0, 5).map((t, i) => {
            const urgent = t.days <= 1;
            return (
              <li key={t.h.id} className={cn(i > 0 && "border-t hairline")}>
                <a href={`/h/${t.h.id}`} onClick={linkTo(`/h/${t.h.id}`)} {...prefetchOn(t.h)} className="block py-3 hover:opacity-80">
                  <span className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-subhead font-semibold">{t.h.title}</span>
                    <StageTag status={t.status} />
                  </span>
                  <span className="mt-1 flex justify-between text-footnote text-label-2">
                    <span>Closes {weekdayDate(t.h.registration_deadline)}</span>
                    <span className={cn("font-semibold tabular", urgent ? "text-red" : t.days < 7 ? "text-orange" : "text-label")}>{t.days === 0 ? "Today" : `${t.days} ${t.days === 1 ? "day" : "days"}`}</span>
                  </span>
                  <span className="mt-2 block h-1 overflow-hidden rounded-full bg-track">
                    <span className={cn("block h-full rounded-full", urgent ? "bg-red-fill" : t.days < 7 ? "bg-orange-fill" : "bg-accent")} style={{ width: `${Math.min(1, Math.max(0.06, 1 - t.days / 14)) * 100}%` }} />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="pt-1 pb-3.5 text-footnote text-label-2">Nothing saved yet. Save a hackathon from Explore and its countdown shows up here.</p>
      )}
    </section>
  );
}

/** When the list was last refreshed, and a button to run the search now (once this device is connected). */
function RefreshNow() {
  const d = useData();
  const p = usePersonal();
  const last = d.meta?.last_refresh;
  const next = nextRefresh(last);
  const label = `Refreshed ${timeAgo(last)}${next.due ? "" : ` · next in ${countdown(next.at - Date.now())}`}`;
  return (
    <>
      <span className="text-footnote text-label-2">{last ? label : ""}</span>
      {p.key && <RefreshButton />}
    </>
  );
}

function RefreshButton() {
  const { phase, start, starting } = useRefresh();
  const running = phase.state === "running" || starting;
  return (
    <motion.button
      type="button"
      whileTap={press}
      onClick={() => !running && start()}
      disabled={running}
      className="flex h-10 items-center gap-2 rounded-full bg-fill px-4 text-subhead font-semibold text-label disabled:opacity-70"
    >
      <Icon name="refresh" size={17} className={running ? "animate-spin" : undefined} />
      {running ? "Refreshing…" : "Refresh now"}
    </motion.button>
  );
}

/**
 * The spotlight carousel: swipe sideways through hackathons that stand out for different reasons.
 * The next card peeks in on a phone; dots (and arrows on a computer) show where you are.
 */
function Spotlights({ spots, rail }: { spots: Spotlight[]; rail?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const slideAt = (i: number) => scroller.current?.children[i] as HTMLElement | undefined;
  const onScroll = () => {
    const el = scroller.current;
    const first = slideAt(0);
    if (!el || !first) return;
    setAt(Math.max(0, Math.min(spots.length - 1, Math.round(el.scrollLeft / (first.offsetWidth + 12)))));
  };
  const go = (i: number) => {
    const el = scroller.current;
    const slide = slideAt(i);
    if (el && slide) el.scrollTo({ left: slide.offsetLeft - (el.clientWidth - slide.offsetWidth) / 2, behavior: "smooth" });
  };
  return (
    <div>
      <div
        ref={scroller}
        onScroll={onScroll}
        className={cn("no-scrollbar relative flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1", rail ? "" : "scroll-px-4 px-4")}
      >
        {spots.map((s) => (
          <div key={s.key} className={cn("shrink-0 snap-center", rail ? "w-full" : "w-[calc(100%-36px)]")}>
            <Hero h={s.h} spot={s} className="mx-0 h-full" stacked={rail} />
          </div>
        ))}
      </div>
      {spots.length > 1 && (
        <div className="mt-2.5 flex items-center justify-center gap-1.5">
          {rail && (
            <button type="button" aria-label="Previous" disabled={at === 0} onClick={() => go(at - 1)} className="mr-1 flex h-7 w-7 items-center justify-center rounded-full bg-fill text-label disabled:opacity-35">
              <Icon name="back" size={13} stroke={2.8} />
            </button>
          )}
          {spots.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={`${s.label} (${i + 1} of ${spots.length})`}
              aria-current={i === at || undefined}
              onClick={() => go(i)}
              className="flex h-5 items-center"
            >
              <span className={cn("block h-1.5 rounded-full transition-all duration-300", i === at ? "w-4 bg-accent" : "w-1.5 bg-label-3")} />
            </button>
          ))}
          {rail && (
            <button type="button" aria-label="Next" disabled={at === spots.length - 1} onClick={() => go(at + 1)} className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-fill text-label disabled:opacity-35">
              <Icon name="chevron" size={13} stroke={2.8} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
