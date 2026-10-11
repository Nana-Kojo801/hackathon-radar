import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { type ReactNode, useState } from "react";

import type { Hackathon } from "../lib/api";
import { activeCount, type Filters, type Sort } from "../lib/filters";
import { compactMoney, timeAgo } from "../lib/format";
import { navigate } from "../lib/router";
import { CountUp, Ring } from "./Ring";
import { Tile } from "./Tile";

const PAGE = 36;

interface Props {
  items: Hackathon[];
  loading: boolean;
  slow: boolean;
  error: string | null;
  onRetry: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  openFilters: () => void;
  selectedId: string | null;
  onOpen: (id: string) => void;
  lastRefresh: string | null;
  firstRunAt: string | null;
}

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={`flex h-[38px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
        on ? "border-ink bg-ink text-ground" : "border-[#33363D] text-ink hover:border-[#4a4e57]"
      }`}
    >
      {children}
    </motion.button>
  );
}

const SORTS: [Sort, string][] = [
  ["prize", "Biggest prize"],
  ["deadline", "Closing soon"],
  ["new", "Newest"],
];

export function ListView(p: Props) {
  const [shown, setShown] = useState(PAGE);
  const f = p.filters;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setShown(PAGE);
    p.setFilters({ ...f, [k]: v });
  };
  const n = activeCount(f);
  const prizeTotal = p.items.reduce((a, h) => a + (h.prize_usd ?? 0), 0);
  const visible = p.items.slice(0, shown);

  return (
    <div className="pb-16">
      <header className="flex items-center justify-between px-[18px] pt-[max(1.25rem,env(safe-area-inset-top))]">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
          className="flex items-center gap-2.5"
          aria-label="Hackathon Radar home"
        >
          <span className="relative block h-6 w-6">
            <Ring value={0.72} color="#8B9CFF" size={24} thickness={4} hole="#0E0F12" delay={200}>
              <Ring value={0.45} color="#FFC857" size={10} thickness={3} hole="#0E0F12" delay={500} />
            </Ring>
          </span>
          <span className="font-display text-[17px] font-extrabold tracking-tight">Hackathon Radar</span>
        </a>
        <span className="text-[12.5px] text-muted">Updated {timeAgo(p.lastRefresh)}</span>
      </header>

      <div className="px-[18px] pt-6">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="font-display text-[clamp(32px,6vw,44px)] leading-none font-black tracking-tight"
        >
          Open hackathons
        </motion.h1>
        <div className="mt-2 text-[14.5px] text-soft" aria-live="polite">
          {p.loading ? (
            "Loading…"
          ) : (
            <>
              {p.items.length} open · <span className="font-bold text-white"><CountUp value={prizeTotal} format={compactMoney} /></span> in prizes
            </>
          )}
        </div>
        <div className="mt-3.5 flex items-center gap-2.5 rounded-[14px] bg-panel px-3 py-2.5 text-[12.5px] text-soft">
          <Ring value={0.35} color="#F2F3F5" size={22} thickness={4} delay={300} />
          Each ring empties as its registration deadline gets closer.
        </div>
      </div>

      <div className="sticky top-0 z-10 mt-3 bg-ground/85 px-[18px] pt-2 pb-3 backdrop-blur-md">
        <label className="flex h-[46px] items-center gap-2.5 rounded-[14px] border border-line bg-panel px-3.5 focus-within:border-[#4a4e57]">
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="7.5" cy="7.5" r="5.5" fill="none" stroke="#9EA2AB" strokeWidth="1.8" />
            <path d="M11.5 11.5 L16 16" stroke="#9EA2AB" strokeWidth="1.8" />
          </svg>
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search by name, organizer or topic"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-[#70747d]"
          />
        </label>
        <div className="scrollbar-none -mx-[18px] mt-2.5 flex gap-1.5 overflow-x-auto px-[18px]">
          <Chip on={n > 0} onClick={p.openFilters} label="Open filters">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 4h12M4.5 8h7M7 12h2" />
            </svg>
            Filters{n > 0 ? ` · ${n}` : ""}
          </Chip>
          {SORTS.map(([key, label]) => (
            <Chip key={key} on={f.sort === key} onClick={() => set("sort", key)}>
              {label}
            </Chip>
          ))}
          <Chip on={f.format === "online"} onClick={() => set("format", f.format === "online" ? "" : "online")}>
            Online
          </Chip>
          <Chip on={f.worldwide} onClick={() => set("worldwide", !f.worldwide)}>
            Open worldwide
          </Chip>
        </div>
      </div>

      {p.loading ? (
        <LoadingGrid slow={p.slow} />
      ) : p.error ? (
        <div className="px-6 pt-16 text-center">
          <p className="text-soft">Couldn't reach the server ({p.error}).</p>
          <motion.button whileTap={{ scale: 0.96 }} type="button" onClick={p.onRetry} className="mt-4 h-11 rounded-full bg-ink px-5 font-semibold text-ground">
            Try again
          </motion.button>
        </div>
      ) : (
        <LayoutGroup>
          <motion.div layout className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-3 px-[18px] pt-1">
            <AnimatePresence mode="popLayout" initial={false}>
              {visible.map((h, i) => (
                <Tile key={h.id} h={h} index={i} selected={p.selectedId === h.id} firstRunAt={p.firstRunAt} onOpen={p.onOpen} />
              ))}
            </AnimatePresence>
          </motion.div>
          {p.items.length === 0 && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-6 pt-14 text-center text-muted">
              Nothing matches these filters.
            </motion.p>
          )}
          {p.items.length > shown && (
            <div className="px-[18px] pt-6 text-center">
              <motion.button
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={() => setShown((s) => s + PAGE)}
                className="h-12 rounded-full border border-[#33363D] px-6 text-[14px] font-semibold hover:border-[#4a4e57]"
              >
                Show more ({p.items.length - shown} left)
              </motion.button>
            </div>
          )}
        </LayoutGroup>
      )}
    </div>
  );
}

function LoadingGrid({ slow }: { slow: boolean }) {
  return (
    <div className="px-[18px] pt-1">
      <AnimatePresence>
        {slow && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mb-3 flex items-center gap-3 overflow-hidden rounded-[18px] bg-panel p-3.5"
          >
            <span className="spin h-6 w-6 shrink-0 rounded-full border-[3px] border-line border-t-[#8B9CFF]" />
            <span className="text-[13.5px]">
              <span className="block font-semibold">Waking up the server…</span>
              <span className="block text-muted">It sleeps when idle on the free plan. Up to a minute, then it's fast.</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="shimmer flex flex-col gap-3 rounded-[24px] bg-panel p-3.5" style={{ animationDelay: `${i * 90}ms` }}>
            <div className="mx-auto h-[116px] w-[116px] rounded-full border-[10px] border-line" />
            <div className="h-3.5 w-4/5 rounded bg-line" />
            <div className="h-3 w-1/2 rounded bg-line" />
          </div>
        ))}
      </div>
    </div>
  );
}
