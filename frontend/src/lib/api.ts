export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

/**
 * Static copy of the data, published to GitHub Pages after every refresh
 * (backend/app/snapshot.py). Read first so the site loads without waiting for
 * the sleeping API. Override with VITE_SNAPSHOT_URL, or set it to "off".
 */
const SNAPSHOT_SETTING = import.meta.env.VITE_SNAPSHOT_URL as string | undefined;
export const SNAPSHOT_URL =
  SNAPSHOT_SETTING === "off"
    ? null
    : SNAPSHOT_SETTING?.replace(/\/$/, "") || (import.meta.env.PROD ? "https://nana-kojo801.github.io/hackathon-radar" : null);

export type Format = "online" | "in_person" | "hybrid" | "unknown";

export interface Hackathon {
  id: string;
  source: string;
  source_url: string;
  alt_urls: string[];
  title: string;
  organizer: string | null;
  summary: string | null;
  image_url: string | null;
  prize_text: string | null;
  prize_usd: number | null;
  prize_confidence: "high" | "medium" | "low" | null;
  prize_notes: string | null;
  format: Format;
  location_text: string | null;
  categories: string[];
  international_ok: boolean | null;
  student_only: boolean | null;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  status: "upcoming" | "open" | "ended";
  relevance_score: number | null;
  first_seen_at: string;
  last_seen_at: string;
  enriched: boolean;
}

export interface Prize {
  name: string;
  amount_text: string | null;
  amount_usd: number | null;
  winners: number;
  perks: string[];
  /** Only on prizes the AI read from the description. */
  track?: string | null;
  rank?: number | null;
}

export interface HackathonDetail extends Hackathon {
  description: string | null;
  /** The description tidied by AI, as Markdown (pipeline/polish.py); null until it's been done. */
  about?: string | null;
  /** Prizes the AI found in the description, used when the platform gave no breakdown. */
  about_prizes?: Prize[];
  prizes: Prize[];
  dates_text: string | null;
}

export interface SourceRun {
  source: string;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  new: number;
  errors: number;
  error_text: string | null;
  healthy: boolean;
}

export interface Meta {
  categories: { category: string; count: number }[];
  active_count: number;
  last_refresh: string | null;
  first_run_at: string | null;
  sources: SourceRun[];
  /** Only on the snapshot copy: when it was built. */
  generated_at?: string;
}

/**
 * Fetch with retries: the free Render instance sleeps when idle and can take
 * 30-60s to wake up, so early failures and timeouts are expected.
 */
export async function fetchJSON<T>(path: string, signal?: AbortSignal, attempts = 6): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(`${API_URL}${path}`, { signal: ctrl.signal });
      if (res.ok) return (await res.json()) as T;
      if (res.status < 500) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (signal?.aborted || (e as { fatal?: boolean }).fatal) throw e;
      lastError = e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * (i + 1), 8000)));
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}

/**
 * Read from the snapshot when there is one, falling back to the API if it's
 * missing or unreachable. "no-cache" revalidates with GitHub Pages each time
 * (a cheap 304 when nothing changed), so a new snapshot shows up right away.
 */
export async function fetchData<T>(snapshotPath: string, apiPath: string, signal?: AbortSignal): Promise<T> {
  if (SNAPSHOT_URL) {
    try {
      const res = await fetch(`${SNAPSHOT_URL}/${snapshotPath}`, { signal, cache: "no-cache" });
      if (res.ok) return (await res.json()) as T;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return fetchJSON<T>(apiPath, signal);
}
