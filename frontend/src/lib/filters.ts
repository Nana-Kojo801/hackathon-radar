import type { Format, Hackathon } from "./api";
import { categoryLabel, compactMoney, daysLeft, isNew, SOURCE_NAME } from "./format";

export type Sort = "prize" | "deadline" | "new" | "relevance";
export type International = "any" | "international" | "not-restricted";
export type Student = "any" | "hide" | "only";
export type Within = "0" | "3" | "7" | "30";

export interface Filters {
  q: string;
  format: Format | "all";
  international: International;
  student: Student;
  /** Any of these (empty = all). */
  categories: string[];
  minPrize: string;
  /** Registration closes within this many days ("0" = any time). */
  within: Within;
  /** Platforms left out (empty = all). */
  hiddenSources: string[];
  /** Only listings first seen since your last visit. Not saved between visits. */
  newOnly: boolean;
  sort: Sort;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  format: "all",
  international: "any",
  student: "any",
  categories: [],
  minPrize: "0",
  within: "0",
  hiddenSources: [],
  newOnly: false,
  sort: "prize",
};

export const FORMAT_OPTIONS: { value: Filters["format"]; label: string }[] = [
  { value: "all", label: "Any" },
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
];
export const INTERNATIONAL_OPTIONS: { value: International; label: string }[] = [
  { value: "any", label: "Anyone" },
  { value: "international", label: "Worldwide" },
  { value: "not-restricted", label: "Not region-locked" },
];
export const STUDENT_OPTIONS: { value: Student; label: string }[] = [
  { value: "any", label: "Everyone" },
  { value: "hide", label: "Hide student-only" },
  { value: "only", label: "Students only" },
];
export const PRIZE_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "Any" },
  { value: "1000", label: "$1,000" },
  { value: "10000", label: "$10,000" },
  { value: "50000", label: "$50,000" },
  { value: "100000", label: "$100,000" },
];
export const WITHIN_OPTIONS: { value: Within; label: string }[] = [
  { value: "0", label: "Any time" },
  { value: "3", label: "3 days" },
  { value: "7", label: "A week" },
  { value: "30", label: "A month" },
];
export const SORT_OPTIONS: { value: Sort; label: string; short: string }[] = [
  { value: "prize", label: "Biggest prize", short: "Prize" },
  { value: "deadline", label: "Closing soonest", short: "Deadline" },
  { value: "new", label: "Newest", short: "Newest" },
  { value: "relevance", label: "Best match", short: "Best match" },
];
export const SOURCE_OPTIONS = Object.entries(SOURCE_NAME).map(([value, label]) => ({ value, label: value === "web" ? "Web finds" : label }));

const KEY = "hackathon-radar:filters:v4";

export function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem("hackathon-radar:filters:v3");
    if (raw) {
      const saved = JSON.parse(raw);
      if (typeof saved.category === "string") saved.categories = saved.category === "all" ? [] : [saved.category];
      const f = { ...DEFAULT_FILTERS, ...saved, q: "", newOnly: false };
      if (!Array.isArray(f.categories)) f.categories = [];
      if (!Array.isArray(f.hiddenSources)) f.hiddenSources = [];
      if (f.format === "hybrid") f.format = "all";
      delete (f as { view?: unknown }).view;
      delete (f as { category?: unknown }).category;
      return f;
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_FILTERS;
}

export function saveFilters(f: Filters): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...f, q: "", newOnly: false }));
  } catch {
    /* ignore */
  }
}

/** The filters that narrow the list, each with a label and how to undo it (for the chips). */
export function activeFilters(f: Filters): { key: string; label: string; clear: Partial<Filters> }[] {
  const out: { key: string; label: string; clear: Partial<Filters> }[] = [];
  if (f.newOnly) out.push({ key: "new", label: "New", clear: { newOnly: false } });
  if (f.within !== "0") out.push({ key: "within", label: `Closes within ${WITHIN_OPTIONS.find((o) => o.value === f.within)?.label.toLowerCase()}`, clear: { within: "0" } });
  if (f.format !== "all") out.push({ key: "format", label: f.format === "online" ? "Online" : "In person", clear: { format: "all" } });
  if (f.minPrize !== "0") out.push({ key: "prize", label: `${compactMoney(Number(f.minPrize))}+`, clear: { minPrize: "0" } });
  for (const c of f.categories) out.push({ key: `cat:${c}`, label: categoryLabel(c), clear: { categories: f.categories.filter((x) => x !== c) } });
  if (f.international !== "any") out.push({ key: "intl", label: INTERNATIONAL_OPTIONS.find((o) => o.value === f.international)!.label, clear: { international: "any" } });
  if (f.student !== "any") out.push({ key: "student", label: STUDENT_OPTIONS.find((o) => o.value === f.student)!.label, clear: { student: "any" } });
  if (f.hiddenSources.length) out.push({ key: "sources", label: `${SOURCE_OPTIONS.length - f.hiddenSources.length} of ${SOURCE_OPTIONS.length} platforms`, clear: { hiddenSources: [] } });
  return out;
}

