import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Detail } from "./components/Detail";
import { FilterSheet } from "./components/FilterSheet";
import { ListView } from "./components/ListView";
import { fetchJSON, type Hackathon, type Meta } from "./lib/api";
import { applyFilters, type Filters, loadFilters, saveFilters } from "./lib/filters";
import { detailId, goBack, navigate, useMedia, usePath } from "./lib/router";

interface ListResponse {
  items: Hackathon[];
  total: number;
}

const pushSpring = { type: "spring", stiffness: 340, damping: 36, mass: 0.9 } as const;

export default function App() {
  const wide = useMedia("(min-width: 900px)");
  const path = usePath();
  const routeId = detailId(path);

  const [items, setItems] = useState<Hackathon[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [filters, setFiltersState] = useState<Filters>(loadFilters);
  const [sheetOpen, setSheetOpen] = useState(false);

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
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
  }, [items]);
  const sheetCount = visible.length;

  // On a wide screen the first result is shown when nothing is picked yet.
  const selectedId = routeId ?? (wide ? visible[0]?.id ?? null : null);
  const selected = items.find((h) => h.id === selectedId);
  const phoneDetailOpen = !wide && !!routeId;

  const open = useCallback((id: string) => navigate(`/h/${id}`), []);
  const back = useCallback(() => goBack("/"), []);

  useEffect(() => {
    if (!phoneDetailOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sheetOpen && back();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phoneDetailOpen, sheetOpen, back]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="h-full overflow-hidden wide:flex">
        <motion.div
          className="thin-scroll h-full overflow-y-auto wide:w-[min(50%,600px)] wide:shrink-0 wide:border-r wide:border-line"
          animate={phoneDetailOpen ? { x: -56, opacity: 0.4, scale: 0.985 } : { x: 0, opacity: 1, scale: 1 }}
          transition={pushSpring}
          aria-hidden={phoneDetailOpen || undefined}
        >
          <ListView
            items={visible}
            loading={loading}
            slow={slow}
            error={error}
            onRetry={() => setReload((r) => r + 1)}
            filters={filters}
            setFilters={setFilters}
            openFilters={() => setSheetOpen(true)}
            selectedId={wide ? selectedId : null}
            onOpen={open}
            lastRefresh={meta?.last_refresh ?? null}
            firstRunAt={meta?.first_run_at ?? null}
          />
        </motion.div>

        {wide && (
          <main className="relative h-full min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              {selectedId ? (
                <motion.div
                  key={selectedId}
                  className="h-full"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10, transition: { duration: 0.14 } }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <Detail id={selectedId} initial={selected} showBack={false} onBack={back} />
                </motion.div>
              ) : (
                <motion.div key="empty" className="flex h-full items-center justify-center text-muted" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {loading ? "" : "Pick a hackathon to see the details."}
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        )}
      </div>

      <AnimatePresence>
        {phoneDetailOpen && routeId && (
          <motion.div
            key="phone-detail"
            className="fixed inset-0 z-30 bg-ground shadow-[-20px_0_40px_rgba(0,0,0,0.5)]"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={pushSpring}
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.x > 110 || info.velocity.x > 650) back();
            }}
          >
            <Detail key={routeId} id={routeId} initial={selected} showBack onBack={back} />
          </motion.div>
        )}
      </AnimatePresence>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        setFilters={setFilters}
        categories={categories}
        resultCount={sheetCount}
      />
    </MotionConfig>
  );
}
