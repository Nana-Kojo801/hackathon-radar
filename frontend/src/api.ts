export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

export type Format = "online" | "in_person" | "hybrid" | "unknown";
export type Sort = "prize" | "deadline" | "new" | "relevance";

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

export interface ListResponse {
  items: Hackathon[];
  total: number;
  limit: number;
  offset: number;
}

export interface SourceHealth {
  source: string;
  started_at: string;
  finished_at: string | null;
  fetched: number;
  new: number;
  errors: number;
  error_text: string | null;
  tokens_used: number;
  healthy: boolean;
}

export interface Meta {
  categories: { category: string; count: number }[];
  active_count: number;
  last_refresh: string | null;
  first_run_at: string | null;
  sources: SourceHealth[];
}

export interface Filters {
  q: string;
  sort: Sort;
  categories: string[];
  format: Format | "";
  minPrize: number;
  internationalOnly: boolean;
  hideStudentOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  sort: "prize",
  categories: [],
  format: "",
  minPrize: 0,
  internationalOnly: false,
  hideStudentOnly: false,
};

export function buildQuery(f: Filters, offset: number, limit: number): string {
  const p = new URLSearchParams();
  p.set("sort", f.sort);
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  if (f.q.trim()) p.set("q", f.q.trim());
  f.categories.forEach((c) => p.append("category", c));
  if (f.format) p.set("format", f.format);
  if (f.minPrize > 0) p.set("min_prize", String(f.minPrize));
  if (f.internationalOnly) p.set("international_ok", "true");
  if (f.hideStudentOnly) p.set("student_only", "false");
  return p.toString();
}

/**
 * Fetch with retries: the free Render instance sleeps when idle and can take
 * 30-60s to wake up, so early failures/timeouts are expected.
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
      if (res.status < 500) throw new Error(`HTTP ${res.status}`);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    await new Promise((r) => setTimeout(r, Math.min(2000 * (i + 1), 8000)));
  }
  throw lastError instanceof Error ? lastError : new Error("request failed");
}
