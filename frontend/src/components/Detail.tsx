import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { fetchJSON, type Hackathon, type HackathonDetail } from "../lib/api";
import {
  cleanText,
  colorOf,
  day,
  FORMAT_LABEL,
  fullMoney,
  hostOf,
  isUrgent,
  longLeft,
  remaining,
  shortLeft,
  SOURCE_NAME,
} from "../lib/format";
import { CountUp, Ring, type Segment, SplitRing } from "./Ring";

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 30 } },
};

const SHADES = ["", "C8", "96", "6A", "48"];

function useNow(every = 30_000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

interface Props {
  id: string;
  initial?: Hackathon;
  showBack: boolean;
  onBack: () => void;
}

export function Detail({ id, initial, showBack, onBack }: Props) {
  const [detail, setDetail] = useState<HackathonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const now = useNow();

  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    setError(null);
    setExpanded(false);
    fetchJSON<HackathonDetail>(`/hackathons/${id}`, ctrl.signal)
      .then(setDetail)
      .catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    return () => ctrl.abort();
  }, [id]);

  const h: Hackathon | HackathonDetail | undefined = detail ?? initial;

  useEffect(() => {
    if (h) document.title = `${h.title} · Hackathon Radar`;
    return () => {
      document.title = "Hackathon Radar";
    };
  }, [h]);

  const color = h ? colorOf(h) : "#6B6F78";
  const prizes = detail?.prizes ?? [];
  const parts = useMemo(() => {
    const priced = prizes
      .map((p) => ({ ...p, total: (p.amount_usd ?? 0) * Math.max(1, p.winners || 1) }))
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);
    const top = priced.slice(0, 5);
    const rest = priced.slice(5).reduce((a, p) => a + p.total, 0);
    const sum = top.reduce((a, p) => a + p.total, 0) + rest;
    const segs: (Segment & { name: string; amount: string; note: string | null })[] = top.map((p, k) => ({
      color: color + SHADES[k],
      share: p.total / sum,
      name: p.name,
      amount: p.amount_text ?? fullMoney(p.amount_usd ?? 0),
      note: p.winners > 1 ? `${p.winners} winners, each` : null,
    }));
    if (rest > 0) segs.push({ color: "#F2F3F5", share: rest / sum, name: `${priced.length - 5} more prizes`, amount: fullMoney(rest), note: "combined" });
    return segs;
  }, [prizes, color]);
  const nonCash = prizes.filter((p) => !p.amount_usd && (p.perks.length || p.name));

  if (!h) {
    return (
      <div className="flex h-full items-center justify-center">
        {error ? (
          <div className="px-6 text-center">
            <p className="text-soft">Couldn't load this hackathon ({error}).</p>
            <button type="button" onClick={onBack} className="mt-4 h-11 rounded-full bg-ink px-5 font-semibold text-ground">
              Back to the list
            </button>
          </div>
        ) : (
          <div className="spin h-10 w-10 rounded-full border-[3px] border-line border-t-ink" aria-label="Loading" />
        )}
      </div>
    );
  }

  const urgent = isUrgent(h, now);
  const about = cleanText(detail?.description);
  const summary = h.summary || (about ? about.slice(0, 220) : null);
  const segments: Segment[] = parts.length ? parts : [{ color: h.prize_usd ? color + "55" : "#26282E", share: 1 }];
  const leftNote = !h.registration_deadline && !h.start_date
    ? "Dates not announced yet"
    : h.registration_deadline
      ? `left to register · closes ${day(h.registration_deadline)}`
      : `until it starts · ${day(h.start_date)}`;

  const facts = [
    { k: "Format", v: FORMAT_LABEL[h.format] },
    { k: "Location", v: h.location_text || "TBA" },
    { k: "Dates", v: `${day(h.start_date) ?? "?"} – ${day(h.end_date, true) ?? "?"}` },
    { k: "Who can join", v: h.student_only === true ? "Students only" : h.student_only === false ? "Anyone" : "Not stated" },
    { k: "Countries", v: h.international_ok === true ? "Open worldwide" : h.international_ok === false ? "Some regions only" : "Not stated" },
    { k: "Topics", v: h.categories.length ? h.categories.join(", ") : "Not tagged yet" },
  ];

  const share = async () => {
    const url = `${window.location.origin}/h/${h.id}`;
    try {
      if (navigator.share) await navigator.share({ title: h.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setToast("Link copied");
        setTimeout(() => setToast(null), 1600);
      }
    } catch {
      /* share sheet dismissed */
    }
  };

  return (
    <div className="relative h-full">
      <div className="thin-scroll absolute inset-0 overflow-y-auto">
        <motion.div variants={stagger} initial="hidden" animate="show" className="mx-auto max-w-[820px] pb-36">
          <motion.div variants={rise} className="flex items-center justify-between px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            {showBack ? (
              <button type="button" onClick={onBack} className="flex h-11 items-center gap-1.5 rounded-full px-2.5 text-[14px] font-semibold text-ink hover:bg-panel">
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M10 3 L5 8 L10 13" fill="none" stroke="currentColor" strokeWidth="1.8" />
                </svg>
                All hackathons
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={share} aria-label="Share this hackathon" className="flex h-11 w-11 items-center justify-center rounded-full text-soft hover:bg-panel hover:text-ink">
              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M10 13V3M6 7l4-4 4 4M4 11v5a1 1 0 001 1h10a1 1 0 001-1v-5" />
              </svg>
            </button>
          </motion.div>

          <motion.div variants={rise} className="flex flex-wrap items-center gap-6 px-5 pt-3">
            <div className="relative mx-auto shrink-0">
              <Ring value={remaining(h, now)} color={color} size={240} thickness={14} hole="#0E0F12" delay={80} label={`Registration: ${shortLeft(h, now)}`}>
                <SplitRing segments={segments} size={180} thickness={14} hole="#0E0F12" />
              </Ring>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <div className={`font-display text-[32px] leading-none font-black tracking-tight ${urgent ? "text-urgent" : "text-white"}`}>
                  {longLeft(h, now)}
                </div>
                <div className="mt-1.5 max-w-[118px] text-[12px] leading-snug text-muted">{leftNote}</div>
              </div>
            </div>
            <div className="min-w-0 flex-[1_1_300px]">
              <div className="flex items-center gap-2 text-[13px] text-soft">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="truncate">
                  {h.organizer || "Organizer not listed"} · on {SOURCE_NAME[h.source] ?? h.source}
                </span>
              </div>
              <h1 className="mt-2.5 font-display text-[clamp(28px,4vw,40px)] leading-[1.04] font-black tracking-tight">{h.title}</h1>
              <div className="mt-4 text-[13px] text-muted">Prize pool</div>
              <div className="font-display text-[36px] leading-tight font-black tracking-tight">
                {h.prize_usd ? <CountUp value={h.prize_usd} format={fullMoney} /> : h.prize_usd === 0 ? "Non-cash prizes" : "Not listed"}
              </div>
              <div className="text-[12.5px] text-muted">
                {h.prize_usd == null
                  ? "May be announced later"
                  : h.prize_confidence === "high"
                    ? `As listed on ${SOURCE_NAME[h.source] ?? h.source}`
                    : h.prize_text
                      ? `Converted from ${h.prize_text}`
                      : "Estimated"}
              </div>
            </div>
          </motion.div>

          <motion.div variants={rise} className="flex flex-wrap gap-x-5 gap-y-2 px-5 pt-5 text-[12.5px] text-soft">
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-5 rounded-full" style={{ background: color }} />
              Outer ring: time left to register
            </span>
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-5 rounded-full bg-ink" />
              Inner ring: how the prize splits
            </span>
          </motion.div>

          {(parts.length > 0 || nonCash.length > 0) && (
            <motion.section variants={rise} className="mx-5 mt-4 rounded-[20px] bg-panel px-4 py-2">
              <h2 className="pt-2 pb-1 font-display text-[15px] font-extrabold">Prize breakdown</h2>
              {parts.map((p) => (
                <div key={p.name} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{p.name}</span>
                    {p.note && <span className="block text-[11.5px] text-muted">{p.note}</span>}
                  </span>
                  <span className="font-display text-[15px] font-extrabold">{p.amount}</span>
                </div>
              ))}
              {nonCash.slice(0, 4).map((p) => (
                <div key={`nc-${p.name}`} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="h-3 w-3 shrink-0 rounded-full border border-[#4a4e57]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px]">{p.name}</span>
                    {p.perks[0] && <span className="block truncate text-[11.5px] text-muted">{p.perks.join(" · ")}</span>}
                  </span>
                  <span className="text-[12.5px] text-muted">Non-cash</span>
                </div>
              ))}
            </motion.section>
          )}
          {!detail && !error && (
            <motion.div variants={rise} className="mx-5 mt-4 h-24 rounded-[20px] bg-panel shimmer" />
          )}

          <motion.section variants={rise} className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5 px-5 pt-3">
            {facts.map((f) => (
              <div key={f.k} className="rounded-[18px] bg-panel p-3.5">
                <div className="text-[12px] text-muted">{f.k}</div>
                <div className="mt-1 text-[14.5px] leading-snug font-semibold">{f.v}</div>
              </div>
            ))}
          </motion.section>

          <motion.section variants={rise} className="px-5 pt-7">
            <h2 className="mb-2 font-display text-[17px] font-extrabold">About</h2>
            {summary && <p className="text-[17px] leading-relaxed text-ink">{summary}</p>}
            {about && about !== summary && (
              <div className="relative">
                <motion.p
                  initial={false}
                  animate={{ height: expanded ? "auto" : 112 }}
                  transition={{ type: "spring", stiffness: 260, damping: 32 }}
                  className="mt-3 overflow-hidden text-[14.5px] leading-[1.65] text-[#B4B8C0]"
                >
                  {about}
                </motion.p>
                {!expanded && about.length > 320 && (
                  <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-14 bg-gradient-to-t from-ground to-transparent" />
                )}
                {about.length > 320 && (
                  <button type="button" onClick={() => setExpanded((x) => !x)} className="mt-2 h-10 text-[13.5px] font-semibold text-ink underline underline-offset-4">
                    {expanded ? "Show less" : "Read more"}
                  </button>
                )}
              </div>
            )}
            {!summary && !about && <p className="text-muted">{detail ? "No description yet." : "Loading description…"}</p>}
          </motion.section>

          {h.alt_urls.length > 0 && (
            <motion.section variants={rise} className="px-5 pt-6">
              <h2 className="mb-2 font-display text-[15px] font-extrabold">Also listed on</h2>
              <div className="flex flex-wrap gap-2">
                {h.alt_urls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="rounded-full border border-line px-3 py-2 text-[13px] text-soft hover:border-[#4a4e57] hover:text-ink">
                    {hostOf(u)}
                  </a>
                ))}
              </div>
            </motion.section>
          )}
        </motion.div>
      </div>

      <div className="pointer-events-none absolute right-0 bottom-0 left-0 flex justify-center bg-gradient-to-t from-ground via-ground/80 to-transparent px-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <motion.a
          href={h.source_url}
          target="_blank"
          rel="noopener noreferrer"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 28, delay: 0.25 }}
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.98 }}
          className="pointer-events-auto flex h-[60px] w-full max-w-[520px] items-center justify-between rounded-full bg-ink pr-2 pl-6 text-ground shadow-[0_14px_34px_-12px_rgba(0,0,0,0.8)]"
        >
          <span className="flex flex-col">
            <span className="font-display text-[16px] font-extrabold">Register on {SOURCE_NAME[h.source] ?? hostOf(h.source_url)}</span>
            <span className="text-[12px] text-[#4A4E57]">{shortLeft(h, now)}</span>
          </span>
          <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: color }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 12 L12 4 M6 4 H12 V10" fill="none" stroke="#0E0F12" strokeWidth="2.2" />
            </svg>
          </span>
        </motion.a>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 10, x: "-50%" }}
            className="absolute top-16 left-1/2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-ground"
            role="status"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
