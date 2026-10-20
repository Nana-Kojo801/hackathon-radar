import { GLYPH_PATHS } from "../components/icons.generated";
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

const usable = (u: string | null | undefined) => (u && !PLACEHOLDER.test(u) ? u : null);

/**
 * Artwork for a square spot (list rows, cards): the platform's square icon,
 * else the organizer's logo (padded on a plain tile, `logo`), else the
 * listing's one image cropped to fit.
 */
export function iconOf(h: Pick<Hackathon, "image_url" | "logo_url" | "icon_url">): { src: string; logo: boolean } | null {
  const icon = usable(h.icon_url);
  if (icon) return { src: icon, logo: false };
  if (h.logo_url) return { src: h.logo_url, logo: true };
  const img = usable(h.image_url);
  return img ? { src: img, logo: false } : null;
}

/** Wide artwork for the top of a hackathon's page. */
export function bannerOf(h: Pick<Hackathon, "banner_url">): string | null {
  return usable(h.banner_url);
}

/** The listing's own image, unless it's a platform placeholder. */
const PLACEHOLDER = /placeholder|default[-_]?thumbnail/i;

export function imageOf(h: Pick<Hackathon, "image_url">): string | null {
  const u = h.image_url;
  if (!u || PLACEHOLDER.test(u)) return null;
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
/** Theme glyphs (Phosphor, solid) for listings without art; paths on a 256-unit grid. */
export const GLYPH = GLYPH_PATHS;

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
