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

/** "$1M", "$500K", "$7.2K", "$240"; for lists, where the full amount is too wide. */
export function compactMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 >= 100_000 ? 1 : 0)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}K`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(n)}`;
}

/** The prize for a list row: compact, "≈" when the AI was unsure. */
export function prizeShort(h: Pick<Hackathon, "prize_usd" | "prize_confidence">): string {
  if (h.prize_usd == null) return "TBA";
  if (h.prize_usd === 0) return "Non-cash";
  return `${h.prize_confidence === "low" ? "≈" : ""}${compactMoney(h.prize_usd)}`;
}

/** The full prize for headlines: "$138,000". */
export function prizeFull(h: Pick<Hackathon, "prize_usd" | "prize_confidence">): string {
  if (h.prize_usd == null) return "Prize TBA";
  if (h.prize_usd === 0) return "Non-cash prizes";
  return `${h.prize_confidence === "low" ? "≈ " : ""}${money(h.prize_usd)}`;
}

export type Tone = "red" | "orange" | "neutral";

/** The deadline tag on rows: "Closes today", "3 days left", "Closes 18 Nov", "Dates TBA". */
export function dueTag(h: Hackathon): { text: string; tone: Tone; days: number | null } {
  const days = daysLeft(h);
  if (days === null) {
    if (h.start_date) return { text: `Starts ${dayMonth(h.start_date)}`, tone: "neutral", days: null };
    return { text: "Dates TBA", tone: "neutral", days: null };
  }
  if (days < 0) return { text: "Closed", tone: "neutral", days };
  if (days === 0) return { text: "Closes today", tone: "red", days };
  if (days === 1) return { text: "Closes tomorrow", tone: "red", days };
  if (days <= 7) return { text: `${days} days left`, tone: "orange", days };
  return { text: `Closes ${dayMonth(h.registration_deadline)}`, tone: "neutral", days };
}

const dmFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const wdmFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const wdFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const longDateFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

/** "18 Nov" */
export function dayMonth(iso: string | null | undefined): string {
  return iso ? dmFmt.format(new Date(iso)) : "TBA";
}
/** "Fri 23 Oct" */
export function weekdayDate(iso: string | null | undefined): string {
  return iso ? wdmFmt.format(new Date(iso)).replace(",", "") : "TBA";
}
/** "Sunday", in the viewer's timezone. */
export function weekday(iso: string): string {
  return wdFmt.format(new Date(iso));
}
/** "Tuesday 20 October", today, in the viewer's timezone. */
export function todayLong(): string {
  return longDateFmt.format(new Date()).replace(",", "");
}

/** The organizer's logo, shown on a plain tile when there's no cover. */
export function logoOf(h: Pick<Hackathon, "image_url" | "logo_url">): string | null {
  return imageOf(h) ? null : (h.logo_url ?? null);
}

/** The listing's own image, unless it's a platform placeholder. */
export function imageOf(h: Pick<Hackathon, "image_url">): string | null {
  const u = h.image_url;
  if (!u || /placeholder|default[-_]?thumbnail/i.test(u)) return null;
  return u;
}

/** A gradient and glyph for listings without art, chosen by theme so they stay recognisable. */
export function fallbackArt(h: Pick<Hackathon, "categories" | "id">): { gradient: string; glyph: string } {
  const c = mainCategory(h as Hackathon) ?? "open-ended";
  const art: Record<string, [string, string, string]> = {
    "AI/ML": ["#7B61FF", "#2F6BFF", GLYPH.sparkle],
    "web3/blockchain": ["#9B6BFF", "#5A31B0", GLYPH.cube],
    "hardware/IoT": ["#FF9F43", "#E2541B", GLYPH.chip],
    robotics: ["#FF9F43", "#E2541B", GLYPH.chip],
    health: ["#FF6B8B", "#D6336C", GLYPH.heart],
    climate: ["#4CD38A", "#14915A", GLYPH.leaf],
    fintech: ["#34C3A0", "#0E8A6B", GLYPH.coin],
    gaming: ["#FF7AC6", "#B83FD6", GLYPH.game],
    cybersecurity: ["#5AC8FA", "#2F5BD8", GLYPH.shield],
    education: ["#FFB340", "#E07800", GLYPH.book],
  };
  const [a, b, glyph] = art[c] ?? ["#4DA2FF", "#1B5FD9", GLYPH.globe];
  return { gradient: `linear-gradient(145deg, ${a} 0%, ${b} 100%)`, glyph };
}

