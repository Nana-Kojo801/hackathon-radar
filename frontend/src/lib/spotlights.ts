import type { IconName } from "../components/Icon";
import type { Hackathon } from "./api";
import { daysLeft, durationDays, weekday, weekdayDate } from "./format";

/**
 * Today's spotlight: one hackathon for each thing that makes one stand out (the biggest prize
 * closing this week, the most registrations, the biggest new find, ...), shown as a carousel.
 * Each picks a different hackathon, and ones you've already saved or hidden are left out.
 */

export interface Spotlight {
  key: string;
  label: string;
  icon: IconName;
  /** The label's colour. */
  tone: string;
  /** Why this one, in a few words ("61,282 registered"); null when the label says it all. */
  why: string | null;
  h: Hackathon;
}

// Aimed at women: said in the title, or plainly in the summary ("women-only", "for women in tech").
const WOMEN_TITLE = /\b(women|woman|female|girls|womxn|ladies)\b/i;
const WOMEN_TEXT = /\b(women|female|girls|womxn)\b[\s-]*(only|in (tech|stem|computing|ai|engineering|data)|developers|founders|hackers|coders|builders|led)\b|\bfor (women|girls|females)\b/i;

export function forWomen(h: Hackathon): boolean {
  return WOMEN_TITLE.test(h.title) || WOMEN_TEXT.test(`${h.summary ?? ""} ${h.prize_notes ?? ""}`);
}

const DAY = 86_400_000;

function closes(h: Hackathon): string {
  const d = daysLeft(h) ?? 0;
  return d === 0 ? "Closes today" : d === 1 ? "Closes tomorrow" : `Closes in ${d} days`;
}

export function spotlights(items: Hackathon[], exclude: Set<string>, todayStart: number, now = Date.now()): Spotlight[] {
  const pool = items.filter((h) => !exclude.has(h.id) && h.status !== "ended");
  const used = new Set<string>();
  const out: Spotlight[] = [];
  const prize = (h: Hackathon) => h.prize_usd ?? -1;
  const within = (from: number, to: number) => (h: Hackathon) => {
    const d = daysLeft(h, now);
    return d !== null && d >= from && d <= to;
  };
  const pick = (s: Omit<Spotlight, "h" | "why">, list: Hackathon[], score: (h: Hackathon) => number, why: (h: Hackathon) => string | null) => {
    const h = list.filter((x) => !used.has(x.id)).sort((a, b) => score(b) - score(a))[0];
    if (!h) return;
    used.add(h.id);
    out.push({ ...s, h, why: why(h) });
  };

  pick({ key: "prize", label: "Biggest prize this week", icon: "trophy", tone: "var(--gold-fg)" }, pool.filter(within(0, 6)), prize, closes);
  pick(
    { key: "popular", label: "Most popular", icon: "users", tone: "var(--orange)" },
    pool.filter((h) => (h.registrations ?? 0) >= 100),
    (h) => h.registrations ?? 0,
    (h) => `${(h.registrations ?? 0).toLocaleString()} registered`,
  );
  pick(
    { key: "fresh", label: "Biggest new find", icon: "sparkle", tone: "var(--tint)" },
    pool.filter((h) => Date.parse(h.first_seen_at) >= todayStart - 2 * DAY),
    prize,
    (h) => {
      const seen = Date.parse(h.first_seen_at);
      return seen >= todayStart ? "Found today" : seen >= todayStart - DAY ? "Found yesterday" : `Found ${weekday(h.first_seen_at)}`;
    },
  );
  pick({ key: "last", label: "Last chance", icon: "clock", tone: "var(--red)" }, pool.filter(within(0, 2)), prize, closes);
  pick({ key: "women", label: "For women in tech", icon: "female", tone: "#D6336C" }, pool.filter(forWomen), prize, () => null);
  pick(
    { key: "anywhere", label: "Join from anywhere", icon: "globe", tone: "var(--green)" },
    pool.filter((h) => h.format === "online" && h.international_ok === true),
    prize,
    () => "Online and open worldwide",
  );
  pick(
    { key: "sprint", label: "Short sprint", icon: "lightning", tone: "#AF52DE" },
    pool.filter((h) => {
      if (!h.start_date || !h.end_date) return false;
      const start = Date.parse(h.start_date);
      return start > now && start - now < 21 * DAY && Date.parse(h.end_date) - start <= 3 * DAY;
    }),
    prize,
    (h) => `${durationDays(h.start_date, h.end_date) ?? "A few days"} · starts ${weekdayDate(h.start_date)}`,
  );
  return out;
}
