import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Icon, type IconName } from "../components/Icon";
import { GlassButton, Menu, Thumb } from "../components/kit";
import { OverlayPage } from "../components/OverlayPage";
import { fetchData, type Hackathon, type HackathonDetail } from "../lib/api";
import { calendarEvents, downloadIcs, googleCalendarUrl } from "../lib/calendar";
import {
  categoryLabel,
  cleanText,
  daysLeft,
  durationDays,
  dayMonth,
  FORMAT_LABEL,
  hostOf,
  imageOf,
  money,
  prizeShort,
  sourceName,
  timeAgo,
  timeUtc,
  weekdayDate,
} from "../lib/format";
import { bouncy, press, spring } from "../lib/motion";
import { claudeUrl, ideasPrompt } from "../lib/prompt";
import { type Stage, track, usePersonal } from "../lib/personal";
import { copyText, toast } from "../lib/toast";
import { cn } from "../lib/utils";

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
  const img = imageOf(h);

  const share = async () => {
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
  };

  const toggleSave = () => {
    track(h, { status: saved ? null : "saved" });
    toast(saved ? "Removed from Saved" : "Saved", "bookmark");
  };

  return (
    <OverlayPage
      title={h.title}
      backdrop={
        img ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[400px] overflow-hidden">
            <img src={img} alt="" className="absolute -top-24 -left-20 h-[540px] w-[calc(100%+160px)] object-cover opacity-50 blur-[60px] saturate-150 dark:opacity-55" />
            <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, color-mix(in srgb, var(--bg) 0%, transparent) 0%, var(--bg) 100%)" }} />
          </div>
        ) : undefined
      }
      right={
        <div className="glass flex h-11 rounded-full">
          <motion.button type="button" aria-label="Share" onClick={share} whileTap={{ scale: 0.85 }} transition={bouncy} className="flex w-[46px] items-center justify-center text-label">
            <Icon name="share" size={20} stroke={2.1} />
          </motion.button>
          <motion.button
            type="button"
            aria-label={saved ? "Remove from Saved" : "Save"}
            aria-pressed={saved}
            onClick={toggleSave}
            whileTap={{ scale: 0.8 }}
            transition={bouncy}
            className={cn("flex w-[46px] items-center justify-center", saved ? "text-tint" : "text-label")}
          >
            <motion.span key={String(saved)} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={bouncy}>
              <Icon name="bookmark" size={19} stroke={2.1} filled={saved} />
            </motion.span>
          </motion.button>
        </div>
      }
      bar={
        <div className="glass pointer-events-auto flex w-full max-w-[560px] items-center gap-2 rounded-full p-2">
          <CalendarMenu h={h} />
          <motion.a
            href={h.source_url}
            target="_blank"
            rel="noopener noreferrer"
            whileTap={press}
            transition={bouncy}
            className="flex h-[54px] flex-1 flex-col items-center justify-center rounded-full bg-accent text-white"
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

        <Facts h={h} detail={detail} />

        <TrackCard h={h} />

        <ClaudeCard detail={detail} />

        <About h={h} detail={detail} />

        {detail && detail.prizes.length > 0 && <Prizes prizes={detail.prizes} />}

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
      </div>
    </OverlayPage>
  );
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

