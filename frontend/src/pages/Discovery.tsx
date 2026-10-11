import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, LayoutGrid, List, ListFilter, ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SearchField, TopBar } from "../components/Brand";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { FieldSelect, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Sheet } from "../components/ui/sheet";
import type { Hackathon } from "../lib/api";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  type Filters,
  FORMAT_OPTIONS,
  INTERNATIONAL_OPTIONS,
  PRIZE_OPTIONS,
  SORT_OPTIONS,
  STUDENT_OPTIONS,
} from "../lib/filters";
import {
  categoryLabel,
  dateRange,
  deadlineLabel,
  eligibilityLabel,
  FORMAT_LABEL,
  mainCategory,
  prizeText,
  sourceName,
  timeAgo,
} from "../lib/format";
import { navigate, useMedia } from "../lib/router";
import { cn } from "../lib/utils";

const PAGE_SIZE = 10;

interface Props {
  items: Hackathon[];
  totalCount: number;
  loading: boolean;
  slow: boolean;
  error: string | null;
  onRetry: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  categories: string[];
  lastRefresh: string | null;
  page: number;
  setPage: (p: number) => void;
}

function open(id: string) {
  navigate(`/h/${id}`);
}

export function Discovery(p: Props) {
  const { filters: f } = p;
  const [sheetOpen, setSheetOpen] = useState(false);
  const wide = useMedia("(min-width: 900px)");
  const pages = Math.max(1, Math.ceil(p.items.length / PAGE_SIZE));
  const page = Math.min(p.page, pages);
  const start = (page - 1) * PAGE_SIZE;
  const rows = p.items.slice(start, start + PAGE_SIZE);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    p.setFilters({ ...f, [k]: v });
    if (k !== "view") p.setPage(1);
  };
  const categoryOptions = useMemo(
    () => [{ value: "all", label: "All categories" }, ...p.categories.map((c) => ({ value: c, label: categoryLabel(c) }))],
    [p.categories],
  );
  const filterCount = activeFilterCount(f);
  const showing = p.items.length ? `${start + 1}–${start + rows.length}` : "0";
  const listKey = `${page}|${f.sort}|${f.format}|${f.international}|${f.student}|${f.category}|${f.minPrize}|${f.q}`;

  useEffect(() => {
    if (p.page > pages) p.setPage(pages);
  }, [p, pages]);

  const goTo = (n: number) => {
    p.setPage(n);
    const top = document.getElementById("results")?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 8, behavior: "smooth" });
  };

  const filterFields = (stack: boolean) => (
    <>
      <FieldSelect label="Format" value={f.format} onChange={(v) => set("format", v)} options={FORMAT_OPTIONS} className={stack ? "" : "w-[138px]"} triggerClassName={stack ? "w-full" : "w-full"} />
      <FieldSelect label="International" value={f.international} onChange={(v) => set("international", v)} options={INTERNATIONAL_OPTIONS} className={stack ? "" : "w-[94px]"} triggerClassName="w-full" />
      <FieldSelect label="Student-only" value={f.student} onChange={(v) => set("student", v)} options={STUDENT_OPTIONS} className={stack ? "" : "w-[166px]"} triggerClassName="w-full" />
      <FieldSelect label="Category" value={f.category} onChange={(v) => set("category", v)} options={categoryOptions} className={stack ? "" : "w-[160px]"} triggerClassName="w-full" />
      <FieldSelect label="Minimum prize" value={f.minPrize} onChange={(v) => set("minPrize", v)} options={PRIZE_OPTIONS} className={stack ? "" : "w-[118px]"} triggerClassName="w-full" />
    </>
  );

  const pagination = (compact: boolean) => (
    <div className={cn("flex items-center gap-2.5", compact && "w-full")}>
      <Button
        variant={page > 1 ? "sky" : "quiet"}
        size={compact ? "sm" : "md"}
        disabled={page <= 1}
        onClick={() => goTo(page - 1)}
        className={cn(compact ? "h-10 flex-1 rounded-[10px]" : "h-[46px] rounded-[12px] px-5 text-[16px]")}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      <Select value={String(page)} onValueChange={(v) => goTo(Number(v))}>
        <SelectTrigger
          aria-label="Page"
          className={cn("border-[#cdeef5] bg-[#effafc] text-ink-2", compact ? "h-10 flex-1 justify-center" : "h-[46px] rounded-[12px] px-5 text-[16px]")}
        >
          <SelectValue>{compact ? `${page} of ${pages}` : `Page ${page} of ${pages}`}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: pages }, (_, i) => (
            <SelectItem key={i + 1} value={String(i + 1)}>
              Page {i + 1}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={page < pages ? "sky" : "quiet"}
        size={compact ? "sm" : "md"}
        disabled={page >= pages}
        onClick={() => goTo(page + 1)}
        className={cn(compact ? "h-10 flex-1 rounded-[10px]" : "h-[46px] rounded-[12px] px-5 text-[16px]")}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div>
      <TopBar />

      {/* Title + search */}
      <section className="flex flex-col gap-4 px-5 pt-5 pb-4 wide:flex-row wide:items-start wide:justify-between wide:gap-10 wide:px-7 wide:pt-7 wide:pb-6">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
          <h1 className="text-[27px] leading-tight font-bold tracking-[-0.02em] text-ink wide:text-[42px]">Explore hackathons</h1>
          <p className="mt-0.5 text-[15.5px] text-periwinkle wide:mt-1 wide:text-[18px]">
            {p.loading ? "Loading…" : `${p.totalCount} hackathons`} <span className="mx-1">•</span> Updated {timeAgo(p.lastRefresh)}
          </p>
        </motion.div>
        <SearchField
          value={f.q}
          id="discovery-search"
          onChange={(v) => set("q", v)}
          placeholder={wide ? "Search hackathons by title, topic or keyword…" : "Search hackathons…"}
          size={wide ? "lg" : "md"}
          className="w-full wide:mt-1 wide:max-w-[556px]"
        />
      </section>

      {/* Desktop filter bar */}
      <div className="mx-7 hidden border-t border-line wide:block" />
      <div className="hidden flex-wrap items-end gap-x-5 gap-y-4 border-b border-line px-7 pt-5 pb-5 wide:flex">
        {filterFields(false)}
        <span className="mb-0.5 h-10 w-px bg-line" />
        <FieldSelect label="Sort by" value={f.sort} onChange={(v) => set("sort", v)} options={SORT_OPTIONS} className="w-[112px]" triggerClassName="w-full" />
        <div className="ml-auto flex overflow-hidden rounded-[12px] border border-line" role="group" aria-label="View">
          {(["cards", "table"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => set("view", v)}
              aria-pressed={f.view === v}
              className={cn(
                "relative flex h-[46px] items-center gap-2.5 px-5 text-[16px] font-medium transition-colors",
                f.view === v ? "text-sky" : "text-ink-2 hover:bg-field",
              )}
            >
              {f.view === v && (
                <motion.span layoutId="view-toggle" className="absolute inset-0 bg-[#e5f7fb]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
              )}
              <span className="relative flex items-center gap-2.5">
                {v === "cards" ? <LayoutGrid className="h-5 w-5" /> : <List className="h-5 w-5" />}
                {v === "cards" ? "Cards" : "Table"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Mobile filter + sort */}
      <div className="flex gap-2.5 px-5 pb-3 wide:hidden">
        <Button variant="outline" className="h-11 flex-1 justify-between rounded-[10px] px-3.5 text-[15px]" onClick={() => setSheetOpen(true)}>
          <span className="flex items-center gap-2.5 text-[#0079cb]">
            <ListFilter className="h-[18px] w-[18px]" />
            <span className="text-ink-2">Filters{filterCount ? ` (${filterCount})` : ""}</span>
          </span>
          <ChevronDown className="h-4 w-4" />
        </Button>
        <Select value={f.sort} onValueChange={(v) => set("sort", v as Filters["sort"])}>
          <SelectTrigger className="h-11 flex-1 px-3.5" aria-label="Sort">
            <span className="flex items-center gap-2.5">
              <ArrowUpDown className="h-[18px] w-[18px] text-[#0079cb]" />
              <SelectValue>Sort: {SORT_OPTIONS.find((o) => o.value === f.sort)?.label}</SelectValue>
            </span>
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Showing + pagination */}
      <div id="results" className="flex scroll-mt-2 flex-col gap-3 border-b border-line px-5 pb-4 wide:flex-row wide:items-center wide:justify-between wide:px-7 wide:py-4">
        <p className="text-[14.5px] text-[#0a1560] wide:text-[17px]" aria-live="polite">
          Showing <span className="font-semibold">{showing}</span> of {p.items.length} hackathons
        </p>
        <div className="wide:hidden">{pagination(true)}</div>
        <div className="hidden wide:block">{pagination(false)}</div>
      </div>

      {p.loading ? (
        <LoadingRows slow={p.slow} />
      ) : p.error ? (
        <div className="px-6 py-20 text-center">
          <p className="text-[16px] text-body">We couldn't reach the server ({p.error}).</p>
          <Button variant="primary" className="mt-4" onClick={p.onRetry}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-6 py-20 text-center">
          <p className="text-[17px] font-semibold text-ink">No hackathons match these filters.</p>
          <Button variant="soft" className="mt-4" onClick={() => p.setFilters({ ...DEFAULT_FILTERS, view: f.view, sort: f.sort })}>
            Clear filters
          </Button>
        </motion.div>
      ) : f.view === "table" ? (
        <TableView rows={rows} listKey={listKey} />
      ) : (
        <ul key={listKey}>
          <AnimatePresence initial={true}>
            {rows.map((h, i) => (
              <Row key={h.id} h={h} index={i} />
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        footer={
          <div className="flex gap-2.5">
            <Button variant="outline" className="h-12 flex-1" onClick={() => p.setFilters({ ...DEFAULT_FILTERS, view: f.view, sort: f.sort, q: f.q })}>
              Reset
            </Button>
            <Button variant="primary" className="h-12 flex-[2]" onClick={() => setSheetOpen(false)}>
              Show {p.items.length} hackathons
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">{filterFields(true)}</div>
      </Sheet>
    </div>
  );
}

function Pills({ h, compact }: { h: Hackathon; compact?: boolean }) {
  const elig = eligibilityLabel(h);
  const cat = mainCategory(h);
  const size = compact ? "sm" : "md";
  return (
    <>
      <Badge tone="sky" size={size}>
        {FORMAT_LABEL[h.format]}
      </Badge>
      <Badge tone={elig.tone} size={size}>
        {elig.text}
      </Badge>
      {cat && (
        <Badge tone="blue" size={size}>
          {categoryLabel(cat)}
        </Badge>
      )}
    </>
  );
}

function Row({ h, index }: { h: Hackathon; index: number }) {
  const deadline = deadlineLabel(h);
  const dates = dateRange(h.start_date, h.end_date);
  const summary = h.summary;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1], delay: index * 0.035 }}
      className="border-b border-line last:border-b-0"
    >
      <a
        href={`/h/${h.id}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          open(h.id);
        }}
        className="group block px-5 py-4 transition-colors duration-200 outline-none hover:bg-[#f7fbfd] focus-visible:bg-[#f2f9fc] wide:flex wide:items-start wide:justify-between wide:gap-8 wide:px-7 wide:py-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[18px] leading-snug font-bold tracking-[-0.01em] text-ink transition-colors duration-200 group-hover:text-teal wide:text-[31px] wide:leading-tight">
              {h.title}
            </h2>
            <span className="shrink-0 text-[17px] font-bold whitespace-nowrap text-ink wide:hidden">{prizeText(h)}</span>
          </div>
          {h.organizer && (
            <p className="text-[14px] text-periwinkle wide:mt-0.5 wide:text-[17.5px]">
              <span className="hidden wide:inline">Organized by </span>
              {h.organizer}
            </p>
          )}
          {summary && <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-periwinkle wide:mt-2 wide:line-clamp-1 wide:text-[18px]">{summary}</p>}

          {/* Desktop meta line */}
          <div className="mt-3.5 hidden flex-wrap items-center gap-x-2.5 gap-y-2 text-[15.5px] text-periwinkle wide:flex">
            <Pills h={h} />
            {deadline && (
              <>
                <span aria-hidden="true">•</span>
                <Badge tone={deadline.tone} className="rounded-full px-3.5">
                  {deadline.text}
                </Badge>
              </>
            )}
            {dates && (
              <>
                <span aria-hidden="true">•</span>
                <span>{dates}</span>
              </>
            )}
            <span aria-hidden="true">•</span>
            <span>{sourceName(h)}</span>
          </div>

          {/* Mobile meta */}
          <div className="mt-2.5 flex flex-wrap gap-1.5 wide:hidden">
            <Pills h={h} compact />
          </div>
          <p className="mt-2 text-[13px] text-slate wide:hidden">
            {[deadline?.text, dates].filter(Boolean).join("  •  ")}
          </p>
          <p className="mt-0.5 text-[13px] text-slate wide:hidden">{sourceName(h)}</p>
        </div>
        <div className="hidden shrink-0 text-right wide:block">
          <div className="text-[28px] font-bold tracking-[-0.01em] whitespace-nowrap text-ink">{prizeText(h)}</div>
          <div className="mt-1 text-[15.5px] text-[#5068b8]">Prize pool</div>
        </div>
      </a>
    </motion.li>
  );
}

function TableView({ rows, listKey }: { rows: Hackathon[]; listKey: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-[15px]">
        <thead>
          <tr className="border-b border-line text-[13.5px] font-medium text-[#4a5fb0]">
            <th className="py-3 pr-4 pl-7 font-medium">Hackathon</th>
            <th className="px-4 py-3 text-right font-medium">Prize pool</th>
            <th className="px-4 py-3 font-medium">Closes</th>
            <th className="px-4 py-3 font-medium">Event dates</th>
            <th className="px-4 py-3 font-medium">Format</th>
            <th className="px-4 py-3 font-medium">Eligibility</th>
            <th className="py-3 pr-7 pl-4 font-medium">Source</th>
          </tr>
        </thead>
        <tbody key={listKey}>
          {rows.map((h, i) => {
            const deadline = deadlineLabel(h);
            const elig = eligibilityLabel(h);
            return (
              <motion.tr
                key={h.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.025 }}
                onClick={() => open(h.id)}
                className="group cursor-pointer border-b border-line transition-colors hover:bg-[#f7fbfd]"
              >
                <td className="max-w-[340px] py-3.5 pr-4 pl-7">
                  <a
                    href={`/h/${h.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      open(h.id);
                    }}
                    className="block truncate font-bold text-ink group-hover:text-teal"
                  >
                    {h.title}
                  </a>
                  <span className="block truncate text-[13.5px] text-periwinkle">{h.organizer ?? sourceName(h)}</span>
                </td>
                <td className="px-4 py-3.5 text-right font-bold whitespace-nowrap text-ink">{prizeText(h)}</td>
                <td className="px-4 py-3.5 whitespace-nowrap">
                  {deadline ? (
                    <Badge tone={deadline.tone} size="sm" className="rounded-full">
                      {deadline.text.replace(/^(Closes|Closed|Starts) /, "")}
                    </Badge>
                  ) : (
                    <span className="text-body">TBA</span>
                  )}
                </td>
                <td className="px-4 py-3.5 whitespace-nowrap text-periwinkle">{dateRange(h.start_date, h.end_date) ?? "TBA"}</td>
                <td className="px-4 py-3.5">
                  <Badge tone="sky" size="sm">
                    {FORMAT_LABEL[h.format]}
                  </Badge>
                </td>
                <td className="px-4 py-3.5">
                  <Badge tone={elig.tone} size="sm">
                    {elig.text === "Eligibility not specified" ? "Not specified" : elig.text}
                  </Badge>
                </td>
                <td className="py-3.5 pr-7 pl-4 text-periwinkle">{sourceName(h)}</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoadingRows({ slow }: { slow: boolean }) {
  return (
    <div>
      <AnimatePresence>
        {slow && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mx-5 mt-4 flex items-center gap-3 rounded-[12px] border border-[#cdeef5] bg-[#effafc] px-4 py-3 wide:mx-7">
              <span className="spin h-5 w-5 shrink-0 rounded-full border-[2.5px] border-[#bfe3ea] border-t-teal" />
              <p className="text-[14.5px] text-ink-2">
                <span className="font-semibold">Waking up the server…</span>{" "}
                <span className="text-body">It sleeps when idle on the free plan. This takes up to a minute.</span>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex justify-between gap-8 border-b border-line px-5 py-5 wide:px-7">
          <div className="flex-1 space-y-3">
            <div className="skeleton h-7 w-3/5 rounded-md" />
            <div className="skeleton h-4 w-2/5 rounded-md" />
            <div className="skeleton h-4 w-4/5 rounded-md" />
            <div className="flex gap-2">
              <div className="skeleton h-7 w-16 rounded-lg" />
              <div className="skeleton h-7 w-24 rounded-lg" />
              <div className="skeleton h-7 w-32 rounded-full" />
            </div>
          </div>
          <div className="skeleton hidden h-8 w-36 rounded-md wide:block" />
        </div>
      ))}
    </div>
  );
}
