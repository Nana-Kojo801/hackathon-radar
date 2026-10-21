import { motion } from "framer-motion";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ClaudeMark, Icon, type IconName } from "../components/Icon";
import { Cover, GlassButton, Menu, StageTag, Thumb } from "../components/kit";
import { OverlayPage } from "../components/OverlayPage";
import { fromPlatform, Prizes } from "../components/Prizes";
import { fetchData, type Hackathon, type HackathonDetail } from "../lib/api";
import { calendarEvents, downloadIcs, googleCalendarUrl } from "../lib/calendar";
import {
  bannerOf,
  categoryLabel,
  cleanText,
  daysLeft,
  durationDays,
  dayMonth,
  FORMAT_LABEL,
  hostOf,
  iconOf,
  prizeShort,
  sourceName,
  timeAgo,
  timeUtc,
  weekdayDate,
} from "../lib/format";
import { useDesktop } from "../lib/desktop";
import { bouncy, press, spring } from "../lib/motion";
import { claudeUrl, ideasPrompt } from "../lib/prompt";
import { parseBlocks, RichText } from "../lib/richtext";
import { type Stage, track, usePersonal } from "../lib/personal";
import { linkTo } from "../lib/router";
import { logView } from "../lib/stats";
import { copyText, toast } from "../lib/toast";
import { cn } from "../lib/utils";

/**
 * The banner's height: the image's own shape across the screen (share images are
 * 1.91:1; Devpost's header photos are wider), kept between 1.5:1 and 2.6:1 so
 * it's never a sliver or a wall, and capped on wide screens.
 */
const bannerHeight = (ratio: number) => `min(100vw / ${Math.min(2.6, Math.max(1.5, ratio)).toFixed(3)}, 380px)`;

export function Detail({ id, initial }: { id: string; initial?: Hackathon }) {
  const [detail, setDetail] = useState<HackathonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    setError(null);
    fetchData<HackathonDetail>(`h/${id}.json`, `/hackathons/${id}`, ctrl.signal)
      .then(setDetail)
      .catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => logView(id), [id]);

  const h: Hackathon | undefined = detail ?? initial;

  useEffect(() => {
    if (h) document.title = `${h.title} · Hackathon Radar`;
    return () => {
      document.title = "Hackathon Radar";
    };
  }, [h]);

  if (!h) {
    return (
      <OverlayPage title="">
        {error ? (
          <div className="px-8 pt-24 text-center">
            <p className="text-title3 font-semibold">Couldn't load this hackathon</p>
            <p className="mt-1 text-subhead text-label-2">{error}</p>
          </div>
        ) : (
          <DetailSkeleton />
        )}
      </OverlayPage>
    );
  }
  return <Loaded h={h} detail={detail} />;
}

