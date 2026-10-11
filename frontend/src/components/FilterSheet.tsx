import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { type ReactNode, useEffect } from "react";

import type { Format } from "../lib/api";
import { DEFAULT_FILTERS, type Filters, MIN_PRIZES } from "../lib/filters";
import { compactMoney, topicColor } from "../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  categories: { category: string; count: number }[];
  resultCount: number;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-[12.5px] font-semibold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      aria-pressed={on}
      className={`flex h-10 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
        on ? "border-ink bg-ink text-ground" : "border-[#33363D] text-ink hover:border-[#4a4e57]"
      }`}
    >
      {children}
    </motion.button>
  );
}

const FORMATS: [Format | "", string][] = [
  ["", "Any"],
  ["online", "Online"],
  ["in_person", "In person"],
  ["hybrid", "Hybrid"],
];

export function FilterSheet({ open, onClose, filters, setFilters, categories, resultCount }: Props) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  const toggleCat = (c: string) =>
    set("categories", filters.categories.includes(c) ? filters.categories.filter((x) => x !== c) : [...filters.categories, c]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center wide:items-center">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            className="relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-[28px] border border-line bg-panel wide:rounded-[28px]"
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 360, damping: 36 }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div
              className="flex touch-none justify-center pt-3 pb-1 wide:hidden"
              onPointerDown={(e) => drag.start(e)}
            >
              <span className="h-1.5 w-10 rounded-full bg-[#3a3d45]" />
            </div>
            <div className="flex touch-none items-center justify-between px-5 pt-2" onPointerDown={(e) => drag.start(e)}>
              <h2 className="font-display text-[22px] font-black tracking-tight">Filters</h2>
              <button type="button" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, q: filters.q })} className="h-10 px-2 text-[13.5px] font-semibold text-muted hover:text-ink">
                Reset
              </button>
            </div>

            <div className="thin-scroll overflow-y-auto px-5 pb-4">
              <Section title="Minimum prize">
                <div className="flex flex-wrap gap-2">
                  {MIN_PRIZES.map((p) => (
                    <Pill key={p} on={filters.minPrize === p} onClick={() => set("minPrize", p)}>
                      {p === 0 ? "Any amount" : `${compactMoney(p)}+`}
                    </Pill>
                  ))}
                </div>
              </Section>
              <Section title="Format">
                <div className="flex flex-wrap gap-2">
                  {FORMATS.map(([v, label]) => (
                    <Pill key={label} on={filters.format === v} onClick={() => set("format", v)}>
                      {label}
                    </Pill>
                  ))}
                </div>
              </Section>
              <Section title="Who it's open to">
                <div className="flex flex-wrap gap-2">
                  <Pill on={filters.worldwide} onClick={() => set("worldwide", !filters.worldwide)}>
                    Open worldwide
                  </Pill>
                  <Pill on={filters.hideStudentOnly} onClick={() => set("hideStudentOnly", !filters.hideStudentOnly)}>
                    Hide student-only
                  </Pill>
                </div>
              </Section>
              <Section title="Topics">
                <div className="flex flex-wrap gap-2">
                  {categories
                    .filter((c) => c.count > 0)
                    .map(({ category, count }) => (
                      <Pill key={category} on={filters.categories.includes(category)} onClick={() => toggleCat(category)}>
                        <span className="h-2 w-2 rounded-full" style={{ background: topicColor(category) }} />
                        {category}
                        <span className="opacity-60">{count}</span>
                      </Pill>
                    ))}
                </div>
              </Section>
            </div>

            <div className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="h-14 w-full rounded-full bg-ink font-display text-[16px] font-extrabold text-ground"
              >
                Show {resultCount} {resultCount === 1 ? "hackathon" : "hackathons"}
              </motion.button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
