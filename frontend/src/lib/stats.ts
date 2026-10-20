import { useEffect, useState } from "react";

import { fetchData } from "./api";
import { explainError } from "./errors";
import { call, personalState, usePersonal } from "./personal";

/**
 * The stats page's data (backend app/stats.py) and the activity it's built
 * from: app opens, where they came from, and hackathons opened. Events queue
 * on the device and go up in batches, so they survive a sleeping API and work
 * before the device is connected.
 */

export interface MarketStats {
  generated_at: string;
  totals: { open: number; pool: number; new_7d: number; platforms: number; median_prize: number | null };
  /** count is null for weeks before the radar started (the first run finds the whole backlog). */
  new_per_week: { week: string; count: number | null }[];
  by_source: { source: string; count: number }[];
  prize_buckets: { label: string; count: number }[];
  /** yyyy-mm-dd -> hackathons closing that day, next 8 weeks. */
  closing: Record<string, number>;
  categories: { category: string; count: number }[];
  runs: { day: string; fetched: number; new: number; tokens: number; runs: number; errors: number }[];
}

export type OpenSource = "email" | "push" | "home_screen" | "browser";

export interface MyStats {
  since: string;
  timezone: string;
  funnel: {
    listed: number;
    opened: number;
    opened_since: string | null;
    saved: number;
    registered: number;
    submitted: number;
    won: number;
    not_placed: number;
    hidden: number;
  };
  categories: { key: string; mine: number; market: number }[];
  formats: { key: string; mine: number; market: number }[];
  prizes: {
    entered_total: number;
    entered_avg: number | null;
    market_avg: number | null;
    saved_avg: number | null;
    biggest: { id: string; title: string; prize_usd: number } | null;
  };
  habits: { save_to_register_days: number | null; lead_days: number | null; last_minute_pct: number | null; registrations: number };
  activity: {
    since: string | null;
    opens: number;
    views: number;
    per_week: { week: string; count: number | null }[];
    /** [weekday Mon..Sun][3-hour block 0..7] */
    heatmap: number[][];
    sources: Record<OpenSource, number>;
    streak: number;
    longest_streak: number;
    active_days_30: number;
  };
  monthly: { month: string; saved: number; registered: number }[];
  recap: { saved: number; registered: number; opens: number; views: number };
}

export function fetchMarketStats(signal?: AbortSignal): Promise<MarketStats> {
  return fetchData<MarketStats>("stats.json", "/stats", signal);
}

export function fetchMyStats(): Promise<MyStats> {
  return call<MyStats>("/me/stats");
}

const MY_CACHE = "hackathon-radar:stats:me:v1";
const MARKET_CACHE = "hackathon-radar:stats:market:v1";

/**
 * Stats with the last copy shown at once (from this device), then refreshed.
 * `error` is set only when there's nothing to show.
 */
const inflight = new Map<string, { at: number; promise: Promise<unknown> }>();
/** Pages that share a stat (Today, Settings, Stats) reuse one request for a couple of minutes. */
const FRESH_MS = 2 * 60_000;

function useCached<T>(cacheKey: string, load: (() => Promise<T>) | null): { data: T | null; loading: boolean; error: string | null; errorText: string; retry: () => void } {
  const [data, setData] = useState<T | null>(() => loadJSON<T | null>(cacheKey, null));
  const [loading, setLoading] = useState(!!load);
  const [error, setError] = useState<string | null>(null);
  const [errorText, setErrorText] = useState("");
  // A failed load is retried quietly a few times (the API may be waking up or mid-deploy).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!load) {
      setLoading(false);
      return;
    }
    let live = true;
    let timer: number | undefined;
    setLoading(true);
    let req = inflight.get(cacheKey);
    if (!req || attempt > 0 || Date.now() - req.at > FRESH_MS) {
      req = { at: Date.now(), promise: load() };
      inflight.set(cacheKey, req);
      req.promise.catch(() => inflight.delete(cacheKey));
    }
    (req.promise as Promise<T>)
      .then((d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
        save(cacheKey, d);
      })
      .catch((e) => {
        if (!live) return;
        if (attempt < 3) timer = window.setTimeout(() => setAttempt((a) => a + 1), 2500 * (attempt + 1));
        else {
          setError(e instanceof Error ? e.message : String(e));
          setErrorText(explainError(e, "these stats").text);
          setLoading(false);
        }
      });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, !!load, attempt]);
  const retry = () => {
    setError(null);
    setAttempt((a) => (a >= 3 ? 1 : a + 1));
  };
  return { data, loading, error, errorText, retry };
}