function Facts({ h, detail }: { h: Hackathon; detail: HackathonDetail | null }) {
  const days = daysLeft(h);
  const formatIcon: IconName = h.format === "in_person" ? "pin" : h.format === "hybrid" ? "shuffle" : "monitor";
  const where = h.format === "online" ? "Online" : h.location_text?.split(",")[0]?.trim() || FORMAT_LABEL[h.format];
  const perks = detail?.prizes.some((p) => p.perks.length) || h.prize_notes;
  const cells: { label: string; value: ReactNode; sub: string; tone?: string }[] = [
    { label: "Prize pool", value: prizeShort(h), sub: perks ? "+ perks" : h.prize_usd ? "in prizes" : "not announced" },
    days === null
      ? { label: "Starts", value: h.start_date ? dayMonth(h.start_date) : "TBA", sub: h.start_date ? "event start" : "no dates yet" }
      : days < 0
        ? { label: "Closed", value: dayMonth(h.registration_deadline), sub: "registration" }
        : { label: "Closes in", value: days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"}`, sub: weekdayDate(h.registration_deadline), tone: days <= 1 ? "text-red" : days <= 7 ? "text-orange" : undefined },
    { label: "Format", value: <Icon name={formatIcon} size={22} />, sub: where },
    {
      label: "Open to",
      value: <Icon name="globe" size={22} />,
      sub: h.international_ok === true ? "Worldwide" : h.international_ok === false ? "Some regions" : h.student_only ? "Students" : "Not stated",
    },
  ];
  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ...spring, delay: 0.05 }}
      aria-label="Key facts"
      className="mt-6 grid grid-cols-4 border-y hairline px-1"
    >
      {cells.map((c, i) => (
        <div key={c.label} className={cn("flex flex-col items-center gap-[3px] px-1 py-3 text-center", i > 0 && "border-l hairline")}>
          <span className="text-[10.5px] font-semibold tracking-[0.03em] text-label-2 uppercase">{c.label}</span>
          <span className={cn("flex h-[26px] items-center text-[calc(19px*var(--ts))] font-bold tracking-[-0.02em] tabular", c.tone)}>{c.value}</span>
          <span className="line-clamp-1 text-caption text-label-2">{c.sub}</span>
        </div>
      ))}
    </motion.section>
  );
}

const STEPS: { value: Stage; label: string }[] = [
  { value: "saved", label: "Interested" },
  { value: "registered", label: "Registered" },
  { value: "submitted", label: "Submitted" },
  { value: "won", label: "Result" },
];
const ORDER: Record<string, number> = { saved: 0, registered: 1, submitted: 2, won: 3, not_placed: 3 };