export function activeFilterCount(f: Filters): number {
  return activeFilters(f).length;
}

function deadlineOrder(h: Hackathon): number {
  const t = Date.parse(h.registration_deadline ?? h.start_date ?? "");
  return Number.isNaN(t) || t < Date.now() ? Number.MAX_SAFE_INTEGER : t;
}

/** ~500 rows, so filtering happens in the browser and feels instant. */
export function applyFilters(items: Hackathon[], f: Filters, newSince: string | null, firstRunAt: string | null): Hackathon[] {
  const q = f.q.trim().toLowerCase();
  const min = Number(f.minPrize) || 0;
  const within = Number(f.within) || 0;
  const since = newSince ? Date.parse(newSince) : null;
  const out = items.filter((h) => {
    if (f.format !== "all" && !(h.format === f.format || h.format === "hybrid")) return false;
    if (f.international === "international" && h.international_ok !== true) return false;
    if (f.international === "not-restricted" && h.international_ok === false) return false;
    if (f.student === "hide" && h.student_only === true) return false;
    if (f.student === "only" && h.student_only !== true) return false;
    if (f.categories.length && !f.categories.some((c) => h.categories.includes(c))) return false;
    if (f.hiddenSources.includes(h.source)) return false;
    if (min > 0 && !((h.prize_usd ?? 0) >= min)) return false;
    if (within > 0) {
      const d = daysLeft(h);
      if (d === null || d < 0 || d >= within) return false;
    }
    if (f.newOnly && !(since ? Date.parse(h.first_seen_at) > since : isNew(h, firstRunAt))) return false;
    if (q) {
      const hay = `${h.title} ${h.organizer ?? ""} ${h.summary ?? ""} ${h.location_text ?? ""} ${h.categories.join(" ")} ${h.categories.map(categoryLabel).join(" ")}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  if (f.sort === "prize") out.sort((a, b) => (b.prize_usd ?? -1) - (a.prize_usd ?? -1) || deadlineOrder(a) - deadlineOrder(b));
  else if (f.sort === "deadline") out.sort((a, b) => deadlineOrder(a) - deadlineOrder(b) || (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
  else if (f.sort === "relevance")
    out.sort((a, b) => (b.relevance_score ?? -1) - (a.relevance_score ?? -1) || (b.prize_usd ?? -1) - (a.prize_usd ?? -1));
  else out.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at));
  return out;
}

// ---------------------------------------------------------------- visits

const VISIT_KEY = "hackathon-radar:visits:v1";

/**
 * "New since your last visit": the start of the previous visit, where a visit
 * is an app open more than an hour after the last one. Falls back to 48 hours.
 */
export function lastVisit(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(VISIT_KEY) ?? "null") as { current: string; previous: string | null } | null;
    const now = new Date();
    if (!v) {
      localStorage.setItem(VISIT_KEY, JSON.stringify({ current: now.toISOString(), previous: null }));
      return null;
    }
    if (now.getTime() - Date.parse(v.current) > 3_600_000) {
      localStorage.setItem(VISIT_KEY, JSON.stringify({ current: now.toISOString(), previous: v.current }));
      return capVisit(v.current);
    }
    return capVisit(v.previous);
  } catch {
    return null;
  }
}

/** A visit more than two weeks ago makes "new" meaningless; use the last 48 hours then. */
function capVisit(iso: string | null): string | null {
  if (!iso) return null;
  return Date.now() - Date.parse(iso) > 14 * 86_400_000 ? null : iso;
}