export function useMyStats() {
  const key = usePersonal().key;
  // Send queued activity first so it's counted.
  return useCached<MyStats>(MY_CACHE, key ? () => flush().then(fetchMyStats) : null);
}

export function useMarketStats() {
  return useCached<MarketStats>(MARKET_CACHE, () => fetchMarketStats());
}

// ---------------------------------------------------------------- activity log

type Event = { kind: "open"; source: OpenSource; at: string } | { kind: "view"; hackathon_id: string; at: string };

const QUEUE = "hackathon-radar:events:v1";
/** When the app was last on screen. */
const LAST_OPEN = "hackathon-radar:last-open";
const LAST_VIEW = "hackathon-radar:last-view";
/** Coming back after this long counts as a new open. */
const SESSION_GAP = 30 * 60_000;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the event is lost, which is fine for stats */
  }
}

function push(e: Event): void {
  // Capped so a device that's never connected doesn't grow forever.
  save(QUEUE, [...loadJSON<Event[]>(QUEUE, []), e].slice(-300));
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, 4000);
}

let flushTimer: number | undefined;
let flushing = false;

/** Send queued events. Called after logging and when the device connects. */
export async function flush(): Promise<void> {
  if (flushing || !personalState().key) return;
  const batch = loadJSON<Event[]>(QUEUE, []).slice(0, 200);
  if (!batch.length) return;
  flushing = true;
  try {
    await call("/me/events", { method: "POST", body: { events: batch } });
    // Drop what was sent; anything logged meanwhile stays.
    save(QUEUE, loadJSON<Event[]>(QUEUE, []).slice(batch.length));
  } catch {
    /* kept for next time */
  } finally {
    flushing = false;
  }
}

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

/**
 * Log an app open, once per visit. Links in emails carry ?from=email and the
 * service worker adds ?from=push to notification taps; the tag is removed
 * from the address bar afterwards.
 */
export function logOpen(): void {
  const url = new URL(window.location.href);
  const from = url.searchParams.get("from");
  if (from) {
    url.searchParams.delete("from");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  const tagged = from === "email" || from === "push";
  const last = loadJSON<number>(LAST_OPEN, 0);
  // A tap on an email or notification always counts; otherwise once per session.
  if (!tagged && Date.now() - last < SESSION_GAP) return;
  save(LAST_OPEN, Date.now());
  push({ kind: "open", source: tagged ? (from as OpenSource) : standalone() ? "home_screen" : "browser", at: new Date().toISOString() });
}

/** Log opening a hackathon's page (once per hackathon per 10 minutes). */
export function logView(id: string): void {
  const last = loadJSON<{ id: string; t: number } | null>(LAST_VIEW, null);
  if (last && last.id === id && Date.now() - last.t < 10 * 60_000) return;
  save(LAST_VIEW, { id, t: Date.now() });
  push({ kind: "view", hackathon_id: id, at: new Date().toISOString() });
}

let watching = false;

/** Log the first open, then a new one whenever the app comes back after a while. */
export function startActivityLog(): void {
  if (watching) return;
  watching = true;
  logOpen();
  flush();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") logOpen();
    else {
      save(LAST_OPEN, Date.now());
      flush();
    }
  });
}
