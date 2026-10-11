import type { Format, Hackathon } from "./api";
import { msLeft } from "./format";

export type Sort = "prize" | "deadline" | "new";

export interface Filters {
  q: string;
  sort: Sort;
  categories: string[];
  format: Format | "";
  minPrize: number;
  worldwide: boolean;
  hideStudentOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  sort: "prize",
  categories: [],
  format: "",
  minPrize: 0,
  worldwide: false,
  hideStudentOnly: false,
};

export const MIN_PRIZES = [0, 1_000, 10_000, 50_000, 100_000];

const KEY = "hackathon-radar:filters:v2";

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw), q: "" };
  } catch {
    /* storage unavailable: defaults */
  }
  return DEFAULT_FILTERS;
}

export function saveFilters(f: Filters): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...f, q: "" }));
  } catch {
    /* ignore */
  }
}

export function activeCount(f: Filters): number {
  return (
    f.categories.length + (f.format ? 1 : 0) + (f.minPrize > 0 ? 1 : 0) + (f.worldwide ? 1 : 0) + (f.hideStudentOnly ? 1 : 0)
  );
}

/** Everything is filtered client-side: ~200 rows, so it's instant and needs no round trip. */
export function applyFilters(items: Hackathon[], f: Filters, now = Date.now()): Hackathon[] {
  const q = f.q.trim().toLowerCase();
  const out = items.filter((h) => {
    if (f.format && !(h.format === f.format || (f.format !== "hybrid" && h.format === "hybrid"))) return false;
    if (f.minPrize > 0 && !((h.prize_usd ?? 0) >= f.minPrize)) return false;
    if (f.worldwide && h.international_ok === false) return false;
    if (f.hideStudentOnly && h.student_only === true) return false;
    if (f.categories.length && !h.categories.some((c) => f.categories.includes(c))) return false;
    if (q) {
      const hay = `${h.title} ${h.organizer ?? ""} ${h.summary ?? ""} ${h.location_text ?? ""} ${h.categories.join(" ")}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const left = (h: Hackathon) => {
    const ms = msLeft(h, now);
    return ms == null || ms <= 0 ? Number.MAX_SAFE_INTEGER : ms;
  };
  if (f.sort === "prize") out.sort((a, b) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1) || left(a) - left(b));
  else if (f.sort === "deadline") out.sort((a, b) => left(a) - left(b) || (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
  else out.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at));
  return out;
}
