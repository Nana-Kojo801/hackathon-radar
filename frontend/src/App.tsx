import { AnimatePresence, MotionConfig, motion, useAnimate, useReducedMotion } from "framer-motion";
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

const ease = [0.16, 1, 0.3, 1] as const;

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
  // together: the current page fades out, then the next one fades in. The list
  // stays mounted (hidden) under the detail page, so going back restores its
  // scroll position and briefly marks the hackathon you came back from.
  const reduced = useReducedMotion();
  const [listScope, animateList] = useAnimate<HTMLDivElement>();
  const [view, setView] = useState<string | null>(routeId); // detail id, or null for the list
  const [listShown, setListShown] = useState(!routeId);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listScroll = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const enterList = useRef(false);

  useEffect(() => {
    if (routeId === view) {
      // Back pressed while the list was still fading out: bring it straight back.
      if (view === null && listScope.current) animateList(listScope.current, { opacity: 1, y: 0 }, { duration: 0.2 });
      return;
    }
    let cancelled = false;
    if (view === null) {
      // List → detail: remember where we were, fade the list out, then show the detail page.
      listScroll.current = window.scrollY;
      const done = () => {
        if (cancelled) return;
        setListShown(false);
        setView(routeId);
      };
      if (reduced || !listScope.current) done();
      else animateList(listScope.current, { opacity: 0, y: -6 }, { duration: 0.16, ease: "easeIn" }).then(done);
    } else {
      // Detail → list (or another detail): AnimatePresence fades the detail page out first.
      if (routeId === null) setHighlight(view);
      setView(routeId);
    }
    return () => {
      cancelled = true;
    };
  }, [routeId, view, reduced, animateList, listScope]);

  const onDetailExited = useCallback(() => {
    if (viewRef.current !== null) return;
    enterList.current = true;
    setListShown(true);
  }, []);

  useLayoutEffect(() => {
    if (view !== null) window.scrollTo(0, 0);
  }, [view]);

  useLayoutEffect(() => {
    if (!listShown || !enterList.current) return;
    enterList.current = false;
    window.scrollTo(0, listScroll.current);
    if (listScope.current) {
      if (reduced) listScope.current.style.cssText = "";
      else animateList(listScope.current, { opacity: [0, 1], y: [10, 0] }, { duration: 0.34, ease: [0.16, 1, 0.3, 1] });
    }
  }, [listShown, reduced, animateList, listScope]);

  useEffect(() => {
    if (!highlight) return;
    const t = setTimeout(() => setHighlight(null), 2200);
    return () => clearTimeout(t);
  }, [highlight]);

  const onDetailSearch = useCallback(
    (q: string) => {
      setFilters({ ...filters, q });
      setPage(1);
      listScroll.current = 0;
      setHighlight(null);
      navigate("/");
      // Keep typing in the list's search box, which shows the results live.
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>("#discovery-search");
        input?.focus();
        input?.setSelectionRange(q.length, q.length);
      });
    },
    [filters, setFilters],
  );

  const lastRefresh = meta?.last_refresh ?? null;

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-canvas wide:px-4 wide:py-4">
        <div className="relative mx-auto min-h-screen max-w-[1220px] overflow-clip bg-white wide:min-h-[calc(100vh-2rem)] wide:rounded-[10px] wide:border wide:border-line wide:shadow-[0_1px_2px_rgba(10,16,51,0.04)]">
          <div ref={listScope} hidden={!listShown}>
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
          <AnimatePresence mode="wait" initial={false} onExitComplete={onDetailExited}>
            {view && (
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.38, ease } }}
                exit={{ opacity: 0, y: 8, transition: { duration: 0.18, ease: "easeIn" } }}
              >
                <Details
                  id={view}
                  initial={items.find((h) => h.id === view)}
                  totalCount={items.length || meta?.active_count || 0}
                  lastRefresh={lastRefresh}
                  query=""
                  onSearch={onDetailSearch}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
