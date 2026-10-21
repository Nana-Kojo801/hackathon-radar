import { useSyncExternalStore } from "react";

import { API_URL, type Hackathon } from "./api";

/**
 * Personal data: hackathons you've saved, their stage, notes, "not interested",
 * and the email settings. Lives on the server behind a personal key, so phone
 * and laptop share it.
 *
 * Local first: every change shows at once and is kept in localStorage, then
 * sent to the API in the background, with retries. The free API can take up to
 * a minute to wake, so nothing here waits for it.
 */

export type Stage = "saved" | "registered" | "submitted" | "won" | "not_placed" | "hidden";

export const STAGES: { value: Exclude<Stage, "hidden">; label: string }[] = [
  { value: "saved", label: "Interested" },
  { value: "registered", label: "Registered" },
  { value: "submitted", label: "Submitted" },
  { value: "won", label: "Won" },
  { value: "not_placed", label: "Didn't place" },
];

export function stageLabel(s: Stage | null): string {
  if (s === "hidden") return "Not interested";
  return STAGES.find((x) => x.value === s)?.label ?? "Not tracked";
}

export interface Tracked {
  status: Stage | null;
  note: string;
  updated_at: string;
  /** The hackathon as of the last save or sync, so ended ones still show. */
  hackathon?: Hackathon;
}

export interface Settings {
  alerts_enabled: boolean;
  alert_min_prize: number;
  alert_categories: string[];
  alert_formats: string[];
  alert_international_only: boolean;
  alert_skip_student_only: boolean;
  reminders_enabled: boolean;
  reminder_days: number;
  digest_enabled: boolean;
  last_alert_at: string | null;
  last_digest_at: string | null;
  push_new_matches: boolean;
  push_closing_soon: boolean;
  push_big_prizes: boolean;
  push_digest: boolean;
  big_prize_min: number;
  quiet_hours_enabled: boolean;
  quiet_start: number;
  quiet_end: number;
  timezone: string;
  /** Devices with push turned on (read-only). */
  push_devices: number;
}

interface State {
  key: string | null;
  items: Record<string, Tracked>;
  settings: Settings | null;
  /** Hackathon ids with changes not yet on the server. */
  pending: string[];
  pendingSettings: Partial<Settings> | null;
  syncing: boolean;
  lastSync: string | null;
  error: "key" | "offline" | null;
}

const KEY_STORAGE = "hackathon-radar:personal-key";
const DATA_STORAGE = "hackathon-radar:personal:v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function initial(): State {
  const saved = read<Partial<State>>(DATA_STORAGE, {});
  let key: string | null = null;
  try {
    key = localStorage.getItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
  return {
    key,
    items: saved.items ?? {},
    settings: saved.settings ?? null,
    pending: saved.pending ?? [],
    pendingSettings: saved.pendingSettings ?? null,
    syncing: false,
    lastSync: saved.lastSync ?? null,
    error: null,
  };
}

let state: State = initial();
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  try {
    const { items, settings, pending, pendingSettings, lastSync } = state;
    localStorage.setItem(DATA_STORAGE, JSON.stringify({ items, settings, pending, pendingSettings, lastSync }));
  } catch {
    /* storage full or unavailable: the server copy still syncs */
  }
  listeners.forEach((l) => l());
}

export function usePersonal(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function personalState(): State {
  return state;
}

class KeyError extends Error {}

/** One API call with the key; retries network errors and 5xx while the API wakes up. */
export async function call<T>(path: string, init: { method?: string; body?: unknown } = {}, key = state.key): Promise<T> {
  if (!key) throw new KeyError("no key");
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: init.method ?? "GET",
        headers: { "X-Personal-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401 || res.status === 503) throw new KeyError(`HTTP ${res.status}`);
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true, status: res.status });
      last = Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    } catch (e) {
      if (e instanceof KeyError || (e as { fatal?: boolean }).fatal) throw e;
      last = e;
    }
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  throw last instanceof Error ? last : new Error("request failed");
}

