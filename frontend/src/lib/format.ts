import type { Hackathon } from "./api";

const DAY = 86_400_000;

export const SOURCE_NAME: Record<string, string> = {
  devpost: "Devpost",
  devfolio: "Devfolio",
  mlh: "MLH",
  web: "the web",
};

export const FORMAT_LABEL: Record<string, string> = {
  online: "Online",
  in_person: "In person",
  hybrid: "Hybrid",
  unknown: "Format TBA",
};

/** Ring colour per topic. Bright enough on the dark ground, distinct in lightness too. */
const TOPIC_COLOR: Record<string, string> = {
  "AI/ML": "#8B9CFF",
  "web3/blockchain": "#B78CFF",
  education: "#5BE3A1",
  climate: "#5BE3A1",
  gaming: "#FF7A66",
  software: "#4FD1FF",
  web: "#4FD1FF",
  mobile: "#4FD1FF",
  data: "#6FE7DD",
  networking: "#6FE7DD",
  "hardware/IoT": "#FF9F5A",
  robotics: "#FF9F5A",
  cybersecurity: "#FF6B9A",
  health: "#F59AE0",
  fintech: "#F5D06A",
  "open-ended": "#FFC857",
};
export const NO_TOPIC = "#6B6F78";

export function colorOf(h: Pick<Hackathon, "categories">): string {
  const main = h.categories.find((c) => c !== "open-ended") ?? h.categories[0];
  return (main && TOPIC_COLOR[main]) || NO_TOPIC;
}

export function topicColor(c: string): string {
  return TOPIC_COLOR[c] ?? NO_TOPIC;
}

/** The moment that matters: registration deadline, else the start date. */
export function targetTime(h: Hackathon): number | null {
  const t = h.registration_deadline ?? h.start_date;
  return t ? Date.parse(t) : null;
}

export function msLeft(h: Hackathon, now = Date.now()): number | null {
  const t = targetTime(h);
  return t == null ? null : t - now;
}

export function isUrgent(h: Hackathon, now = Date.now()): boolean {
  const ms = msLeft(h, now);
  return ms != null && ms > 0 && ms < 3 * DAY;
}

/** Share of the registration window still left, 0..1, or null when there is no deadline. */
export function remaining(h: Hackathon, now = Date.now()): number | null {
  if (!h.registration_deadline) return null;
  const dl = Date.parse(h.registration_deadline);
  if (dl <= now) return 0;
  const st = h.start_date ? Date.parse(h.start_date) : null;
  const open = st != null && st < dl ? st : dl - 30 * DAY;
  if (now <= open) return 1;
  return Math.max(0.02, Math.min(1, (dl - now) / (dl - open)));
}

export function shortLeft(h: Hackathon, now = Date.now()): string {
  const ms = msLeft(h, now);
  if (ms == null) return "Dates TBA";
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / DAY);
  const n = d >= 1 ? `${d}d` : `${Math.max(1, Math.floor(ms / 3_600_000))}h`;
  return h.registration_deadline ? `${n} left` : `${n} to start`;
}

export function longLeft(h: Hackathon, now = Date.now()): string {
  const ms = msLeft(h, now);
  if (ms == null) return "TBA";
  if (ms <= 0) return "Closed";
  const d = Math.floor(ms / DAY);
  const hr = Math.floor((ms % DAY) / 3_600_000);
  if (d >= 1) return `${d}d ${hr}h`;
  const min = Math.floor((ms % 3_600_000) / 60_000);
  return `${hr}h ${min}m`;
}

const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function compactMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n === 0) return "Prizes";
  return `$${compactFmt.format(n)}`;
}

export function prizeShort(h: Hackathon): string {
  if (h.prize_usd == null) return "—";
  if (h.prize_usd === 0) return "Non-cash";
  return (h.prize_confidence === "low" ? "~" : "") + compactMoney(h.prize_usd);
}

export function fullMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dayYearFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function day(iso: string | null | undefined, withYear = false): string | null {
  if (!iso) return null;
  return (withYear ? dayYearFmt : dayFmt).format(new Date(iso));
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
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
  if (now - seen > 2 * DAY) return false;
  // Everything was "new" on the very first refresh, which isn't useful.
  return !(firstRunAt && seen - Date.parse(firstRunAt) < 3_600_000);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Strip the little markdown Devfolio descriptions carry. */
export function cleanText(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|#{1,6}\s/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
