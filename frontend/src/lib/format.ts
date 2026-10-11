import type { Format, Hackathon } from "./api";

const DAY = 86_400_000;

export const SOURCE_NAME: Record<string, string> = {
  devpost: "Devpost",
  devfolio: "Devfolio",
  mlh: "MLH",
  unstop: "Unstop",
  taikai: "TAIKAI",
  ethglobal: "ETHGlobal",
  web: "the web",
};

export const FORMAT_LABEL: Record<Format, string> = {
  online: "Online",
  in_person: "In person",
  hybrid: "Hybrid",
  unknown: "Format TBA",
};

const CATEGORY_LABEL: Record<string, string> = {
  "AI/ML": "AI & ML",
  "web3/blockchain": "Web3 & blockchain",
  "hardware/IoT": "Hardware & IoT",
  "open-ended": "Open-ended",
  software: "Software",
  web: "Web",
  mobile: "Mobile",
  data: "Data",
  robotics: "Robotics",
  networking: "Networking",
  cybersecurity: "Cybersecurity",
  gaming: "Gaming",
  health: "Health",
  fintech: "Fintech",
  climate: "Climate",
  education: "Education",
};

export function categoryLabel(c: string): string {
  return CATEGORY_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
}

/** The category shown on a card: the most specific one we have. */
export function mainCategory(h: Hackathon): string | null {
  return h.categories.find((c) => c !== "open-ended") ?? h.categories[0] ?? null;
}

export function sourceName(h: Pick<Hackathon, "source">): string {
  return SOURCE_NAME[h.source] ?? h.source;
}

export function prizeText(h: Hackathon): string {
  if (h.prize_usd == null) return "Prize TBA";
  if (h.prize_usd === 0) return "Non-cash prizes";
  return `${h.prize_confidence === "low" ? "≈ " : ""}$${Math.round(h.prize_usd).toLocaleString("en-US")} USD`;
}

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" });

export function fullDate(iso: string | null | undefined): string | null {
  return iso ? dateFmt.format(new Date(iso)) : null;
}

export function timeUtc(iso: string | null | undefined): string | null {
  return iso ? `${timeFmt.format(new Date(iso))} UTC` : null;
}

/** "Oct 25 – Nov 1, 2026" (year shown once when both dates share it). */
export function dateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (!start || !end) return fullDate(start ?? end);
  const s = new Date(start);
  const e = new Date(end);
  if (s.getUTCFullYear() !== e.getUTCFullYear()) return `${fullDate(start)} – ${fullDate(end)}`;
  return `${shortFmt.format(s)} – ${dateFmt.format(e)}`;
}

/** Whole calendar days between start and end dates, e.g. Oct 25 → Nov 1 = 7 days. */
export function durationDays(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  const a = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const b = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const d = Math.round((b - a) / DAY);
  if (d <= 0) return "1 day";
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/** Whole days until the registration deadline (0 = today), negative once passed, null if none. */
export function daysLeft(h: Pick<Hackathon, "registration_deadline">, now = Date.now()): number | null {
  if (!h.registration_deadline) return null;
  const ms = Date.parse(h.registration_deadline) - now;
  if (Number.isNaN(ms)) return null;
  return ms < 0 ? -1 : Math.floor(ms / DAY);
}

/** "Closes today", "Closes tomorrow", "Closes in N days". */
export function closesText(days: number): string {
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return `Closes in ${days} days`;
}

/**
 * The card's deadline pill: a countdown for the next month ("Closes in 12 days"),
 * the date after that, or "Starts …" when only a start date is known.
 * `full` is the exact deadline, for the tooltip.
 */
export function deadlineLabel(h: Hackathon): { text: string; tone: "red" | "grey"; full: string | null } | null {
  const days = daysLeft(h);
  if (days !== null) {
    const full = `${fullDate(h.registration_deadline)}, ${timeUtc(h.registration_deadline)}`;
    if (days < 0) return { text: `Closed ${fullDate(h.registration_deadline)}`, tone: "grey", full };
    return { text: days <= 30 ? closesText(days) : `Closes ${fullDate(h.registration_deadline)}`, tone: "red", full: `Registration closes ${full}` };
  }
  if (h.start_date) return { text: `Starts ${fullDate(h.start_date)}`, tone: "grey", full: null };
  return null;
}

/** First seen in the last 48 hours. Listings from the very first refresh don't count: everything was new then. */
export function isNew(h: Hackathon, firstRunAt: string | null, now = Date.now()): boolean {
  const seen = Date.parse(h.first_seen_at);
  if (now - seen > 2 * DAY) return false;
  return !(firstRunAt && seen - Date.parse(firstRunAt) < 3_600_000);
}

export function eligibilityLabel(h: Hackathon): { text: string; tone: "green" | "grey" } {
  if (h.international_ok === true) return { text: "International", tone: "green" };
  if (h.international_ok === false) return { text: "Regional", tone: "grey" };
  return { text: "Eligibility not specified", tone: "green" };
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "recently";
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Plain text from the light markdown some sources use. */
export function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|#{1,6}\s/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