function Loaded({ h, detail }: { h: Hackathon; detail: HackathonDetail | null }) {
  const personal = usePersonal();
  const t = personal.items[h.id];
  const stage: Stage | null = t?.status ?? null;
  const saved = stage !== null && stage !== "hidden";
  const source = sourceName(h);
  const register = `Register on ${source === "the web" ? hostOf(h.source_url) : source}`;
  const days = daysLeft(h);
  const [bannerFailed, setBannerFailed] = useState(false);
  const banner = bannerFailed ? null : bannerOf(h);
  const [bannerRatio, setBannerRatio] = useState(1.91);
  const BANNER_H = bannerHeight(bannerRatio);
  const icon = iconOf(h)?.src ?? null;

  const share = () => shareHackathon(h);
  const desktop = useDesktop();

  const toggleSave = () => {
    track(h, { status: saved ? null : "saved" });
    toast(saved ? "Removed from Saved" : "Saved", "bookmark");
  };

  if (desktop) {
    // The banner across the top, then the facts and the event on the left, and what you do about it on the right.
    return (
      <OverlayPage title={h.title} wide right={<SaveShare saved={saved} onSave={toggleSave} onShare={share} />}>
        <div className="px-10 pb-16">
          <Cover h={h} iconSize={112} className="h-[280px] rounded-[26px]" />
          <motion.header initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="mt-5 flex flex-wrap items-end justify-between gap-5 px-2">
            <div className="flex min-w-0 flex-1 basis-[520px] items-end gap-5">
              {banner && <Thumb h={h} size={104} radius={24} className="-mt-[76px] shadow-[0_0_0_5px_var(--bg),0_14px_30px_-10px_rgba(0,0,0,0.45)]" />}
              <div className="min-w-0">
                <h1 className="text-[30px] leading-tight font-bold tracking-[-0.026em]">{h.title}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {h.organizer && <span className="mr-1.5 text-subhead text-label-2">{h.organizer}</span>}
                  <StatusPill h={h} />
                  <span className="flex h-6 items-center rounded-full bg-fill px-2.5 text-footnote font-semibold text-label-2">{source === "the web" ? "Web" : source}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <CalendarMenu h={h} size={48} />
              <motion.a
                href={h.source_url}
                target="_blank"
                rel="noopener noreferrer"
                whileTap={press}
                transition={bouncy}
                className="flex h-12 flex-col items-center justify-center rounded-full bg-accent px-6 text-on-accent hover:brightness-110"
              >
                <span className="flex items-center gap-1.5 text-callout font-semibold">
                  {register}
                  <Icon name="arrowUpRight" size={15} stroke={2.8} />
                </span>
                {days !== null && days >= 0 && <span className="text-caption font-medium opacity-85">{days === 0 ? "Closes today" : days === 1 ? "Closes tomorrow" : `Closes in ${days} days`}</span>}
              </motion.a>
            </div>
          </motion.header>

          <div className="mt-7 flex items-start gap-6">
            {/* The shared sections bring their phone margins; the negative margin lines them up with the header. */}
            <div className="-mx-4 min-w-0 flex-1">
              <Facts h={h} detail={detail} className="mt-0 grid-cols-4" />
              <About h={h} detail={detail} />
              {detail && prizeItems(detail).length > 0 && <Prizes h={h} items={prizeItems(detail)} />}
              <SourceLine h={h} />
            </div>
            <aside aria-label="Your progress" className="-mx-4 w-[392px] shrink-0">
              <TrackCard h={h} className="mt-0" />
              <Timeline h={h} />
              <ClaudeCard detail={detail} />
              <section className="card mx-4 mt-3 overflow-hidden rounded-[22px] [&>*:last-child_.row-line]:border-b-0">
                {stage === "hidden" ? (
                  <ActionRow icon="undo" label="Show in lists again" onClick={() => track(h, { status: null })} />
                ) : (
                  <ActionRow
                    icon="eyeOff"
                    label="Not interested"
                    destructive
                    onClick={() => {
                      track(h, { status: "hidden" });
                      toast("Hidden from your lists", "eye-off");
                    }}
                  />
                )}
              </section>
            </aside>
          </div>
        </div>
      </OverlayPage>
    );
  }

  return (
    <OverlayPage
      title={h.title}
      backdrop={
        banner ? (
          // The banner runs edge to edge under the floating buttons and fades into the page.
          // Dark underneath: banner art is made for a dark backdrop, and some has transparent parts.
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden bg-[#0e0e12]" style={{ height: `calc(env(safe-area-inset-top) + ${BANNER_H})` }}>
            {/* A strip much wider than the header (Devpost's are around 7:1) is shown whole, over a
                blurred stretch of itself, rather than cropped to its middle. */}
            {bannerRatio > 2.6 && <img src={banner} alt="" className="absolute inset-0 h-full w-full scale-125 object-cover opacity-80 blur-2xl saturate-150" />}
            <img
              src={banner}
              alt=""
              onLoad={(e) => setBannerRatio(e.currentTarget.naturalWidth / Math.max(1, e.currentTarget.naturalHeight))}
              onError={() => setBannerFailed(true)}
              className={cn("absolute inset-0 h-full w-full", bannerRatio > 2.6 ? "object-contain" : "object-cover")}
            />
            <div className="absolute inset-x-0 top-0 h-28" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.32), transparent)" }} />
            <div className="absolute inset-x-0 bottom-0 h-[34%]" style={{ background: "linear-gradient(180deg, transparent, var(--bg))" }} />
          </div>
        ) : icon ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[400px] overflow-hidden">
            <img src={icon} alt="" className="absolute -top-24 -left-20 h-[540px] w-[calc(100%+160px)] object-cover opacity-50 blur-[60px] saturate-150 dark:opacity-55" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--bg) 0%, transparent) 0%, var(--bg) 100%)" }} />
          </div>
        ) : undefined
      }
      right={<SaveShare saved={saved} onSave={toggleSave} onShare={share} />}
      bar={
        <div className="glass pointer-events-auto flex w-full max-w-[560px] items-center gap-2 rounded-full p-2">
          <CalendarMenu h={h} />
          <motion.a
            href={h.source_url}
            target="_blank"
            rel="noopener noreferrer"
            whileTap={press}
            transition={bouncy}
            className="flex h-[54px] flex-1 flex-col items-center justify-center rounded-full bg-accent text-on-accent"
          >
            <span className="flex items-center gap-1.5 text-body font-semibold">
              {register}
              <Icon name="arrowUpRight" size={15} stroke={2.8} />
            </span>
            {days !== null && days >= 0 && <span className="text-caption font-medium opacity-85">{days === 0 ? "Closes today" : days === 1 ? "Closes tomorrow" : `Closes in ${days} days`}</span>}
          </motion.a>
        </div>
      }
    >
      <div className="pb-36">
        {banner ? (
          // The icon overlaps the banner's bottom edge, App Store style, with the title below.
          <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="relative px-5" style={{ marginTop: `calc(${BANNER_H} - 60px - 46px)` }}>
            <Thumb h={h} size={92} radius={22} className="shadow-[0_0_0_4px_var(--bg),0_14px_30px_-10px_rgba(0,0,0,0.45)]" />
            <h1 className="mt-3.5 text-title1 font-bold tracking-[-0.026em]">{h.title}</h1>
            {h.organizer && <p className="mt-1 text-subhead text-label-2">{h.organizer}</p>}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <StatusPill h={h} />
              <span className="flex h-6 items-center rounded-full bg-fill px-2.5 text-footnote font-semibold text-label-2">{source === "the web" ? "Web" : source}</span>
            </div>
          </motion.header>
        ) : (
          <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="flex items-start gap-4 px-5 pt-2">
            <Thumb h={h} size={108} radius={24} className="shadow-[0_10px_24px_-6px_rgba(0,0,0,0.35)]" />
            <div className="min-w-0 flex-1 pt-0.5">
              <h1 className="text-title2 font-bold tracking-[-0.022em]">{h.title}</h1>
              {h.organizer && <p className="mt-1 text-subhead text-label-2">{h.organizer}</p>}
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <StatusPill h={h} />
                <span className="flex h-6 items-center rounded-full bg-fill px-2.5 text-footnote font-semibold text-label-2">{source === "the web" ? "Web" : source}</span>
              </div>
            </div>
          </motion.header>
        )}

        <Facts h={h} detail={detail} />

        <TrackCard h={h} />

        <ClaudeCard detail={detail} />

        <About h={h} detail={detail} />

        {detail && prizeItems(detail).length > 0 && <Prizes h={h} items={prizeItems(detail)} />}

        <section className="card mx-4 mt-6 overflow-hidden rounded-[22px] [&>*:last-child_.row-line]:border-b-0">
          <ActionRow icon="share" label="Share hackathon page" onClick={share} />
          {stage === "hidden" ? (
            <ActionRow icon="undo" label="Show in lists again" onClick={() => track(h, { status: null })} />
          ) : (
            <ActionRow
              icon="eyeOff"
              label="Not interested"
              destructive
              onClick={() => {
                track(h, { status: "hidden" });
                toast("Hidden from your lists", "eye-off");
              }}
            />
          )}
        </section>

        <SourceLine h={h} />
      </div>
    </OverlayPage>
  );
}

