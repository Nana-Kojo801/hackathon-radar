import { MotionConfig, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { fetchJSON, type Hackathon, type Meta } from "./lib/api";
import { applyFilters, type Filters, loadFilters, saveFilters } from "./lib/filters";
import { detailId, navigate, usePath } from "./lib/router";
import { Details } from "./pages/Details";
import { Discovery } from "./pages/Discovery";

interface ListResponse {
  items: Hackathon[];
  total: number;
}

/** Matches .page-leave in index.css. */
const LEAVE_MS = 170;

// The app restores the list's scroll itself; the browser's own restoration on
// Back would jump the page before the transition runs.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

export default function App() {
  const path = usePath();
  const routeId = detailId(path);

  const [items, setItems] = useState<Hackathon[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [filters, setFiltersState] = useState<Filters>(loadFilters);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    fetchJSON<ListResponse>("/hackathons?limit=500", ctrl.signal)
      .then((r) => setItems(r.items))
      .catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        clearTimeout(slowTimer);
        if (!ctrl.signal.aborted) setLoading(false);
      });
    fetchJSON<Meta>("/meta", ctrl.signal).then(setMeta).catch(() => undefined);
    return () => {
      clearTimeout(slowTimer);
      ctrl.abort();
    };
  }, [reload]);

  const setFilters = useCallback((f: Filters) => {
    setFiltersState(f);
    saveFilters(f);
  }, []);

  const visible = useMemo(() => applyFilters(items, filters), [items, filters]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((h) => h.categories.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [items]);

  // Page transitions run in two steps so the two pages are never on screen
  // together: the current page fades out, then the next one fades in. Each step
  // is a plain timer plus a CSS animation, never an animation callback, so a
  // dropped frame or a paused tab can't leave the screen blank: if a fade
  // doesn't run, the page simply shows at full opacity. The list stays mounted
  // (hidden) under the detail page, so going back restores its scroll position
  // and briefly marks the hackathon you came back from.
  const reduced = useReducedMotion();
  const [view, setView] = useState<string | null>(routeId); // detail id, or null for the list
  const [leaving, setLeaving] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listScroll = useRef(0);
  const focusSearch = useRef(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (routeId === view) {
      // Navigated back before the fade finished: stay on this page.
      setLeaving(false);
      return;
    }
    if (view === null) listScroll.current = window.scrollY;
    setLeaving(true);
    timer.current = window.setTimeout(
      () => {
        setLeaving(false);
        setHighlight(routeId === null ? view : null);
        setView(routeId);
      },
      reduced ? 0 : LEAVE_MS,
    );
    return () => window.clearTimeout(timer.current);
  }, [routeId, view, reduced]);

  useLayoutEffect(() => {
    if (view !== null) {
      window.scrollTo(0, 0);
      return;
    }
    window.scrollTo(0, listScroll.current);
    if (focusSearch.current) {
      focusSearch.current = false;
      const input = document.querySelector<HTMLInputElement>("#discovery-search");
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }, [view]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2200);
    return () => clearTimeout(t);
  }, [highlight]);

  const onDetailSearch = useCallback(
    (q: string) => {
      setFilters({ ...filters, q });
      setPage(1);
      // Keep typing in the list's search box, which shows the results live.
      focusSearch.current = true;
      navigate("/");
      listScroll.current = 0;
    },
    [filters, setFilters],
  );

  const lastRefresh = meta?.last_refresh ?? null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-canvas wide:px-4 wide:py-4">
        <div className="relative mx-auto min-h-screen max-w-[1220px] overflow-clip bg-white wide:min-h-[calc(100vh-2rem)] wide:rounded-[10px] wide:border wide:border-line wide:shadow-[0_1px_2px_rgba(10,16,51,0.04)]">
          <div hidden={view !== null} className={view === null ? (leaving ? "page-leave" : "page-enter") : undefined}>
            <Discovery
              items={visible}
              totalCount={items.length}
              loading={loading}
              slow={slow}
              error={error}
              onRetry={() => setReload((n) => n + 1)}
              filters={filters}
              setFilters={setFilters}
              categories={categories}
              lastRefresh={lastRefresh}
              page={page}
              setPage={setPage}
              highlightId={highlight}
            />
          </div>
          {view && (
            <div key={view} className={leaving ? "page-leave" : "page-enter-fade"}>
              <Details
                id={view}
                initial={items.find((h) => h.id === view)}
                totalCount={items.length || meta?.active_count || 0}
                lastRefresh={lastRefresh}
                query=""
                onSearch={onDetailSearch}
              />
            </div>
          )}
        </div>
      </div>
    </MotionConfig>
  );
}
