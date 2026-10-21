import { MotionConfig } from "framer-motion";
import { lazy, type PointerEvent, type ReactNode, type RefObject, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { TabActiveContext, ToastView } from "./components/kit";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { fetchData, fetchJSON, type Hackathon, type Meta } from "./lib/api";
import { appearance, useAppearance } from "./lib/appearance";
import { DEFAULT_FILTERS, type Filters, lastVisit, loadFilters, saveFilters } from "./lib/filters";
import { isDesktop, useDesktop } from "./lib/desktop";
import { daysLeft } from "./lib/format";
import { healthWarning } from "./lib/health";
import { sync, usePersonal } from "./lib/personal";
import { setBadge } from "./lib/push";
import { goBack, type Overlay, parse, type Route, TAB_PATH, type Tab, usePath } from "./lib/router";
import { flush as flushActivity, startActivityLog } from "./lib/stats";
import { currentOffset, fade, reducedMotion, slide } from "./lib/transition";
import { cn } from "./lib/utils";
import { type AppData, DataContext } from "./lib/store";
import { AppearancePage } from "./pages/Appearance";
import { Detail } from "./pages/Detail";
import { EmailAlertsPage } from "./pages/EmailAlerts";
import { Explore } from "./pages/Explore";
import { NotificationsPage } from "./pages/Notifications";
import { Saved } from "./pages/Saved";
import { SettingsTab } from "./pages/Settings";
import { Today } from "./pages/Today";

// The stats page and its charts load on first visit, keeping them out of the start-up bundle.
const TAB_ORDER: Tab[] = ["today", "explore", "saved", "settings"];
const TAB_PAGES: Record<Tab, ReactNode> = { today: <Today />, explore: <Explore />, saved: <Saved />, settings: <SettingsTab /> };

const StatsPage = lazy(() => import("./pages/Stats").then((m) => ({ default: m.StatsPage })));

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

/** Settings pages that open beside the settings list on a desktop, instead of over it. */
export const SETTINGS_PANES: Overlay["kind"][] = ["appearance", "notifications", "email"];

export default function App() {
  const path = usePath();
  const desktop = useDesktop();
  const parsed = useMemo(() => parse(path), [path]);
  const route: Route = useMemo(
    () => (desktop && parsed.overlay && SETTINGS_PANES.includes(parsed.overlay.kind) ? { ...parsed, overlay: null, key: null } : parsed),
    [parsed, desktop],
  );
  const personal = usePersonal();
  const look = useAppearance();

  // Pull personal data (saved, notes, settings) once on start; it also syncs on focus.
  useEffect(() => {
    void sync();
    startActivityLog();
  }, []);
  // Activity logged before the device was connected goes up once it is.
  useEffect(() => {
    if (personal.key) void flushActivity();
  }, [personal.key]);

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

  // Switching tabs slides the pages sideways, in the tab bar's direction. The
  // tab being left stays visible ("leaving") until its slide ends.
  const mains = useRef<Partial<Record<Tab, HTMLElement | null>>>({});
  const [tabs, setTabs] = useState<{ current: Tab; leaving: Tab | null }>({ current: route.tab, leaving: null });
  if (tabs.current !== route.tab) setTabs({ current: route.tab, leaving: route.overlay || reducedMotion() || desktop ? null : tabs.current });
  const endSlide = useRef<((finished?: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    if (shownTab.current === route.tab) return;
    const from = shownTab.current;
    shownTab.current = route.tab;
    const outEl = tabs.leaving === from ? mains.current[from] : null;
    const inEl = mains.current[route.tab];
    // A slide still running (a quick second tap) jumps to its end first.
    const startX = inEl && outEl && endSlide.current ? currentOffset(outEl) : 0;
    endSlide.current?.(false);
    const outScroll = scrolls.current[from] ?? 0;
    const inScroll = scrolls.current[route.tab] ?? 0;
    if (outEl) {
      // Taken out of the flow and placed so it stays where it was on screen once the window
      // scrolls to the incoming tab's position. Absolute, not fixed: iPhone Safari composites fixed
      // elements together, and a moving fixed tab dragged the (fixed) tab bar along with it.
      Object.assign(outEl.style, { position: "absolute", top: `${inScroll - outScroll}px`, left: "0", right: "0", pointerEvents: "none" });
      outEl.style.setProperty("--tab-scroll", `${outScroll}px`);
    }
    window.scrollTo(0, inScroll);
    if (!outEl || !inEl) return;
    inEl.style.setProperty("--tab-scroll", `${inScroll}px`);
    // Each page is clipped to the screen while it moves, so Safari moves one screenful instead of a
    // whole page. The full screen, bar area included: clipping above the bar left a strip that
    // filled in when the slide ended, which showed as a flicker under the bar.
    const clip = (el: HTMLElement, scroll: number) => `inset(${scroll}px 0 ${Math.max(0, el.offsetHeight - scroll - window.innerHeight)}px 0)`;
    outEl.style.clipPath = clip(outEl, outScroll);
    inEl.style.clipPath = clip(inEl, inScroll);
    const dir = TAB_ORDER.indexOf(route.tab) > TAB_ORDER.indexOf(from) ? 1 : -1;
    const w = window.innerWidth;
    const reset = (finished = true) => {
      // When the slide ends, hide the old tab in the same frame its pinning comes off (waiting for
      // React's re-render would drop it back into the page for a frame). When a new switch cuts
      // in, React has already set which tabs show, and this one may be the tab coming back.
      if (finished) outEl.hidden = true;
      for (const el of [outEl, inEl]) {
        el.getAnimations().forEach((a) => a.cancel());
        for (const k of ["position", "top", "left", "right", "pointer-events", "transform", "clip-path", "--tab-scroll"]) el.style.removeProperty(k);
      }
      endSlide.current = null;
      setTabs((t) => (t.leaving === from ? { ...t, leaving: null } : t));
    };
    endSlide.current = reset;
    slide(outEl, "x", startX, -dir * w, "tab");
    slide(inEl, "x", dir * w + startX, 0, "tab", () => reset());
  }, [route.tab, tabs.leaving]);

  const onReselect = useCallback((t: Tab) => {
    if (t === shownTab.current) window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ------------------------------------------------------------ overlays
  // Pages that slide in are kept in a small stack, so the one leaving can
  // finish its slide while the route has already moved on.
  const under = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const [layers, setLayers] = useState<{ key: string; overlay: Overlay; leaving: boolean }[]>(() =>
    route.overlay && route.key ? [{ key: route.key, overlay: route.overlay, leaving: false }] : [],
  );
  useEffect(() => {
    setLayers((prev) => {
      const rest = prev.filter((l) => l.key !== route.key).map((l) => ({ ...l, leaving: true }));
      return route.overlay && route.key ? [...rest, { key: route.key, overlay: route.overlay, leaving: false }] : rest;
    });
  }, [route.key, route.overlay]);
  const gone = useCallback((key: string) => setLayers((prev) => prev.filter((l) => l.key !== key)), []);

  // Tabs stay mounted once visited and switch instantly, like iOS: remounting
  // on every switch reloaded every image and replayed every entrance
  // animation, and fading the page in glitched its glass in Safari.
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([route.tab]));
  if (!visited.has(route.tab)) setVisited(new Set(visited).add(route.tab));
  // The other tabs are built once the first one has settled, one at a time when the phone is idle,
  // so a first visit doesn't stall its slide.
  const visitedNow = useRef(visited);
  visitedNow.current = visited;
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const idle = (fn: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(fn, { timeout: 2000 }) : window.setTimeout(fn, 200));
    const next = () => {
      const tab = TAB_ORDER.find((t) => !visitedNow.current.has(t));
      if (cancelled || !tab) return;
      setVisited((v) => new Set(v).add(tab));
      timer = window.setTimeout(() => idle(next), 400);
    };
    timer = window.setTimeout(() => idle(next), 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const render = (o: Overlay): ReactNode => {
    if (o.kind === "detail") return <Detail id={o.id} initial={live.get(o.id) ?? personal.items[o.id]?.hackathon} />;
    if (o.kind === "appearance") return <AppearancePage />;
    if (o.kind === "notifications") return <NotificationsPage />;
    if (o.kind === "stats")
      return (
        <Suspense fallback={<div className="page-bg absolute inset-0" />}>
          <StatsPage />
        </Suspense>
      );
    return <EmailAlertsPage />;
  };

  return (
    <DataContext.Provider value={data}>
      <MotionConfig reducedMotion="user">
        {/* overflow-x: clip, so a tab sliding in from the right can't make the page wider than the
            screen; Safari then shifted its fixed layer, and the tab bar with it. */}
        <Sidebar route={parsed} badge={closingSaved} />
        <div ref={under} className="relative min-h-dvh overflow-x-clip desk:pl-[260px]">
          {TAB_ORDER.filter((t) => visited.has(t)).map((t) => (
            <main
              key={t}
              ref={(el) => {
                mains.current[t] = el;
              }}
              hidden={t !== route.tab && t !== tabs.leaving}
              className="mx-auto max-w-[720px] desk:max-w-none"
            >
              <TabActiveContext.Provider value={t === route.tab}>{TAB_PAGES[t]}</TabActiveContext.Provider>
            </main>
          ))}
        </div>
        <div ref={dim} aria-hidden="true" style={{ opacity: 0, background: "var(--scrim)" }} className="pointer-events-none fixed inset-0 z-40 desk:left-[260px]" />
        <TabBar active={route.tab} hidden={!!route.overlay} badge={closingSaved} onReselect={onReselect} />
        {layers.map((l) => (
          <OverlayLayer key={l.key} id={l.key} leaving={l.leaving} under={under} dim={dim} onGone={gone}>
            {render(l.overlay)}
          </OverlayLayer>
        ))}
        <ToastView />
      </MotionConfig>
    </DataContext.Provider>
  );
}

/**
 * A page sliding in from the right, iOS style, while the page underneath
 * drifts left and dims. The slides run on the compositor with a spring curve
 * (lib/transition.ts). Drag from the left edge to go back: past a third of
 * the screen (or a quick flick) it leaves, otherwise it springs back.
 */
function OverlayLayer({
  id,
  leaving,
  under,
  dim,
  onGone,
  children,
}: {
  id: string;
  leaving: boolean;
  under: RefObject<HTMLDivElement | null>;
  dim: RefObject<HTMLDivElement | null>;
  onGone: (key: string) => void;
  children: ReactNode;
}) {
  const el = useRef<HTMLDivElement>(null);
  const width = () => window.innerWidth;
  // The page underneath drifts left as on iOS; not on a desktop, where it would slide under the sidebar.
  const PARALLAX = isDesktop() ? 0 : 0.22;

  /** Place the page underneath and the dim layer to match the overlay at `x`. */
  const follow = (x: number, from: number | null, done?: () => void) => {
    const w = width();
    const u = under.current;
    const d = dim.current;
    const at = (v: number) => -w * PARALLAX * (1 - v / w);
    if (u) {
      u.style.willChange = "transform";
      if (from === null) u.style.transform = `translate3d(${at(x)}px,0,0)`;
      else slide(u, "x", at(from), at(x), "page", () => x >= w && (u.style.transform = "", u.style.willChange = ""));
    }
    if (d) {
      if (from === null) d.style.opacity = String(1 - x / w);
      else fade(d, 1 - from / w, 1 - x / w, "page");
    }
    if (from !== null && el.current) slide(el.current, "x", from, x, "page", done);
  };

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.overflow = "hidden";
    follow(0, width());
    return () => {
      // Another page may still be open (one slid in while this one left).
      if (!document.querySelector("[data-overlay]:not([data-leaving])")) root.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape goes back, as on a desktop (a menu or sheet open on top closes first).
  useEffect(() => {
    if (leaving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')) return;
      const top = [...document.querySelectorAll("[data-overlay]:not([data-leaving])")].pop();
      if (top === el.current) goBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leaving]);

  useLayoutEffect(() => {
    if (!leaving || !el.current) return;
    follow(width(), currentOffset(el.current), () => onGone(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const onEdge = (e: PointerEvent<HTMLDivElement>) => {
    const node = el.current;
    if (!node || leaving) return;
    const strip = e.currentTarget;
    strip.setPointerCapture(e.pointerId);
    node.getAnimations().forEach((a) => a.cancel());
    const start = e.clientX - currentOffset(node);
    let last = e.clientX;
    let lastT = performance.now();
    let velocity = 0;
    let x = currentOffset(node);
    const move = (ev: globalThis.PointerEvent) => {
      const now = performance.now();
      velocity = (ev.clientX - last) / Math.max(1, now - lastT);
      last = ev.clientX;
      lastT = now;
      x = Math.max(0, ev.clientX - start);
      node.style.transform = `translate3d(${x}px,0,0)`;
      follow(x, null);
    };
    const end = () => {
      strip.removeEventListener("pointermove", move);
      strip.removeEventListener("pointerup", end);
      strip.removeEventListener("pointercancel", end);
      if (x > width() * 0.33 || velocity > 0.6) goBack();
      else follow(0, x);
    };
    strip.addEventListener("pointermove", move);
    strip.addEventListener("pointerup", end);
    strip.addEventListener("pointercancel", end);
  };

  return (
    <div
      ref={el}
      data-overlay=""
      data-leaving={leaving ? "" : undefined}
      style={{ transform: `translate3d(${width()}px,0,0)`, willChange: "transform" }}
      className={cn("page-bg fixed inset-0 z-50 overflow-hidden shadow-[-12px_0_40px_rgba(0,0,0,0.18)] desk:left-[260px]", leaving && "pointer-events-none")}
    >
      {children}
      <div aria-hidden="true" className="absolute inset-y-0 left-0 z-40 w-5 touch-none" onPointerDown={onEdge} />
    </div>
  );
}