function SaveShare({ saved, onSave, onShare }: { saved: boolean; onSave: () => void; onShare: () => void }) {
  return (
    <div className="glass flex h-11 rounded-full">
      <motion.button type="button" aria-label="Share" onClick={onShare} whileTap={{ scale: 0.85 }} transition={bouncy} className="flex w-[46px] items-center justify-center text-label">
        <Icon name="share" size={20} stroke={2.1} />
      </motion.button>
      <motion.button
        type="button"
        aria-label={saved ? "Remove from Saved" : "Save"}
        aria-pressed={saved}
        onClick={onSave}
        whileTap={{ scale: 0.8 }}
        transition={bouncy}
        className={cn("flex w-[46px] items-center justify-center", saved ? "text-tint" : "text-label")}
      >
        <motion.span key={String(saved)} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={bouncy}>
          <Icon name="bookmark" size={19} stroke={2.1} filled={saved} />
        </motion.span>
      </motion.button>
    </div>
  );
}

function SourceLine({ h }: { h: Hackathon }) {
  const source = sourceName(h);
  return (
    <p className="mx-8 mt-5 text-center text-footnote text-label-2">
      From {source} · checked {timeAgo(h.last_seen_at)}
      {h.alt_urls.length > 0 && (
        <>
          <br />
          Also listed on{" "}
          {h.alt_urls.map((u, i) => (
            <span key={u}>
              {i > 0 && ", "}
              <a href={u} target="_blank" rel="noopener noreferrer" className="font-medium text-tint">
                {hostOf(u)}
              </a>
            </span>
          ))}
        </>
      )}
    </p>
  );
}

