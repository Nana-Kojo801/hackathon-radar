import type { Format, Hackathon } from "./api";

export type Sort = "prize" | "deadline" | "new";
export type International = "any" | "international" | "not-restricted";
export type Student = "any" | "hide" | "only";
export type View = "cards" | "table";

export interface Filters {
  q: string;
  format: Format | "all";
  international: International;
  student: Student;
  category: string;
  minPrize: string;
  sort: Sort;
  view: View;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  format: "all",
  international: "any",
  student: "any",
  category: "all",
  minPrize: "0",
  sort: "prize",
  view: "cards",
};

export const FORMAT_OPTIONS: { value: Filters["format"]; label: string }[] = [
  { value: "all", label: "All formats" },
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];
export const INTERNATIONAL_OPTIONS: { value: International; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "international", label: "International" },
  { value: "not-restricted", label: "Not region-locked" },
];
export const STUDENT_OPTIONS: { value: Student; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "hide", label: "Hide student-only" },
  { value: "only", label: "Student-only" },
];
export const PRIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Any" },
  { value: "1000", label: "$1,000+" },
  { value: "10000", label: "$10,000+" },
  { value: "50000", label: "$50,000+" },
  { value: "100000", label: "$100,000+" },
];
export const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "prize", label: "Prize" },
  { value: "deadline", label: "Deadline" },
  { value: "new", label: "Newest" },
];

const KEY = "hackathon-radar:filters:v3";

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw), q: "" };
  } catch {
    /* storage unavailable */
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

export function activeFilterCount(f: Filters): number {
  return [f.format !== "all", f.international !== "any", f.student !== "any", f.category !== "all", f.minPrize !== "0"].filter(Boolean)
    .length;
}

/** ~200 rows, so filtering happens in the browser and feels instant. */
export function applyFilters(items: Hackathon[], f: Filters): Hackathon[] {
  const q = f.q.trim().toLowerCase();
  const min = Number(f.minPrize) || 0;
  const out = items.filter((h) => {
    if (f.format !== "all" && !(h.format === f.format || (f.format !== "hybrid" && h.format === "hybrid"))) return false;
    if (f.international === "international" && h.international_ok !== true) return false;
    if (f.international === "not-restricted" && h.international_ok === false) return false;
    if (f.student === "hide" && h.student_only === true) return false;
    if (f.student === "only" && h.student_only !== true) return false;
    if (f.category !== "all" && !h.categories.includes(f.category)) return false;
    if (min > 0 && !((h.prize_usd ?? 0) >= min)) return false;
    if (q) {
      const hay = `${h.title} ${h.organizer ?? ""} ${h.summary ?? ""} ${h.location_text ?? ""} ${h.categories.join(" ")}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const deadline = (h: Hackathon) => {
    const t = Date.parse(h.registration_deadline ?? h.start_date ?? "");
    return Number.isNaN(t) || t < Date.now() ? Number.MAX_SAFE_INTEGER : t;
  };
  if (f.sort === "prize") out.sort((a, b) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1) || deadline(a) - deadline(b));
  else if (f.sort === "deadline") out.sort((a, b) => deadline(a) - deadline(b) || (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
  else out.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at));
  return out;
}
