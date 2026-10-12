import { MotionConfig, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { fetchData, fetchJSON, type Hackathon, type Meta } from "./lib/api";
import { healthWarning } from "./lib/health";
import { applyFilters, type Filters, loadFilters, saveFilters } from "./lib/filters";
import { sync, usePersonal } from "./lib/personal";
import { navigate, type PageKey, pageKey, usePath } from "./lib/router";
import { Details } from "./pages/Details";
import { Discovery } from "./pages/Discovery";
import { MyHackathons } from "./pages/MyHackathons";
import { SettingsPage } from "./pages/SettingsPage";

interface ListResponse {
  items: Hackathon[];
  total: number;
}

/** Refreshes run every 6 hours; two missed runs means the snapshot stopped updating. */
const SNAPSHOT_STALE_AFTER = 13 * 3_600_000;

/** Matches .page-leave in index.css. */
const LEAVE_MS = 170;

// The app restores the list's scroll itself; the browser's own restoration on
// Back would jump the page before the transition runs.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

export default function App() {
  const path = usePath();
  const route = pageKey(path);
  const personal = usePersonal();

  // Pull personal data (saved, notes, settings) once on start; it also syncs on focus.
  useEffect(() => {
    void sync();
  }, []);

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
    fetchData<ListResponse>("list.json", "/hackathons?limit=500", ctrl.signal)
      .then((r) => setItems(r.items))
      .catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        clearTimeout(slowTimer);
        if (!ctrl.signal.aborted) setLoading(false);
      });
    fetchData<Meta>("meta.json", "/meta", ctrl.signal)
      .then((m) => {
        setMeta(m);
        // The copy is rebuilt after every refresh. If it stopped updating, keep
        // showing it but ask the API too, and switch over if the API has newer data.
        if (m.generated_at && Date.now() - Date.parse(m.generated_at) > SNAPSHOT_STALE_AFTER) {
          Promise.all([fetchJSON<ListResponse>("/hackathons?limit=500", ctrl.signal), fetchJSON<Meta>("/meta", ctrl.signal)])
            .then(([list, fresh]) => {
              if (Date.parse(fresh.last_refresh ?? "") > Date.parse(m.last_refresh ?? "")) {
                setItems(list.items);
                setMeta(fresh);
              }
            })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      clearTimeout(slowTimer);
      ctrl.abort();
    };
  }, [reload]);

  const setFilters = useCallback((f: Filters) => {
    setFiltersState(f);
    saveFilters(f);
  }, []);

  // "Not interested" hackathons stay out of the list (they're on My hackathons).
  const visible = useMemo(
    () => applyFilters(items.filter((h) => personal.items[h.id]?.status !== "hidden"), filters),
    [items, filters, personal.items],
  );
  const live = useMemo(() => new Map(items.map((h) => [h.id, h])), [items]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((h) => h.categories.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
  }, [items]);

  // Page transitions run in two steps so the two pages are never on screen
  // together: the current page fades out, then the next one fades in. Each step
  // is a plain timer plus a CSS animation, never an animation callback, so a
  // dropped frame or a paused tab can't leave the screen blank: if a fade
  // doesn't run, the page simply shows at full opacity. The list stays mounted
  // (hidden) under the detail page, so going back restores its scroll position
  // and briefly marks the hackathon you came back from.
  const reduced = useReducedMotion();
  const [view, setView] = useState<PageKey>(route); // null for the list
  const [leaving, setLeaving] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const listScroll = useRef(0);
  const focusSearch = useRef(false);
  const timer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (route === view) {
      // Navigated back before the fade finished: stay on this page.
      setLeaving(false);
      return;
    }
    if (view === null) listScroll.current = window.scrollY;
    setLeaving(true);
    timer.current = window.setTimeout(
      () => {
        setLeaving(false);
        setHighlight(route === null && view?.startsWith("h:") ? view.slice(2) : null);
        setView(route);
      },
      reduced ? 0 : LEAVE_MS,
    );
    return () => window.clearTimeout(timer.current);
  }, [route, view, reduced]);

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
  const warning = useMemo(() => healthWarning(meta), [meta]);

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
              firstRunAt={meta?.first_run_at ?? null}
              warning={warning}
              page={page}
              setPage={setPage}
              highlightId={highlight}
            />
          </div>
          {view === "me" && (
            <div key="me" className={leaving ? "page-leave" : "page-enter-fade"}>
              <MyHackathons live={live} />
            </div>
          )}
          {view === "settings" && (
            <div key="settings" className={leaving ? "page-leave" : "page-enter-fade"}>
              <SettingsPage categories={meta?.categories.map((c) => c.category) ?? categories.map((c) => c.category)} />
            </div>
          )}
          {view?.startsWith("h:") && (
            <div key={view} className={leaving ? "page-leave" : "page-enter-fade"}>
              <Details
                id={view.slice(2)}
                initial={live.get(view.slice(2)) ?? personal.items[view.slice(2)]?.hackathon}
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
