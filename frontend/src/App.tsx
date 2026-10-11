import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import {
  buildQuery,
  DEFAULT_FILTERS,
  fetchJSON,
  type Filters,
  type Format,
  type Hackathon,
  type ListResponse,
  type Meta,
  type Sort,
} from "./api";
import { MIN_PRIZE_STEPS, moneyShort, timeAgo } from "./format";
import { HackathonCard, HackathonTable } from "./HackathonCard";

const PAGE = 60;
const STORAGE_KEY = "hackathon-radar:prefs:v1";

type View = "cards" | "table";

function loadPrefs(): { filters: Filters; view: View } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { filters: { ...DEFAULT_FILTERS, ...p.filters, q: "" }, view: p.view === "table" ? "table" : "cards" };
    }
  } catch {
    /* storage unavailable: fall back to defaults */
  }
  return { filters: DEFAULT_FILTERS, view: "cards" };
}

function savePrefs(filters: Filters, view: View) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ filters: { ...filters, q: "" }, view }));
  } catch {
    /* ignore */
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const SORTS: { value: Sort; label: string }[] = [
  { value: "prize", label: "Prize" },
  { value: "deadline", label: "Deadline" },
  { value: "new", label: "Newest" },
  { value: "relevance", label: "Relevance" },
];

const FORMATS: { value: Format | ""; label: string }[] = [
  { value: "", label: "Any format" },
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition ${
        active
          ? "border-emerald-600 bg-emerald-600 text-white"
          : "border-stone-300 bg-white text-stone-700 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
      }`}
    >
      {children}
    </button>
  );
}

export default function App() {
  const initial = useRef(loadPrefs());
  const [filters, setFilters] = useState<Filters>(initial.current.filters);
  const [view, setView] = useState<View>(initial.current.view);
  const [items, setItems] = useState<Hackathon[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const q = useDebounced(filters.q, 300);
  const queryFilters = { ...filters, q };
  const queryKey = buildQuery(queryFilters, 0, PAGE);

  useEffect(() => savePrefs(filters, view), [filters, view]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchJSON<Meta>("/meta", ctrl.signal).then(setMeta).catch(() => undefined);
    return () => ctrl.abort();
  }, [retryKey]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    fetchJSON<ListResponse>(`/hackathons?${queryKey}`, ctrl.signal)
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        clearTimeout(slowTimer);
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => {
      clearTimeout(slowTimer);
      ctrl.abort();
    };
  }, [queryKey, retryKey]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    fetchJSON<ListResponse>(`/hackathons?${buildQuery(queryFilters, items.length, PAGE)}`)
      .then((r) => setItems((prev) => [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))]))
      .catch(() => undefined)
      .finally(() => setLoadingMore(false));
  }, [queryKey, items.length]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const toggleCategory = (c: string) =>
    set("categories", filters.categories.includes(c) ? filters.categories.filter((x) => x !== c) : [...filters.categories, c]);

  const activeCount =
    filters.categories.length +
    (filters.format ? 1 : 0) +
    (filters.minPrize > 0 ? 1 : 0) +
    (filters.internationalOnly ? 1 : 0) +
    (filters.hideStudentOnly ? 1 : 0);

  const prizeStep = Math.max(0, MIN_PRIZE_STEPS.indexOf(filters.minPrize));
  const unhealthy = meta?.sources.filter((s) => !s.healthy && s.source !== "pipeline") ?? [];

  return (
    <div className="mx-auto min-h-screen max-w-5xl pb-16">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-stone-100/90 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur dark:border-stone-800 dark:bg-[#0b0f17]/90">
        <div className="flex items-center gap-2">
          <h1 className="flex items-center gap-1.5 text-base font-bold tracking-tight">
            <img src="/favicon.svg" alt="" className="h-5 w-5" />
            <span className="hidden min-[380px]:inline">Hackathon Radar</span>
          </h1>
          <div className="ml-auto text-right text-[11px] leading-tight text-stone-500 dark:text-stone-400">
            <div>
              <span className="font-semibold text-stone-800 dark:text-stone-200">{loading ? "…" : total}</span> hackathons
            </div>
            <div title={meta?.last_refresh ?? undefined}>updated {timeAgo(meta?.last_refresh ?? null)}</div>
          </div>
        </div>

        <div className="mt-2 flex gap-2">
          <input
            type="search"
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search title, organizer, topic…"
            className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 dark:border-stone-700 dark:bg-stone-900"
          />
          <select
            value={filters.sort}
            onChange={(e) => set("sort", e.target.value as Sort)}
            aria-label="Sort"
            className="rounded-lg border border-stone-300 bg-white px-2 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="no-scrollbar mt-2 -mx-3 flex items-center gap-1.5 overflow-x-auto px-3">
          <Chip active={showFilters || activeCount > 0} onClick={() => setShowFilters((s) => !s)}>
            Filters{activeCount > 0 ? ` · ${activeCount}` : ""} {showFilters ? "▴" : "▾"}
          </Chip>
          <Chip active={filters.internationalOnly} onClick={() => set("internationalOnly", !filters.internationalOnly)}>
            🌍 International
          </Chip>
          <Chip active={filters.hideStudentOnly} onClick={() => set("hideStudentOnly", !filters.hideStudentOnly)}>
            Hide student-only
          </Chip>
          {FORMATS.slice(1).map((f) => (
            <Chip key={f.value} active={filters.format === f.value} onClick={() => set("format", filters.format === f.value ? "" : f.value)}>
              {f.label}
            </Chip>
          ))}
          <div className="ml-auto flex shrink-0 overflow-hidden rounded-full border border-stone-300 text-xs dark:border-stone-700">
            {(["cards", "table"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-2.5 py-1 ${view === v ? "bg-stone-800 text-white dark:bg-stone-200 dark:text-stone-900" : "bg-white dark:bg-stone-900"}`}
              >
                {v === "cards" ? "Cards" : "Table"}
              </button>
            ))}
          </div>
        </div>

        {showFilters && (
          <div className="mt-2 space-y-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
            <div>
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-stone-500 dark:text-stone-400">
                <span>Minimum prize</span>
                <span className="font-mono text-sm text-emerald-700 dark:text-emerald-400">{moneyShort(filters.minPrize)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={MIN_PRIZE_STEPS.length - 1}
                step={1}
                value={prizeStep}
                onChange={(e) => set("minPrize", MIN_PRIZE_STEPS[Number(e.target.value)])}
                className="w-full"
                aria-label="Minimum prize"
              />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-stone-500 dark:text-stone-400">Categories</div>
              <div className="flex flex-wrap gap-1.5">
                {(meta?.categories ?? []).map(({ category, count }) => (
                  <Chip key={category} active={filters.categories.includes(category)} onClick={() => toggleCategory(category)}>
                    {category} <span className="opacity-60">{count}</span>
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, q: filters.q })}
                className="text-xs font-medium text-stone-500 underline dark:text-stone-400"
              >
                Reset filters
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="px-3 pt-3">
        {unhealthy.length > 0 && !loading && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Last refresh had problems with: {unhealthy.map((s) => s.source).join(", ")}. Results from other sources are still current.
          </div>
        )}

        {loading ? (
          <LoadingState slow={slow} />
        ) : error ? (
          <div className="mt-10 text-center">
            <p className="text-sm text-stone-600 dark:text-stone-300">Couldn't reach the server ({error}).</p>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="mt-3 rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white dark:bg-stone-200 dark:text-stone-900"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <p className="mt-10 text-center text-sm text-stone-500">No hackathons match these filters.</p>
        ) : (
          <>
            {view === "cards" ? (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {items.map((h) => (
                  <HackathonCard key={h.id} h={h} firstRunAt={meta?.first_run_at ?? null} />
                ))}
              </div>
            ) : (
              <HackathonTable items={items} firstRunAt={meta?.first_run_at ?? null} />
            )}
            {items.length < total && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900"
                >
                  {loadingMore ? "Loading…" : `Show more (${total - items.length} left)`}
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function LoadingState({ slow }: { slow: boolean }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900/60">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
        </span>
        <div className="text-sm">
          {slow ? (
            <>
              <div className="font-medium">Waking up the server…</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                It sleeps when idle on the free tier. This takes up to a minute, then it's fast.
              </div>
            </>
          ) : (
            <div className="font-medium">Loading hackathons…</div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-800/50" />
        ))}
      </div>
    </div>
  );
}
