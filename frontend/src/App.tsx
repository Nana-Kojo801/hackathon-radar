import { AnimatePresence, MotionConfig, type MotionValue, motion, useMotionValue, useTransform, type ValueAnimationTransition } from "framer-motion";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ToastView } from "./components/kit";
import { TabBar } from "./components/TabBar";
import { fetchData, fetchJSON, type Hackathon, type Meta } from "./lib/api";
import { appearance, useAppearance } from "./lib/appearance";
import { DEFAULT_FILTERS, type Filters, lastVisit, loadFilters, saveFilters } from "./lib/filters";
import { daysLeft } from "./lib/format";
import { dragHandle } from "./lib/gesture";
import { healthWarning } from "./lib/health";
import { pageSpring } from "./lib/motion";
import { sync, usePersonal } from "./lib/personal";
import { setBadge } from "./lib/push";
import { goBack, parse, TAB_PATH, type Tab, usePath } from "./lib/router";
import { type AppData, DataContext } from "./lib/store";
import { AppearancePage } from "./pages/Appearance";
import { Detail } from "./pages/Detail";
import { EmailAlertsPage } from "./pages/EmailAlerts";
import { Explore } from "./pages/Explore";
import { NotificationsPage } from "./pages/Notifications";
import { Saved } from "./pages/Saved";
import { SettingsTab } from "./pages/Settings";
import { Today } from "./pages/Today";

interface ListResponse {
  items: Hackathon[];
  total: number;
}

/** Refreshes run every 6 hours; two missed runs means the snapshot stopped updating. */
const SNAPSHOT_STALE_AFTER = 13 * 3_600_000;

// The app restores each tab's scroll itself.
if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

// Open on the tab chosen in Settings, unless the app was opened on a specific page.
if (window.location.pathname === "/" && appearance().startTab !== "today") {
  window.history.replaceState(null, "", TAB_PATH[appearance().startTab]);
}

export default function App() {
  const path = usePath();
  const route = useMemo(() => parse(path), [path]);
  const personal = usePersonal();
  const look = useAppearance();

  // Pull personal data (saved, notes, settings) once on start; it also syncs on focus.
  useEffect(() => {
    void sync();
  }, []);

  // ------------------------------------------------------------ data
  const [all, setAll] = useState<Hackathon[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [filters, setFiltersState] = useState<Filters>(loadFilters);
  const [newSince] = useState(lastVisit);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    fetchData<ListResponse>("list.json", "/hackathons?limit=500", ctrl.signal)
      .then((r) => setAll(r.items))
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
                setAll(list.items);
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

  // A notification for several new matches opens /explore?new=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (route.tab === "explore" && params.get("new") === "1") {
      setFilters({ ...DEFAULT_FILTERS, sort: filters.sort, newOnly: true });
      window.history.replaceState(window.history.state, "", "/explore");
    }
  }, [route.tab, setFilters, filters.sort]);

  const live = useMemo(() => new Map(all.map((h) => [h.id, h])), [all]);
  // "Not interested" hackathons stay out of every list (they're under Saved > Hidden).
  const items = useMemo(() => all.filter((h) => personal.items[h.id]?.status !== "hidden"), [all, personal.items]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    all.forEach((h) => h.categories.forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count }));
  }, [all]);
  const warning = useMemo(() => healthWarning(meta), [meta]);

  const data: AppData = useMemo(
    () => ({ items, live, meta, loading, slow, error, retry: () => setReload((n) => n + 1), filters, setFilters, newSince, categories, warning }),
    [items, live, meta, loading, slow, error, filters, setFilters, newSince, categories, warning],
  );

  // ------------------------------------------------------------ badge
  const closingSaved = useMemo(
    () =>
      Object.entries(personal.items).filter(([id, t]) => {
        if (t.status !== "saved" && t.status !== "registered") return false;
        const h = live.get(id) ?? t.hackathon;
        const d = h ? daysLeft(h) : null;
        return d !== null && d >= 0 && d < 7;
      }).length,
    [personal.items, live],
  );
  useEffect(() => setBadge(look.badge ? closingSaved : 0), [closingSaved, look.badge]);

  // ------------------------------------------------------------ tabs and scroll
  const scrolls = useRef<Partial<Record<Tab, number>>>({});
  const shownTab = useRef<Tab>(route.tab);
  const overlayOpen = useRef(!!route.overlay);
  overlayOpen.current = !!route.overlay;

  useEffect(() => {
    const onScroll = () => {
      if (!overlayOpen.current) scrolls.current[shownTab.current] = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useLayoutEffect(() => {
    if (shownTab.current !== route.tab) {
      shownTab.current = route.tab;
      window.scrollTo(0, scrolls.current[route.tab] ?? 0);
    }
  }, [route.tab]);

  const onReselect = useCallback((t: Tab) => {
    if (t === shownTab.current) window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ------------------------------------------------------------ overlay motion
  const width = typeof window !== "undefined" ? window.innerWidth : 390;
  const overlayX = useMotionValue(width);
  const underX = useTransform(overlayX, [0, width], [-width * 0.22, 0]);
  const dim = useTransform(overlayX, [0, width], [1, 0]);

  let page: ReactNode;
  if (route.tab === "today") page = <Today />;
  else if (route.tab === "explore") page = <Explore />;
  else if (route.tab === "saved") page = <Saved />;
  else page = <SettingsTab />;

  let overlay: ReactNode = null;
  if (route.overlay?.kind === "detail") {
    const id = route.overlay.id;
    overlay = <Detail id={id} initial={live.get(id) ?? personal.items[id]?.hackathon} />;
  } else if (route.overlay?.kind === "appearance") overlay = <AppearancePage />;
  else if (route.overlay?.kind === "notifications") overlay = <NotificationsPage />;
  else if (route.overlay?.kind === "email") overlay = <EmailAlertsPage />;

  return (
    <DataContext.Provider value={data}>
      <MotionConfig reducedMotion="user">
        <motion.div style={{ x: underX }} className="min-h-dvh will-change-transform">
          <motion.main key={route.tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: "easeOut" }} className="mx-auto max-w-[720px]">
            {page}
          </motion.main>
        </motion.div>
        <motion.div aria-hidden="true" style={{ opacity: dim, background: "var(--scrim)" }} className="pointer-events-none fixed inset-0 z-40" />
        <TabBar active={route.tab} hidden={!!route.overlay} badge={closingSaved} onReselect={onReselect} />
        <AnimatePresence>
          {overlay && (
            <OverlayLayer key={route.key} x={overlayX} width={width}>
              {overlay}
            </OverlayLayer>
          )}
        </AnimatePresence>
        <ToastView />
      </MotionConfig>
    </DataContext.Provider>
  );
}

/**
 * A page sliding in from the right, iOS style. Drag from the left edge to go
 * back: past a third of the screen (or a quick flick) it leaves, otherwise it
 * springs back.
 */
function OverlayLayer({ x, width, children }: { x: MotionValue<number>; width: number; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = prev;
    };
  }, []);

  const onEdge = dragHandle(x, { axis: "x", distance: () => width * 0.33, spring: pageSpring as ValueAnimationTransition, onCommit: () => goBack() });

  return (
    <motion.div
      style={{ x }}
      initial={{ x: width }}
      animate={{ x: 0 }}
      exit={{ x: width }}
      transition={pageSpring}
      className="fixed inset-0 z-50 overflow-hidden bg-bg shadow-[-12px_0_40px_rgba(0,0,0,0.18)]"
    >
      {children}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 z-40 w-5 touch-none" onPointerDown={onEdge} />
    </motion.div>
  );
}