/** Filled 24×24 glyphs for the fallback art. */
export const GLYPH = {
  sparkle: "M12 2.5l1.9 5.6a3 3 0 0 0 1.9 1.9l5.7 2-5.7 2a3 3 0 0 0-1.9 1.9L12 21.5l-1.9-5.6a3 3 0 0 0-1.9-1.9L2.5 12l5.7-2a3 3 0 0 0 1.9-1.9z",
  cube: "M12 2 3.5 6.8v10.4L12 22l8.5-4.8V6.8zm0 2.3 6 3.4-6 3.4-6-3.4z",
  chip: "M8 3h8v2h2a1 1 0 0 1 1 1v2h2v2h-2v4h2v2h-2v2a1 1 0 0 1-1 1h-2v2H8v-2H6a1 1 0 0 1-1-1v-2H3v-2h2v-4H3V8h2V6a1 1 0 0 1 1-1h2zm1 6v6h6V9z",
  heart: "M12 21s-8.5-5.3-8.5-11.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 8.5 3.2C20.5 15.7 12 21 12 21z",
  leaf: "M20 3c0 9.5-5 16-13 16-1.1 0-2.1-.2-3-.5C5 11 11 5 20 3z",
  coin: "M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm1 4h-2v1.2c-1.6.4-2.7 1.5-2.7 3 0 1.9 1.6 2.6 3.5 3.1 1.4.3 1.9.7 1.9 1.3 0 .6-.6 1.1-1.7 1.1-1.2 0-2-.5-2.2-1.4H7.8c.2 1.7 1.4 2.8 3.2 3.2v1.5h2v-1.5c1.7-.4 2.8-1.5 2.8-3 0-2-1.7-2.7-3.6-3.2-1.3-.3-1.8-.6-1.8-1.2 0-.5.5-1 1.5-1 1 0 1.7.5 1.9 1.2h1.9c-.2-1.5-1.2-2.6-2.7-3z",
  game: "M7 7h10a5 5 0 0 1 4.9 6l-.6 3.2a2.5 2.5 0 0 1-4.3 1.2L15 15.5H9l-2 1.9a2.5 2.5 0 0 1-4.3-1.2L2.1 13A5 5 0 0 1 7 7zm0 3v1.5H5.5V13H7v1.5h1.5V13H10v-1.5H8.5V10zm9.5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm-2 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  shield: "M12 2 4 5v6.5c0 5 3.4 9.3 8 10.5 4.6-1.2 8-5.5 8-10.5V5z",
  book: "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A1.5 1.5 0 0 0 5 19.5 1.5 1.5 0 0 0 6.5 21H20v1H6.5A2.5 2.5 0 0 1 4 19.5z",
  globe: "M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19zm-1.4 2.1A7.5 7.5 0 0 0 4.6 11h3.3c.1-2.4.9-4.6 2.7-6.4zm2.8 0c1.8 1.8 2.6 4 2.7 6.4h3.3a7.5 7.5 0 0 0-6-6.4zM12 5.4c-1.4 1.6-2.1 3.5-2.1 5.6h4.2c0-2.1-.7-4-2.1-5.6zM4.6 13a7.5 7.5 0 0 0 6 6.4c-1.8-1.8-2.6-4-2.7-6.4zm5.3 0c0 2.1.7 4 2.1 5.6 1.4-1.6 2.1-3.5 2.1-5.6zm6.2 0c-.1 2.4-.9 4.6-2.7 6.4a7.5 7.5 0 0 0 6-6.4z",
} as const;

/** The pipeline runs at :17 past every sixth hour UTC (.github/workflows/refresh.yml). */
const RUN_EVERY_H = 6;
const RUN_MINUTE = 17;

/**
 * When the next refresh is due. GitHub often starts scheduled runs late, so if
 * the latest slot has passed but no refresh has landed since, it is "due" (the
 * run is queued or in progress) for up to 90 minutes.
 */
export function nextRefresh(lastRefresh: string | null | undefined, now = Date.now()): { at: number; due: boolean } {
  const d = new Date(now);
  const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(d.getUTCHours() / RUN_EVERY_H) * RUN_EVERY_H, RUN_MINUTE);
  const last = slot > now ? slot - RUN_EVERY_H * 3_600_000 : slot;
  const ran = lastRefresh ? Date.parse(lastRefresh) >= last - 5 * 60_000 : false;
  if (!ran && now - last < 90 * 60_000) return { at: last, due: true };
  return { at: last + RUN_EVERY_H * 3_600_000, due: false };
}

/** 7_380_000 → "2:03:00". */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
