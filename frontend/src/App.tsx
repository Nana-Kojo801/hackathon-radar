import { AnimatePresence, MotionConfig, motion } from "framer-motion";
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

  // The list stays mounted under the detail page, so coming back restores
  // the exact scroll position instead of jumping to the top.
  const listScroll = useRef(0);
  const prevId = useRef<string | null>(routeId);
  useLayoutEffect(() => {
    const was = prevId.current;
    prevId.current = routeId;
    if (routeId && !was) window.scrollTo(0, 0);
    else if (routeId && was !== routeId) window.scrollTo(0, 0);
    else if (!routeId && was) window.scrollTo(0, listScroll.current);
  }, [routeId]);
  useEffect(() => {
    if (routeId) return;
    const onScroll = () => {
      listScroll.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [routeId]);

  const onDetailSearch = useCallback(
    (q: string) => {
      setFilters({ ...filters, q });
      setPage(1);
      listScroll.current = 0;
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
          <div hidden={!!routeId} aria-hidden={!!routeId}>
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
            />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {routeId && (
              <motion.div
                key={routeId}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease } }}
                exit={{ opacity: 0, transition: { duration: 0.12 } }}
              >
                <Details
                  id={routeId}
                  initial={items.find((h) => h.id === routeId)}
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