/** The event's dates in order, the next one marked. */
function Timeline({ h }: { h: Hackathon }) {
  const now = Date.now();
  const events = [
    { label: "Registration closes", at: h.registration_deadline },
    { label: "Starts", at: h.start_date },
    { label: "Ends", at: h.end_date },
  ]
    .filter((e): e is { label: string; at: string } => !!e.at && !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!events.length) return null;
  const next = events.findIndex((e) => Date.parse(e.at) >= now);
  return (
    <section className="card mx-4 mt-3 rounded-[22px] px-4 pt-4 pb-2">
      <h2 className="text-headline font-semibold tracking-[-0.02em]">Timeline</h2>
      <ol className="relative mt-2">
        <span aria-hidden="true" className="absolute top-3 bottom-3 left-[4.5px] w-px bg-[var(--sep)]" />
        {events.map((e, i) => {
          const past = Date.parse(e.at) < now;
          return (
            <li key={e.label} className="relative flex items-start gap-3 py-2">
              <span className={cn("relative mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_3px_var(--card)]", i === next ? "bg-accent" : past ? "bg-label-3" : "bg-[var(--viz-muted)]")} />
              <span className="min-w-0">
                <span className={cn("block text-subhead font-medium", past && "text-label-2")}>{e.label}</span>
                <span className="block text-footnote text-label-2">{weekdayDate(e.at)}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * A hackathon in Explore's side pane on a desktop: its art, the facts and your progress,
 * with the full page one click away.
 */
export function Preview({ h }: { h: Hackathon }) {
  const personal = usePersonal();
  const stage = personal.items[h.id]?.status ?? null;
  const saved = stage !== null && stage !== "hidden";
  const source = sourceName(h);
  return (
    <div className="px-5 pt-5 pb-10">
      <Cover h={h} iconSize={76} className="h-[184px] rounded-[18px]" />
      <h2 className="mt-4 text-title2 leading-tight font-bold tracking-[-0.022em]">{h.title}</h2>
      <p className="mt-1 text-subhead text-label-2">{[h.organizer, `on ${source === "the web" ? hostOf(h.source_url) : source}`].filter(Boolean).join(" · ")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusPill h={h} />
        {stage && stage !== "hidden" && <StageTag status={stage} className="h-6 rounded-full px-2.5 text-footnote" />}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <a
          href={h.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-accent text-subhead font-semibold text-on-accent hover:brightness-110"
        >
          Register
          <Icon name="arrowUpRight" size={14} stroke={2.8} />
        </a>
        <button
          type="button"
          aria-label={saved ? "Remove from Saved" : "Save"}
          aria-pressed={saved}
          onClick={() => {
            track(h, { status: saved ? null : "saved" });
            toast(saved ? "Removed from Saved" : "Saved", "bookmark");
          }}
          className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fill", saved ? "text-tint" : "text-label")}
        >
          <Icon name="bookmark" size={19} filled={saved} />
        </button>
        <CalendarMenu h={h} size={44} />
        <button type="button" aria-label="Share" onClick={() => shareHackathon(h)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-fill text-label">
          <Icon name="share" size={19} />
        </button>
      </div>
      <div className="-mx-4">
        <Facts h={h} detail={null} className="mt-4" />
        {h.summary && <p className="mx-4 mt-4 text-[15px] leading-[1.5] text-label">{h.summary}</p>}
        <TrackCard h={h} className="mt-4" />
      </div>
      <a
        href={`/h/${h.id}`}
        onClick={linkTo(`/h/${h.id}`)}
        className="mt-5 flex h-11 items-center justify-center gap-1 rounded-[12px] bg-fill text-subhead font-semibold text-tint hover:bg-soft"
      >
        Open full page
        <Icon name="chevron" size={13} stroke={2.8} />
      </a>
    </div>
  );
}

/** The share sheet on a phone; on a computer, copy the link. */
async function shareHackathon(h: Hackathon) {
  const url = h.source_url;
  if (window.matchMedia("(pointer: coarse)").matches && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: h.title, text: `${h.title}\n${prizeShort(h)} prize pool\n\n${url}` });
      return;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
    }
  }
  if (await copyText(url)) toast("Link copied", "check");
}

function StatusPill({ h }: { h: Hackathon }) {
  const s = h.status === "open" ? ["Open", "bg-green-soft text-green", "bg-green"] : h.status === "upcoming" ? ["Upcoming", "bg-soft text-ink", "bg-tint"] : ["Closed", "bg-neutral-soft text-label-2", "bg-label-2"];
  return (
    <span className={cn("flex h-6 items-center gap-1.5 rounded-full px-2.5 text-footnote font-semibold", s[1])}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s[2])} />
      {s[0]}
    </span>
  );
}

/**
 * The key facts as a 2x2 grid of tiles: a tinted icon and label, the value large,
 * and up to two lines of detail below. Half the width each (not a quarter), so a
 * non-cash prize note or a long place name wraps instead of crowding the row.
 */
export function Facts({ h, detail, className }: { h: Hackathon; detail: HackathonDetail | null; className?: string }) {
  const days = daysLeft(h);
  const perks = detail?.prizes.some((p) => p.perks?.length);
  const place = h.location_text?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  const tiles: { icon: IconName; tint: string; label: string; value: string; sub: string | null; tone?: string }[] = [
    {
      icon: "trophy",
      tint: "var(--gold-fg)",
      label: "Prize pool",
      value: prizeShort(h),
      sub: h.prize_notes ? cleanText(h.prize_notes) : h.prize_usd ? (perks ? "Plus perks" : "In prizes") : "Not announced yet",
    },
    days === null
      ? { icon: "calendar", tint: "var(--tint)", label: "Starts", value: h.start_date ? dayMonth(h.start_date) : "TBA", sub: h.start_date ? weekdayDate(h.start_date) : "No dates yet" }
      : days < 0
        ? { icon: "calendar", tint: "var(--label-2)", label: "Registration", value: "Closed", sub: weekdayDate(h.registration_deadline) }
        : {
            icon: "clock",
            tint: days <= 1 ? "var(--red)" : days <= 7 ? "var(--orange)" : "var(--tint)",
            label: "Closes",
            value: days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`,
            sub: weekdayDate(h.registration_deadline),
            tone: days <= 1 ? "text-red" : days <= 7 ? "text-orange" : undefined,
          },
    {
      icon: h.format === "in_person" ? "pin" : h.format === "hybrid" ? "shuffle" : "monitor",
      tint: "var(--green)",
      label: "Format",
      value: h.format === "online" ? "Online" : h.format === "unknown" ? "TBA" : (place[0] ?? FORMAT_LABEL[h.format]),
      sub: h.format === "online" ? "Join from anywhere" : h.format === "unknown" ? "Not stated yet" : [FORMAT_LABEL[h.format], ...place.slice(1)].join(" · "),
    },
    {
      icon: "globe",
      tint: "#5856D6",
      label: "Open to",
      value: h.international_ok === true ? "Worldwide" : h.international_ok === false ? "Some regions" : h.student_only ? "Students" : "Not stated",
      sub: h.student_only ? "Students only" : h.international_ok === false ? "Check where you can join from" : h.international_ok === true ? "Any country" : "Check the rules",
    },
  ];
  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ ...spring, delay: 0.05 }} aria-label="Key facts" className={cn("mx-4 mt-5 grid grid-cols-2 gap-2.5", className)}>
      {tiles.map((t) => (
        <div key={t.label} className="card flex min-w-0 flex-col rounded-[20px] px-3.5 pt-3 pb-3.5">
          <span className="flex items-center gap-1.5 text-footnote font-semibold text-label-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]" style={{ color: t.tint, background: `color-mix(in srgb, ${t.tint} 14%, transparent)` }}>
              <Icon name={t.icon} size={15} filled />
            </span>
            {t.label}
          </span>
          {/* Long values (a city, "Some regions") step down a size rather than crowd. */}
          <span className={cn("mt-2 line-clamp-2 leading-tight font-bold tracking-[-0.022em] tabular", t.value.length > 11 ? "text-[calc(17px*var(--ts))]" : "text-[calc(22px*var(--ts))]", t.tone)}>{t.value}</span>
          {t.sub && <span className="mt-0.5 line-clamp-2 text-footnote leading-snug text-label-2">{t.sub}</span>}
        </div>
      ))}
    </motion.section>
  );
}

const STEPS: { value: Stage; label: string; icon: IconName }[] = [
  { value: "saved", label: "Saved", icon: "bookmark" },
  { value: "registered", label: "Registered", icon: "ticket" },
  { value: "submitted", label: "Submitted", icon: "send" },
  { value: "won", label: "Result", icon: "trophy" },
];
const ORDER: Record<string, number> = { saved: 0, registered: 1, submitted: 2, won: 3, not_placed: 3 };

function progressLine(h: Hackathon, stage: Stage | null): string {
  const closes = h.registration_deadline && (daysLeft(h) ?? -1) >= 0 ? weekdayDate(h.registration_deadline) : null;
  const due = h.end_date ? weekdayDate(h.end_date) : closes;
  switch (stage) {
    case "saved":
      return closes ? `On your list. Registration closes ${closes}.` : "On your list.";
    case "registered":
      return due ? `You're registered. The event runs until ${due}.` : "You're registered.";
    case "submitted":
      return "Project submitted. Fingers crossed.";
    case "won":
      return "You won. Congratulations!";
    case "not_placed":
      return "Didn't place this time. On to the next one.";
    default:
      return "Track it here: save it, then mark each step as you go.";
  }
}

/** The one thing to do next, as a big button (two for the result). */
function NextStep({ stage, set }: { stage: Stage | null; set: (s: Stage) => void }) {
  const big = "flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-callout font-semibold";
  // A result is the end of the road; the gold (or plain) result node says it.
  if (stage === "won" || stage === "not_placed") return null;
  if (stage === "submitted")
    return (
      <div className="mt-3.5 flex gap-2.5">
        <motion.button type="button" whileTap={press} transition={bouncy} onClick={() => set("won")} className={cn(big, "bg-[var(--gold-bg)] text-[var(--gold-fg)] shadow-[inset_0_0_0_1px_var(--gold-ring)]")}>
          <Icon name="trophy" size={19} filled />
          Won
        </motion.button>
        <motion.button type="button" whileTap={press} transition={bouncy} onClick={() => set("not_placed")} className={cn(big, "bg-fill text-label")}>
          <Icon name="flag" size={19} />
          Didn't place
        </motion.button>
      </div>
    );
  const next: { stage: Stage; label: string; icon: IconName } =
    stage === "registered"
      ? { stage: "submitted", label: "I've submitted", icon: "send" }
      : stage === "saved"
        ? { stage: "registered", label: "I've registered", icon: "ticket" }
        : { stage: "saved", label: "I'm interested", icon: "bookmark" };
  return (
    <motion.button type="button" whileTap={press} transition={bouncy} onClick={() => set(next.stage)} className={cn(big, "mt-3.5 w-full bg-accent text-on-accent")}>
      <Icon name={next.icon} size={19} filled />
      {next.label}
    </motion.button>
  );
}

/**
 * Where you are with this hackathon: a stepper (tap a stage to jump to it), a
 * line on where things stand, and one big button for the next step, so the
 * card reads at a glance on a phone instead of packing four tiles into a row.
 */
export function TrackCard({ h, className }: { h: Hackathon; className?: string }) {
  const personal = usePersonal();
  const t = personal.items[h.id];
  const stage = t?.status ?? null;
  const [note, setNote] = useState(t?.note ?? "");
  const [editing, setEditing] = useState(!!t?.note);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (document.activeElement !== area.current) setNote(t?.note ?? "");
  }, [h.id, t?.note]);

  // Grow the note with its text.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [note, editing]);

  const at = stage && stage !== "hidden" ? ORDER[stage] : -1;
  const set = (s: Stage | null) => {
    track(h, { status: s });
    if (s === "won") toast("Congratulations!", "check");
    else if (s) toast(`Marked ${s === "saved" ? "Interested" : s === "not_placed" ? "Didn't place" : s.charAt(0).toUpperCase() + s.slice(1)}`, "check");
  };
  const resultLabel = stage === "won" ? "Won" : stage === "not_placed" ? "Didn't place" : "Result";

  return (
    <section className={cn("card mx-4 mt-5 overflow-hidden rounded-[22px]", className)}>
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-headline font-semibold tracking-[-0.02em]">Your progress</h2>
          {at >= 0 && (
            <button type="button" onClick={() => set(null)} className="text-footnote font-medium text-label-2">
              Clear
            </button>
          )}
        </div>

        {/* The stepper: a line that fills up to the current stage, a node per stage. */}
        <div role="radiogroup" aria-label="Stage" className="relative mt-4 grid grid-cols-4">
          <span aria-hidden="true" className="absolute top-[15px] right-[12.5%] left-[12.5%] h-[3px] rounded-full bg-fill" />
          <span
            aria-hidden="true"
            className="absolute top-[15px] left-[12.5%] h-[3px] rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${(Math.max(0, at) / 3) * 75}%` }}
          />
          {STEPS.map((st, i) => {
            const done = i < at;
            const current = i === at;
            const label = i === 3 ? resultLabel : st.label;
            const icon: IconName = i === 3 && stage === "not_placed" ? "flag" : st.icon;
            const node = (
              <motion.button
                type="button"
                role="radio"
                aria-checked={current}
                aria-label={label}
                whileTap={{ scale: 0.88 }}
                transition={bouncy}
                onClick={i === 3 ? undefined : () => set(current ? null : st.value)}
                className="relative z-[1] flex w-full flex-col items-center gap-1.5"
              >
                <motion.span
                  key={`${current}-${done}`}
                  initial={current ? { scale: 0.7 } : false}
                  animate={{ scale: 1 }}
                  transition={bouncy}
                  className={cn(
                    "flex h-[33px] w-[33px] items-center justify-center rounded-full transition-colors duration-200",
                    done && "bg-accent text-on-accent",
                    current && (stage === "won" ? "bg-[var(--gold-bg)] text-[var(--gold-fg)] shadow-[0_0_0_2px_var(--gold-ring)]" : "bg-accent text-on-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--accent)_22%,transparent)]"),
                    !done && !current && "bg-card-2 text-label-3 shadow-[inset_0_0_0_1.5px_var(--sep)]",
                  )}
                >
                  {done ? <Icon name="check" size={16} stroke={2.6} /> : <Icon name={icon} size={17} filled={current} />}
                </motion.span>
                <span className={cn("max-w-full truncate px-0.5 text-[calc(12px*var(--ts))] leading-none", current ? "font-bold text-label" : done ? "font-semibold text-label" : "font-medium text-label-2")}>{label}</span>
              </motion.button>
            );
            return i === 3 ? (
              <Menu
                key={st.value}
                title="How did it go?"
                value={stage === "won" || stage === "not_placed" ? stage : undefined}
                items={[
                  { value: "won", label: "Won", icon: "trophy" },
                  { value: "not_placed", label: "Didn't place", icon: "flag" },
                ]}
                onSelect={(v) => set(v as Stage)}
                trigger={<div>{node}</div>}
              />
            ) : (
              <div key={st.value}>{node}</div>
            );
          })}
        </div>

        <p className="mt-4 text-subhead leading-snug text-label-2">{progressLine(h, stage === "hidden" ? null : stage)}</p>

        <NextStep stage={stage === "hidden" ? null : stage} set={set} />
      </div>
      <div className="border-t hairline">
        {editing ? (
          <label className="flex gap-2.5 px-4 py-3">
            <Icon name="pencil" size={18} className="mt-0.5 shrink-0 text-tint" />
            <span className="sr-only">Note</span>
            <textarea
              ref={area}
              value={note}
              autoFocus={!t?.note}
              rows={1}
              maxLength={5000}
              onChange={(e) => {
                setNote(e.target.value);
                track(h, { note: e.target.value }, { debounce: true });
              }}
              onBlur={() => !note.trim() && setEditing(false)}
              placeholder="Ideas, teammates, things to check…"
              className="min-h-[22px] flex-1 resize-none bg-transparent text-callout leading-snug outline-none placeholder:text-label-2"
            />
          </label>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="flex min-h-12 w-full items-center gap-2.5 px-4 text-left active:bg-fill">
            <Icon name="pencil" size={18} className="text-tint" />
            <span className="text-subhead text-label-2">Add a note</span>
          </button>
        )}
      </div>
    </section>
  );
}

function ClaudeCard({ detail }: { detail: HackathonDetail | null }) {
  const prompt = useMemo(() => (detail ? ideasPrompt(detail) : ""), [detail]);
  return (
    <Menu
      title="Project ideas from Claude"
      items={[
        { value: "open", label: "Open in Claude", icon: "arrowUpRight" },
        { value: "copy", label: "Copy prompt", icon: "copy" },
      ]}
      onSelect={async (v) => {
        if (!detail) return;
        if (v === "open") {
          void copyText(prompt);
          window.open(claudeUrl(prompt), "_blank", "noopener,noreferrer");
        } else if (await copyText(prompt)) toast("Prompt copied", "check");
      }}
      trigger={
        <motion.button
          type="button"
          whileTap={press}
          transition={bouncy}
          disabled={!detail}
          className="card mx-4 mt-3 flex w-[calc(100%-32px)] items-center gap-3.5 rounded-[22px] px-4 py-3.5 text-left disabled:opacity-60"
        >
          {/* Claude's mark on a warm cream tile, like its app icon. */}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#F4F1EA] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.08)]">
            <ClaudeMark size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-callout font-semibold">Brainstorm ideas with Claude</span>
            <span className="block text-footnote text-label-2">Shares the rules, prizes and themes</span>
          </span>
          <Icon name="chevron" size={14} stroke={2.8} className="text-label-3" />
        </motion.button>
      }
    />
  );
}

function About({ h, detail }: { h: Hackathon; detail: HackathonDetail | null }) {
  const [open, setOpen] = useState(false);
  const [tall, setTall] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => {
    const src = detail?.about || detail?.description || "";
    const all = parseBlocks(src);
    // The summary is shown as the lead; skip a first paragraph that just repeats it.
    if (h.summary && all[0]?.kind === "p" && all[0].text.slice(0, 60) === h.summary.slice(0, 60)) all.shift();
    return all;
  }, [detail?.about, detail?.description, h.summary]);

  useLayoutEffect(() => {
    if (body.current) setTall(body.current.scrollHeight > 300);
  }, [blocks]);

  const dates = h.start_date || h.end_date;
  return (
    <section>
      <h2 className="mx-5 mt-8 mb-2 text-title2 font-bold tracking-[-0.022em]">About</h2>
      <div className="mx-5">
        {h.summary ? <p className="text-body leading-[1.42] tracking-[-0.02em]">{h.summary}</p> : !detail ? <div className="skeleton h-5 w-4/5 rounded" /> : null}
        {blocks.length > 0 && (
          <motion.div initial={false} animate={{ height: open || !tall ? "auto" : 260 }} transition={spring} className="relative mt-3 overflow-hidden">
            <div ref={body}>
              <RichText blocks={blocks} />
            </div>
            {tall && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16" style={{ background: "linear-gradient(transparent, var(--bg))" }} />}
          </motion.div>
        )}
        {!h.summary && !blocks.length && detail && <p className="text-subhead text-label-2">No description yet. The hackathon's page has the details.</p>}
        {tall && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-subhead font-semibold text-tint">
            {open ? "Show less" : "Read more"}
          </button>
        )}
        {detail?.about && (
          <p className="mt-2 flex items-center gap-1.5 text-caption text-label-2">
            <Icon name="sparkle" size={12} filled />
            Tidied by AI from the organizer's description
          </p>
        )}
        {dates && (
          <p className="mt-3 flex items-center gap-2 text-footnote text-label-2">
            <Icon name="calendar" size={15} />
            Event {dayMonth(h.start_date ?? h.end_date)}
            {h.end_date && h.start_date && ` – ${dayMonth(h.end_date)}`}
            {durationDays(h.start_date, h.end_date) && ` · ${durationDays(h.start_date, h.end_date)}`}
            {h.registration_deadline && ` · registration closes ${timeUtc(h.registration_deadline)}`}
          </p>
        )}
        {h.categories.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {h.categories.map((c) => (
              <span key={c} className="flex h-7 items-center rounded-full bg-soft px-3 text-footnote font-semibold text-ink">
                {categoryLabel(c)}
              </span>
            ))}
            {h.student_only && <span className="flex h-7 items-center rounded-full bg-fill px-3 text-footnote font-semibold text-label-2">Students only</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function ActionRow({ icon, label, onClick, destructive }: { icon: IconName; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-full items-center gap-3 pl-4 text-left active:bg-fill", destructive ? "text-red" : "text-tint")}>
      <Icon name={icon} size={20} />
      <span className="row-line flex min-h-[50px] flex-1 items-center border-b hairline pr-4 text-body">{label}</span>
    </button>
  );
}

function CalendarMenu({ h, size = 54 }: { h: Hackathon; size?: number }) {
  const events = useMemo(() => calendarEvents(h), [h]);
  if (!events.length) {
    return <GlassButton label="No dates to add to a calendar yet" icon="calendarAdd" size={size} className="pointer-events-none opacity-50" />;
  }
  return (
    <Menu
      title="Add to calendar"
      align="start"
      items={[...events.map((ev) => ({ value: ev.kind, label: `Google Calendar: ${ev.kind === "deadline" ? "deadline" : "event"}` })), { value: "ics", label: "Apple Calendar or Outlook", icon: "calendar" as IconName }]}
      onSelect={(v) => {
        if (v === "ics") downloadIcs(h, events);
        else {
          const ev = events.find((e) => e.kind === v);
          if (ev) window.open(googleCalendarUrl(ev, h.location_text), "_blank", "noopener,noreferrer");
        }
      }}
      trigger={
        <motion.button
          type="button"
          aria-label="Add to calendar"
          whileTap={{ scale: 0.88 }}
          transition={bouncy}
          style={{ width: size, height: size }}
          className="flex shrink-0 items-center justify-center rounded-full bg-fill text-label hover:bg-[color-mix(in_srgb,var(--fill)_100%,var(--label)_6%)]"
        >
          <Icon name="calendarAdd" size={size > 48 ? 22 : 20} />
        </motion.button>
      }
    />
  );
}

function DetailSkeleton() {
  return (
    <div className="px-5 pt-2">
      <div className="flex gap-4">
        <div className="skeleton h-[108px] w-[108px] rounded-[24px]" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="skeleton h-6 w-full rounded" />
          <div className="skeleton h-6 w-2/3 rounded" />
          <div className="skeleton h-4 w-1/3 rounded" />
        </div>
      </div>
      <div className="skeleton mt-8 h-16 rounded-xl" />
      <div className="skeleton mt-5 h-28 rounded-[22px]" />
    </div>
  );
}

/** The platform's prize breakdown, or the one the AI read from the description. */
function prizeItems(d: HackathonDetail) {
  const list = d.prizes.length ? d.prizes : (d.about_prizes ?? []);
  return list.map(fromPlatform);
}