interface MeResponse {
  items: { hackathon_id: string; status: Stage | null; note: string; updated_at: string; hackathon: Hackathon }[];
  settings: Settings;
}

let syncing: Promise<void> | null = null;
let retryTimer: number | undefined;

/** Send pending changes, then pull the server copy. Safe to call often. */
export function sync(): Promise<void> {
  if (!state.key) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    set({ syncing: true });
    try {
      for (const id of [...state.pending]) {
        const t = state.items[id];
        await call(`/me/hackathons/${id}`, { method: "PUT", body: { status: t?.status ?? null, note: t?.note ?? "" } });
        // Only clear it if nothing changed while the request was in flight.
        if (state.items[id] === t) set({ pending: state.pending.filter((p) => p !== id) });
      }
      if (state.pendingSettings) {
        const sent = state.pendingSettings;
        const settings = await call<Settings>("/me/settings", { method: "PUT", body: sent });
        set({ pendingSettings: state.pendingSettings === sent ? null : state.pendingSettings, settings: { ...settings, ...(state.pendingSettings ?? {}) } });
      }
      const me = await call<MeResponse>("/me");
      const items: Record<string, Tracked> = {};
      for (const it of me.items) items[it.hackathon_id] = { status: it.status, note: it.note, updated_at: it.updated_at, hackathon: it.hackathon };
      // Changes made during the sync stay as they are; they go out next time.
      for (const id of state.pending) if (state.items[id]) items[id] = state.items[id];
      for (const id of state.pending) if (!state.items[id]) delete items[id];
      set({
        items,
        settings: state.pendingSettings ? { ...me.settings, ...state.pendingSettings } : me.settings,
        lastSync: new Date().toISOString(),
        error: null,
      });
    } catch (e) {
      set({ error: e instanceof KeyError ? "key" : "offline" });
      if (!(e instanceof KeyError)) {
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => void sync(), 30_000);
      }
    } finally {
      set({ syncing: false });
      syncing = null;
    }
    if (state.pending.length || state.pendingSettings) void sync();
  })();
  return syncing;
}

let noteTimer: number | undefined;

/** Change a hackathon's stage and/or note. No stage and no note forgets it. */
export function track(h: Hackathon, change: { status?: Stage | null; note?: string }, opts: { debounce?: boolean } = {}): void {
  const prev = state.items[h.id];
  const next: Tracked = {
    status: change.status !== undefined ? change.status : prev?.status ?? null,
    note: change.note !== undefined ? change.note : prev?.note ?? "",
    updated_at: new Date().toISOString(),
    hackathon: h,
  };
  const items = { ...state.items };
  if (next.status === null && !next.note.trim()) delete items[h.id];
  else items[h.id] = next;
  set({ items, pending: state.pending.includes(h.id) ? state.pending : [...state.pending, h.id] });
  window.clearTimeout(noteTimer);
  if (opts.debounce) noteTimer = window.setTimeout(() => void sync(), 900);
  else void sync();
}

/** Drop a hackathon from this device without telling the server (it was deleted there). */
export function forget(id: string): void {
  const items = { ...state.items };
  delete items[id];
  set({ items, pending: state.pending.filter((x) => x !== id) });
}

export function updateSettings(change: Partial<Settings>): void {
  set({
    settings: state.settings ? { ...state.settings, ...change } : state.settings,
    pendingSettings: { ...(state.pendingSettings ?? {}), ...change },
  });
  void sync();
}

/** Check a key against the API and keep it on this device. */
export async function connect(key: string): Promise<void> {
  const trimmed = key.trim();
  await call<MeResponse>("/me", {}, trimmed);
  try {
    localStorage.setItem(KEY_STORAGE, trimmed);
  } catch {
    /* kept for this session only */
  }
  set({ key: trimmed, error: null });
  await sync();
}

export function disconnect(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(DATA_STORAGE);
  } catch {
    /* ignore */
  }
  set({ key: null, items: {}, settings: null, pending: [], pendingSettings: null, lastSync: null, error: null });
}

export { KeyError };

// Sync when the app opens, comes back to the foreground, or gets its connection back.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
}
