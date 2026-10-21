import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { HackRow } from "../components/HackRow";
import { Icon } from "../components/Icon";
import { Chip, CompactBar, DeskHeader, EmptyState, GlassButton, Group, LargeTitle, Menu, PrimaryButton, RowMenu, RowToggle, Segmented, Sheet, TabActiveContext, useScrolled } from "../components/kit";
import { Preview } from "./Detail";
import { openAdd } from "../lib/add";
import { useAppearance } from "../lib/appearance";
import { useDesktop } from "../lib/desktop";
import {
  activeFilters,
  applyFilters,
  DEFAULT_FILTERS,
  type Filters,
  FORMAT_OPTIONS,
  PRIZE_OPTIONS,
  type Sort,
  SORT_OPTIONS,
  SOURCE_OPTIONS,
  WITHIN_OPTIONS,
} from "../lib/filters";
import { categoryLabel, compactMoney } from "../lib/format";
import { bouncy, press } from "../lib/motion";
import { usePersonal } from "../lib/personal";
import { navigate, useMedia } from "../lib/router";
import { SEARCH_FOCUS_EVENT, takeSearchFocus, useData } from "../lib/store";
import { cn } from "../lib/utils";

const PAGE = 30;

export function Explore() {
  const d = useData();
  const personal = usePersonal();
  const look = useAppearance();
  const f = d.filters;
  const set = (patch: Partial<Filters>) => d.setFilters({ ...f, ...patch });
  const scrolled = useScrolled(52);
  const search = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const desktop = useDesktop();
  // A preview pane beside the list once there's room for both.
  const pane = useMedia("(min-width: 1200px)") && desktop;
  const shown = useContext(TabActiveContext);
  const [selected, setSelected] = useState<string | null>(null);

  const results = useMemo(() => applyFilters(d.items, f, d.newSince, d.meta?.first_run_at ?? null), [d.items, f, d.newSince, d.meta]);
  const active = activeFilters(f);
  const listKey = JSON.stringify({ ...f, q: "" });

  useEffect(() => {
    setLimit(PAGE);
    setOpenId(null);
  }, [listKey]);

  useEffect(() => {
    // After the tab has switched to Explore, so the field is visible.
    const focus = () => takeSearchFocus() && window.setTimeout(() => search.current?.focus(), 250);
    focus();
    window.addEventListener(SEARCH_FOCUS_EVENT, focus);
    return () => window.removeEventListener(SEARCH_FOCUS_EVENT, focus);
  }, []);

  // Render 30 at a time; the next 30 come in before you reach the end.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setLimit((n) => n + PAGE), { rootMargin: "900px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [results.length]);

  const suggestions: { label: string; patch: Partial<Filters>; on: boolean }[] = [
    { label: "Closing soon", patch: { within: "7" }, on: f.within !== "0" },
    { label: "Online", patch: { format: "online" }, on: f.format !== "all" },
    { label: "$10K+", patch: { minPrize: "10000" }, on: f.minPrize !== "0" },
    { label: "AI & ML", patch: { categories: [...f.categories, "AI/ML"] }, on: f.categories.includes("AI/ML") },
    { label: "Worldwide", patch: { international: "international" }, on: f.international !== "any" },
  ];
  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.sort)?.label ?? "";
  const rows = results.slice(0, limit);
  const sel = pane ? (results.find((h) => h.id === selected) ?? results[0] ?? null) : null;

  // Up and down move through the list, Enter opens the full page.
  useEffect(() => {
    if (!sel || !shown) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      // Not while typing, and Enter on a focused button or link still presses it.
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t && e.key === "Enter" && /^(BUTTON|A)$/.test(t.tagName)) return;
      if (document.querySelector("[data-overlay]:not([data-leaving]), [role='dialog']")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const i = results.indexOf(sel) + (e.key === "ArrowDown" ? 1 : -1);
        const next = results[Math.max(0, Math.min(results.length - 1, i))];
        if (!next) return;
        if (i >= limit - 1) setLimit((n) => n + PAGE);
        setSelected(next.id);
        requestAnimationFrame(() => document.querySelector(`[data-row="${next.id}"]`)?.scrollIntoView({ block: "nearest" }));
      } else if (e.key === "Enter") navigate(`/h/${sel.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, shown, results, limit]);

  const listBody =
    d.loading && !d.items.length ? (
      <ListSkeleton />
    ) : d.error && !d.items.length ? (
      <EmptyState icon="cloudOff" title="Couldn't load hackathons" text={`The server didn't answer (${d.error}).`} action={<PrimaryButton onClick={d.retry}>Try again</PrimaryButton>} />
    ) : results.length === 0 ? (
      <EmptyState
        icon="search"
        title="No matches"
        text={f.q ? `Nothing matches “${f.q}” with these filters. If the radar hasn't found it, the AI can look it up and add it.` : "No hackathons match these filters."}
        action={
          <div className="flex flex-wrap justify-center gap-2.5">
            {f.q.trim().length >= 2 && (
              <PrimaryButton onClick={() => openAdd(f.q)}>
                <Icon name="sparkle" size={18} filled />
                Find it with AI
              </PrimaryButton>
            )}
            <PrimaryButton tone="fill" onClick={() => d.setFilters({ ...DEFAULT_FILTERS, sort: f.sort })}>
              Clear filters
            </PrimaryButton>
          </div>
        }
      />
    ) : (
      <ul key={listKey} className="card mx-4 overflow-hidden rounded-[22px] desk:mx-0">
        {rows.map((h, i) => (
          <HackRow
            key={h.id}
            h={h}
            index={i}
            last={i === rows.length - 1}
            stage={personal.items[h.id]?.status ?? null}
            density={look.density}
            openId={openId}
            setOpenId={setOpenId}
            swipe={!desktop}
            onSelect={pane ? setSelected : undefined}
            selected={sel?.id === h.id}
          />
        ))}
      </ul>
    );

  if (desktop) {
    return (
      <div className="flex items-start">
        <div className="min-w-0 flex-1 px-8 pt-8 pb-16">
          <DeskHeader title="Explore" subtitle={d.items.length ? `${d.items.length} open hackathons` : undefined} />
          <label className="mt-4 flex h-11 items-center gap-2.5 rounded-[12px] bg-card px-3.5 text-label-2 shadow-[0_0_0_0.5px_var(--sep)]">
            <Icon name="search" size={18} stroke={2.4} />
            <span className="sr-only">Search hackathons</span>
            <input
              ref={search}
              type="search"
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
              placeholder="Search by name, organizer or theme"
              className="min-w-0 flex-1 bg-transparent text-body text-label outline-none placeholder:text-label-2"
            />
            {f.q && (
              <button type="button" aria-label="Clear search" onClick={() => set({ q: "" })} className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-label-2 text-bg">
                <Icon name="close" size={11} stroke={3.2} />
              </button>
            )}
          </label>
          <DeskFilters onAll={() => setSheet(true)} />
          <div className="mt-5 mb-3 flex items-baseline justify-between px-1">
            <span className="text-subhead font-semibold" aria-live="polite">
              {d.loading && !d.items.length ? "Loading…" : `${results.length} ${results.length === 1 ? "hackathon" : "hackathons"}`}
            </span>
            {active.length > 0 && (
              <button type="button" onClick={() => d.setFilters({ ...DEFAULT_FILTERS, q: f.q, sort: f.sort })} className="text-subhead font-medium text-tint hover:underline">
                Clear filters
              </button>
            )}
          </div>
          {listBody}
          {rows.length < results.length && <div ref={sentinel} className="h-px" />}
          {f.q.trim().length >= 2 && results.length > 0 && rows.length >= results.length && <NotHere q={f.q} />}
          {pane && results.length > 0 && <p className="mt-4 text-center text-footnote text-label-2">Use ↑ and ↓ to move through the list, and Enter to open a hackathon.</p>}
        </div>
        {pane && (
          <aside aria-label="Preview" className="sticky top-0 h-dvh w-[420px] shrink-0 overflow-y-auto border-l hairline bg-card">
            {sel ? <Preview key={sel.id} h={sel} /> : <p className="px-8 pt-24 text-center text-subhead text-label-2">Pick a hackathon to see it here.</p>}
          </aside>
        )}
        <FilterSheet open={sheet} onOpenChange={setSheet} count={results.length} />
      </div>
    );
  }

  return (
    <div className="pb-32">
      <CompactBar title="Explore" show={scrolled} />
      <LargeTitle title="Explore" />

      <label className="mx-4 mt-3 flex h-[38px] items-center gap-2 rounded-[11px] bg-fill px-2.5 text-label-2">
        <Icon name="search" size={17} stroke={2.4} />
        <span className="sr-only">Search hackathons</span>
        <input
          ref={search}
          id="search"
          type="search"
          enterKeyHint="search"
          value={f.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Hackathons, organizers, topics"
          className="min-w-0 flex-1 bg-transparent text-body tracking-[-0.02em] text-label outline-none placeholder:text-label-2"
        />
        <AnimatePresence>
          {f.q && (
            <motion.button
              type="button"
              aria-label="Clear search"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={bouncy}
              onClick={() => {
                set({ q: "" });
                search.current?.focus();
              }}
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-label-2 text-bg"
            >
              <Icon name="close" size={11} stroke={3.2} />
            </motion.button>
          )}
        </AnimatePresence>
      </label>

      <LayoutGroup>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <motion.button
            type="button"
            layout
            onClick={() => setSheet(true)}
            whileTap={press}
            transition={bouncy}
            className="card flex h-[34px] shrink-0 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[14.5px] font-semibold"
          >
            <Icon name="filters" size={16} stroke={2.3} />
            Filters
            <AnimatePresence>
              {active.length > 0 && (
                <motion.span
                  key={active.length}
                  initial={{ scale: 0.4 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={bouncy}
                  className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-on-accent"
                >
                  {active.length}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
          <AnimatePresence initial={false} mode="popLayout">
            {active.map((a) => (
              <motion.div key={a.key} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={bouncy}>
                <Chip active removable onClick={() => set(a.clear)}>
                  {a.label}
                </Chip>
              </motion.div>
            ))}
            {suggestions
              .filter((s) => !s.on)
              .map((s) => (
                <motion.div key={`s:${s.label}`} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={bouncy}>
                  <Chip onClick={() => set(s.patch)}>{s.label}</Chip>
                </motion.div>
              ))}
          </AnimatePresence>
        </div>
      </LayoutGroup>

      <div className="mx-5 mt-5 mb-2.5 flex items-baseline justify-between">
        <span className="text-subhead font-semibold" aria-live="polite">
          {d.loading && !d.items.length ? "Loading…" : `${results.length} ${results.length === 1 ? "hackathon" : "hackathons"}`}
        </span>
        <Menu<Sort>
          title="Sort by"
          value={f.sort}
          items={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          onSelect={(v) => set({ sort: v })}
          align="end"
          trigger={
            <button type="button" className="flex items-center gap-0.5 text-subhead font-medium text-tint">
              {sortLabel}
              <Icon name="chevronDown" size={14} stroke={2.8} />
            </button>
          }
        />
      </div>

      {listBody}
      {rows.length < results.length && <div ref={sentinel} className="h-px" />}
      {rows.length > 0 && rows.length >= results.length && results.length > 8 && (
        <p className="mt-5 text-center text-footnote text-label-2">That's all {results.length}. Swipe left on a row to save or hide it.</p>
      )}
      {f.q.trim().length >= 2 && results.length > 0 && rows.length >= results.length && <NotHere q={f.q} />}

      <FilterSheet open={sheet} onOpenChange={setSheet} count={results.length} />
    </div>
  );
}

/** Under search results: the one you're after may be one the radar hasn't found. */
function NotHere({ q }: { q: string }) {
  return (
    <button type="button" onClick={() => openAdd(q)} className="mx-auto mt-5 flex items-center gap-1.5 text-subhead font-medium text-tint hover:underline">
      <Icon name="sparkle" size={15} filled />
      Not here? Find “{q.trim()}” with AI and add it
    </button>
  );
}

const chipClass = (on: boolean) =>
  cn(
    "flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors",
    on ? "bg-soft text-ink shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_30%,transparent)]" : "bg-card text-label shadow-[0_0_0_0.5px_var(--sep)] hover:bg-[color-mix(in_srgb,var(--card)_94%,var(--label))]",
  );

/** Explore's filters on a desktop: each one a menu or a toggle in a row, themes in a second row. */
function DeskFilters({ onAll }: { onAll: () => void }) {
  const d = useData();
  const f = d.filters;
  const set = (patch: Partial<Filters>) => d.setFilters({ ...f, ...patch });
  const pick = <T extends string>(name: string, value: T, on: boolean, options: { value: T; label: string }[], onSelect: (v: T) => void, shown?: string) => (
    <Menu
      title={name}
      value={value}
      items={options}
      onSelect={onSelect}
      trigger={
        <button type="button" className={chipClass(on)}>
          <span className={on ? "opacity-75" : "text-label-2"}>{name}</span>
          {shown ?? options.find((o) => o.value === value)?.label}
          <Icon name="chevronDown" size={12} stroke={2.8} />
        </button>
      }
    />
  );
  const toggle = (label: string, on: boolean, change: () => void) => (
    <button type="button" aria-pressed={on} onClick={change} className={chipClass(on)}>
      {on && <Icon name="check" size={13} stroke={3} />}
      {label}
    </button>
  );
  const extra = f.hiddenSources.length;
  const cats = d.categories.filter((c) => c.count > 0).slice(0, 10);
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        {pick("Sort", f.sort, false, SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label })), (v) => set({ sort: v }))}
        {pick("Closes", f.within, f.within !== "0", WITHIN_OPTIONS, (v) => set({ within: v }), f.within === "0" ? "Any time" : `Within ${WITHIN_OPTIONS.find((o) => o.value === f.within)?.label.toLowerCase()}`)}
        {pick("Format", f.format, f.format !== "all", FORMAT_OPTIONS, (v) => set({ format: v }))}
        {pick("Prize", f.minPrize, f.minPrize !== "0", PRIZE_OPTIONS.map((o) => ({ value: o.value, label: o.value === "0" ? "Any" : `${o.label}+` })), (v) => set({ minPrize: v }), f.minPrize === "0" ? "Any" : `${compactMoney(Number(f.minPrize))}+`)}
        {toggle("Open worldwide", f.international === "international", () => set({ international: f.international === "international" ? "any" : "international" }))}
        {toggle("Hide student-only", f.student === "hide", () => set({ student: f.student === "hide" ? "any" : "hide" }))}
        {toggle("New since last visit", f.newOnly, () => set({ newOnly: !f.newOnly }))}
        <button type="button" onClick={onAll} className={chipClass(extra > 0)}>
          <Icon name="filters" size={15} stroke={2.3} />
          All filters
          {extra > 0 && <span className="tabular">· {extra} platforms off</span>}
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={() => set({ categories: [] })} className={cn(chipClass(false), !f.categories.length && "bg-label text-bg shadow-none hover:bg-label")}>
          All themes
        </button>
        {cats.map((c) => {
          const on = f.categories.includes(c.category);
          return (
            <button
              key={c.category}
              type="button"
              aria-pressed={on}
              onClick={() => set({ categories: on ? f.categories.filter((x) => x !== c.category) : [...f.categories, c.category] })}
              className={chipClass(on)}
            >
              {categoryLabel(c.category)}
              <span className={on ? "opacity-70" : "text-label-2"}>{c.count}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function FilterSheet({ open, onOpenChange, count }: { open: boolean; onOpenChange: (v: boolean) => void; count: number }) {
  const d = useData();
  const f = d.filters;
  const set = (patch: Partial<Filters>) => d.setFilters({ ...f, ...patch });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Filters"
      left={<GlassButton label="Close" icon="close" size={40} onClick={() => onOpenChange(false)} />}
      right={
        <motion.button
          type="button"
          whileTap={press}
          onClick={() => d.setFilters({ ...DEFAULT_FILTERS, q: f.q, sort: f.sort })}
          className="h-10 rounded-full bg-fill px-3.5 text-subhead font-semibold"
        >
          Reset
        </motion.button>
      }
      footer={
        <PrimaryButton onClick={() => onOpenChange(false)} className="w-full">
          Show {count} {count === 1 ? "hackathon" : "hackathons"}
        </PrimaryButton>
      }
    >
      <SheetLabel>Sort by</SheetLabel>
      <Segmented label="Sort by" value={f.sort} onChange={(v) => set({ sort: v })} options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.short }))} />
      <SheetLabel>Closes within</SheetLabel>
      <Segmented label="Closes within" value={f.within} onChange={(v) => set({ within: v })} options={WITHIN_OPTIONS} />
      <SheetLabel>Format</SheetLabel>
      <Segmented label="Format" value={f.format} onChange={(v) => set({ format: v })} options={FORMAT_OPTIONS} />

      <Group className="mx-0">
        <RowMenu label="Minimum prize" value={f.minPrize} options={PRIZE_OPTIONS} onChange={(v) => set({ minPrize: v })} />
        <RowToggle label="Open worldwide" checked={f.international === "international"} onChange={(v) => set({ international: v ? "international" : "any" })} />
        <RowToggle label="Hide student-only" checked={f.student === "hide"} onChange={(v) => set({ student: v ? "hide" : "any" })} />
        <RowToggle label="Only new since last visit" checked={f.newOnly} onChange={(v) => set({ newOnly: v })} />
      </Group>

      <SheetLabel>Categories</SheetLabel>
      <ChipCloud
        options={d.categories.filter((c) => c.count > 0).map((c) => ({ value: c.category, label: categoryLabel(c.category), count: c.count }))}
        isOn={(v) => f.categories.includes(v)}
        onToggle={(v) => set({ categories: toggle(f.categories, v) })}
      />
      <SheetLabel>Platforms</SheetLabel>
      <ChipCloud options={SOURCE_OPTIONS} isOn={(v) => !f.hiddenSources.includes(v)} onToggle={(v) => set({ hiddenSources: toggle(f.hiddenSources, v) })} />
    </Sheet>
  );
}

function SheetLabel({ children }: { children: string }) {
  return <h3 className="mx-4 mt-5 mb-1.5 text-footnote font-medium tracking-[0.01em] text-label-2 uppercase">{children}</h3>;
}

function ChipCloud({ options, isOn, onToggle }: { options: { value: string; label: string; count?: number }[]; isOn: (v: string) => boolean; onToggle: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 px-1">
      {options.map((o) => {
        const on = isOn(o.value);
        return (
          <motion.button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(o.value)}
            whileTap={press}
            transition={bouncy}
            className={cn("flex h-[34px] items-center gap-1.5 rounded-full px-3.5 text-[14.5px] font-semibold transition-colors", on ? "bg-accent text-on-accent" : "card text-label")}
          >
            <AnimatePresence initial={false}>
              {on && (
                <motion.span initial={{ width: 0, opacity: 0 }} animate={{ width: 14, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={bouncy} className="flex overflow-hidden">
                  <Icon name="check" size={14} stroke={3} />
                </motion.span>
              )}
            </AnimatePresence>
            {o.label}
            {o.count !== undefined && <span className={cn("text-caption", on ? "text-on-accent/75" : "text-label-2")}>{o.count}</span>}
          </motion.button>
        );
      })}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="card mx-4 overflow-hidden rounded-[22px]">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b hairline px-3.5 py-3.5 last:border-0">
          <div className="skeleton h-14 w-14 shrink-0 rounded-[14px]" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="skeleton h-4 w-4/5 rounded" />
            <div className="skeleton h-3 w-1/2 rounded" />
            <div className="skeleton h-4 w-24 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