function TrackCard({ h }: { h: Hackathon }) {
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
  const resultLabel = stage === "won" ? "Won" : stage === "not_placed" ? "Didn't place" : "Result";

  return (
    <section className="card mx-4 mt-5 overflow-hidden rounded-[22px]">
      <div className="px-4 pt-4 pb-3.5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-body font-semibold">Your progress</h2>
          {stage && stage !== "hidden" && (
            <button type="button" onClick={() => track(h, { status: null })} className="text-footnote font-medium text-label-2">
              Remove
            </button>
          )}
        </div>
        <div role="radiogroup" aria-label="Stage" className="mt-3 grid grid-cols-4 gap-[5px]">
          {STEPS.map((s, i) => {
            const on = i <= at;
            const label = i === 3 ? resultLabel : s.label;
            const button = (
              <motion.button
                type="button"
                role="radio"
                aria-checked={i === at}
                whileTap={press}
                transition={bouncy}
                onClick={i === 3 ? undefined : () => track(h, { status: s.value })}
                className="flex w-full flex-col gap-[7px] text-left"
              >
                <span className="relative h-1.5 overflow-hidden rounded-full bg-track">
                  <motion.span
                    initial={false}
                    animate={{ scaleX: on ? 1 : 0 }}
                    transition={{ ...bouncy, delay: on ? i * 0.06 : 0 }}
                    style={{ originX: 0 }}
                    className={cn("absolute inset-0 rounded-full", stage === "not_placed" && i === 3 ? "bg-label-2" : stage === "won" && i === 3 ? "bg-green" : "bg-accent")}
                  />
                </span>
                <span className={cn("text-footnote", i === at ? "font-bold text-label" : "font-medium text-label-2")}>{label}</span>
              </motion.button>
            );
            return i === 3 ? (
              <Menu
                key={s.value}
                title="How did it go?"
                value={stage === "won" || stage === "not_placed" ? stage : undefined}
                items={[
                  { value: "won", label: "Won", icon: "trophy" },
                  { value: "not_placed", label: "Didn't place" },
                ]}
                onSelect={(v) => {
                  track(h, { status: v as Stage });
                  if (v === "won") toast("Congratulations!", "check");
                }}
                trigger={<span>{button}</span>}
              />
            ) : (
              <span key={s.value}>{button}</span>
            );
          })}
        </div>
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
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-white" style={{ background: "linear-gradient(145deg, #E8875E 0%, #C2581F 100%)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2.5l1.9 5.6a3 3 0 0 0 1.9 1.9l5.7 2-5.7 2a3 3 0 0 0-1.9 1.9L12 21.5l-1.9-5.6a3 3 0 0 0-1.9-1.9L2.5 12l5.7-2a3 3 0 0 0 1.9-1.9z" />
            </svg>
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
  const paragraphs = useMemo(() => (detail?.description ?? "").split(/\n\s*\n/).map(cleanText).filter(Boolean), [detail?.description]);
  const lead = h.summary || paragraphs[0] || null;
  const rest = paragraphs.filter((p) => p !== lead);
  const long = rest.join(" ").length > 260 || rest.length > 2;
  const dates = h.start_date || h.end_date;
  return (
    <section>
      <h2 className="mx-5 mt-8 mb-2 text-title2 font-bold tracking-[-0.022em]">About</h2>
      <div className="mx-5">
        {lead ? <p className="text-body leading-[1.42] tracking-[-0.02em]">{lead}</p> : !detail ? <div className="skeleton h-5 w-4/5 rounded" /> : <p className="text-subhead text-label-2">No description yet. The hackathon's page has the details.</p>}
        {rest.length > 0 && (
          <motion.div initial={false} animate={{ height: open || !long ? "auto" : 88 }} transition={spring} className="relative mt-2 overflow-hidden">
            <div className="space-y-2.5 text-subhead leading-[1.45] text-label-2">
              {rest.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            {long && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10" style={{ background: "linear-gradient(transparent, var(--bg))" }} />}
          </motion.div>
        )}
        {long && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 text-subhead font-semibold text-tint">
            {open ? "Less" : "More"}
          </button>
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

function Prizes({ prizes }: { prizes: HackathonDetail["prizes"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? prizes : prizes.slice(0, 4);
  return (
    <section>
      <div className="mx-5 mt-8 mb-2.5 flex items-baseline justify-between">
        <h2 className="text-title2 font-bold tracking-[-0.022em]">Prizes</h2>
        {prizes.length > 4 && (
          <button type="button" onClick={() => setAll((a) => !a)} className="text-subhead font-medium text-tint">
            {all ? "Show fewer" : `See all ${prizes.length}`}
          </button>
        )}
      </div>
      <ul className="card mx-4 overflow-hidden rounded-[22px]">
        <AnimatePresence initial={false}>
          {shown.map((p, i) => {
            const rank = /\b(1st|first|winner|grand)\b/i.test(p.name) ? 1 : /\b(2nd|second|runner)/i.test(p.name) ? 2 : /\b(3rd|third)\b/i.test(p.name) ? 3 : 0;
            const medal = rank === 1 ? "bg-[#FFF4CC] text-[#8A6100] dark:bg-[#FFCC00]/20 dark:text-[#FFD60A]" : rank === 2 ? "bg-[#EEEEF1] text-[#5A5A60] dark:bg-white/15 dark:text-[#D1D1D6]" : rank === 3 ? "bg-[#FBE9DD] text-[#8A4A1C] dark:bg-[#D2691E]/25 dark:text-[#F0A46B]" : "bg-soft text-tint";
            const name = p.name.replace(/\s*[-–]\s*(1st|2nd|3rd|first|second|third)\s+place\s*$/i, "");
            return (
              <motion.li
                key={`${p.name}-${i}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={spring}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-3 pl-3.5">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-callout font-extrabold", medal)}>{rank || <Icon name="trophy" size={17} />}</span>
                  <div className={cn("flex min-h-16 min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-4", i < shown.length - 1 && "border-b hairline")}>
                    <div className="min-w-0 flex-1">
                      <div className="text-callout font-semibold">{name}</div>
                      {(p.perks.length > 0 || p.winners > 1) && (
                        <div className="text-footnote text-label-2">{[p.winners > 1 ? `${p.winners} winners, each` : null, ...p.perks.map(cleanText)].filter(Boolean).join(" · ")}</div>
                      )}
                    </div>
                    <div className="shrink-0 text-body font-bold tracking-[-0.02em] tabular">{p.amount_usd ? money(p.amount_usd) : p.amount_text ?? "Non-cash"}</div>
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
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

function CalendarMenu({ h }: { h: Hackathon }) {
  const events = useMemo(() => calendarEvents(h), [h]);
  if (!events.length) {
    return <GlassButton label="No dates to add to a calendar yet" icon="calendarAdd" size={54} className="pointer-events-none opacity-50" />;
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
        <motion.button type="button" aria-label="Add to calendar" whileTap={{ scale: 0.88 }} transition={bouncy} className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-full bg-fill text-label">
          <Icon name="calendarAdd" size={22} />
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
