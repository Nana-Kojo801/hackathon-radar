import type { Hackathon } from "./api";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function prizeLabel(h: Hackathon): { main: string; sub: string | null; known: boolean } {
  if (h.prize_usd == null) {
    return { main: "—", sub: h.prize_notes || h.prize_text || "Prize unknown", known: false };
  }
  if (h.prize_usd === 0) {
    return { main: "Non-cash", sub: h.prize_notes || "Swag / credits", known: false };
  }
  const approx = h.prize_confidence === "low" ? "~" : "";
  const main = `${approx}$${compact.format(h.prize_usd)}`;
  const nonUsd = h.prize_text && !/^\$\s?\d|^USD/i.test(h.prize_text) ? h.prize_text : null;
  return { main, sub: nonUsd || h.prize_notes, known: true };
}

export const MIN_PRIZE_STEPS = [0, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

export function moneyShort(n: number): string {
  return n === 0 ? "Any" : `$${compact.format(n)}+`;
}

export interface Countdown {
  label: string;
  tone: "urgent" | "soon" | "normal" | "muted";
}

/** Countdown to the registration deadline, else to the start date. */
export function countdown(h: Hackathon, now = Date.now()): Countdown | null {
  const deadline = h.registration_deadline ? Date.parse(h.registration_deadline) : null;
  const start = h.start_date ? Date.parse(h.start_date) : null;
  const end = h.end_date ? Date.parse(h.end_date) : null;
  const target = deadline ?? (start && start > now ? start : null);
  if (!target) {
    if (end && end > now) return { label: `Ends in ${span(end - now)}`, tone: "muted" };
    return null;
  }
  const verb = deadline ? "Closes" : "Starts";
  const diff = target - now;
  if (diff <= 0) return { label: `${verb === "Closes" ? "Closed" : "Started"}`, tone: "muted" };
  const days = diff / 86_400_000;
  const tone = days < 3 ? "urgent" : days < 10 ? "soon" : "normal";
  return { label: `${verb} in ${span(diff)}`, tone };
}

function span(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 24) return `${Math.max(h, 1)}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ${h % 24}h`;
  if (d < 60) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function dateRange(h: Hackathon): string | null {
  const s = h.start_date ? new Date(h.start_date) : null;
  const e = h.end_date ? new Date(h.end_date) : null;
  if (s && e) {
    const a = dateFmt.format(s);
    const b = dateFmt.format(e);
    return a === b ? a : `${a} – ${b}`;
  }
  if (s) return dateFmt.format(s);
  if (e) return `until ${dateFmt.format(e)}`;
  return null;
}

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function isNew(h: Hackathon, firstRunAt: string | null, now = Date.now()): boolean {
  const seen = Date.parse(h.first_seen_at);
  if (now - seen > 48 * 3_600_000) return false;
  // Everything was "new" on the very first run, which isn't useful.
  if (firstRunAt && seen - Date.parse(firstRunAt) < 3_600_000) return false;
  return true;
}

export const FORMAT_LABEL: Record<string, string> = {
  online: "Online",
  in_person: "In person",
  hybrid: "Hybrid",
  unknown: "Format ?",
};

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
