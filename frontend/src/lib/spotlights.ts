import type { IconName } from "../components/Icon";
import type { Hackathon } from "./api";
import { daysLeft, durationDays, weekday, weekdayDate } from "./format";

/**
 * Today's spotlight: one hackathon for each thing that makes one stand out (the biggest prize
 * closing this week, the most registrations, the best odds, one for students, a game jam, ...),
 * shown as a carousel. Each picks a different hackathon, and ones you've saved or hidden are left
 * out. The main ones always show; the rest take turns, a different mix each day, so the carousel
 * stays short and keeps changing.
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

/** How many cards at most: the main ones plus a rotating few. */
const MAX = 12;
const DAY = 86_400_000;

// Read from the hackathon's own words: no platform labels these.
const WOMEN_TITLE = /\b(women|woman|female|girls|womxn|ladies)\b/i;
const WOMEN_TEXT = /\b(women|female|girls|womxn)\b[\s-]*(only|in (tech|stem|computing|ai|engineering|data)|developers|founders|hackers|coders|builders|led)\b|\bfor (women|girls|females)\b/i;
const BEGINNER = /\bbeginners?\b|\bfirst[- ]time (hackers?|participants?|builders?)\b|\bno (prior )?(coding )?experience\b|\ball (skill )?levels\b|\bnewbies?\b|\bnewcomers?\b/i;
const CAREER = /\binternships?\b|\bjob offers?\b|\binterviews?\b|\bhiring\b|\brecruit(ment|ing|ers)\b|\bpre[- ]placement\b|\bPPOs?\b|\bfull[- ]time (roles?|offers?|positions?)\b|\bfellowships?\b/i;
const CTF = /\bCTF\b|capture the flag/i;
const BIG_TECH =
  /\b(google|microsoft|meta|amazon|aws|apple|openai|anthropic|nvidia|ibm|intel|oracle|salesforce|adobe|paypal|stripe|coinbase|github|cloudflare|samsung|qualcomm|hugging ?face|mistral|databricks|snowflake|mongodb|vercel|twilio|atlassian|shopify|spotify|uber|airbnb|netflix|linkedin|x\.ai|xai)\b/i;

export function forWomen(h: Hackathon): boolean {
  return WOMEN_TITLE.test(h.title) || WOMEN_TEXT.test(`${h.summary ?? ""} ${h.prize_notes ?? ""}`);
}

const text = (h: Hackathon) => `${h.title} ${h.summary ?? ""} ${h.prize_notes ?? ""}`;
const has = (h: Hackathon, c: string) => h.categories.includes(c);

function closes(h: Hackathon): string {
  const d = daysLeft(h) ?? 0;
  return d === 0 ? "Closes today" : d === 1 ? "Closes tomorrow" : `Closes in ${d} days`;
}

function money(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K` : `$${Math.round(n)}`;
}

/** Midnight starting the coming weekend (today, if it's already Saturday or Sunday) and the Monday after. */
function weekend(now: number): [number, number] {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 Sunday … 6 Saturday
  const start = new Date(d);
  if (day === 0) start.setDate(d.getDate() - 1);
  else if (day !== 6) start.setDate(d.getDate() + (6 - day));
  const end = new Date(start);
  end.setDate(start.getDate() + 2);
  return [start.getTime(), end.getTime()];
}

/** The same order all day, a different one tomorrow. */
function shuffled<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed % 2147483647 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 48271) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface Kind {
  key: string;
  label: string;
  icon: IconName;
  tone: string;
  /** Always shown (when there's one); otherwise it takes turns. */
  core?: boolean;
  match: (h: Hackathon) => boolean;
  /** Higher is better; the biggest prize by default. */
  score?: (h: Hackathon) => number;
  why?: (h: Hackathon) => string | null;
}

export function spotlights(items: Hackathon[], exclude: Set<string>, todayStart: number, now = Date.now()): Spotlight[] {
  // Not ones that have closed since the last refresh marked them.
  const pool = items.filter((h) => !exclude.has(h.id) && h.status !== "ended" && (daysLeft(h, now) ?? 0) >= 0);
  const within = (from: number, to: number) => (h: Hackathon) => {
    const d = daysLeft(h, now);
    return d !== null && d >= from && d <= to;
  };
  const span = (h: Hackathon) => (h.start_date && h.end_date ? Date.parse(h.end_date) - Date.parse(h.start_date) : null);
  const [satStart, monStart] = weekend(now);
  const place = (h: Hackathon) => h.location_text?.split(",").map((x) => x.trim()).filter(Boolean)[0] ?? null;

  const kinds: Kind[] = [
    { key: "prize", label: "Biggest prize this week", icon: "trophy", tone: "var(--gold-fg)", core: true, match: within(0, 6), why: closes },
    {
      key: "popular",
      label: "Most popular",
      icon: "users",
      tone: "var(--orange)",
      core: true,
      match: (h) => (h.registrations ?? 0) >= 100,
      score: (h) => h.registrations ?? 0,
      why: (h) => `${(h.registrations ?? 0).toLocaleString()} registered`,
    },
    {
      key: "fresh",
      label: "Biggest new find",
      icon: "sparkle",
      tone: "var(--tint)",
      core: true,
      match: (h) => Date.parse(h.first_seen_at) >= todayStart - 2 * DAY,
      why: (h) => {
        const seen = Date.parse(h.first_seen_at);
        return seen >= todayStart ? "Found today" : seen >= todayStart - DAY ? "Found yesterday" : `Found ${weekday(h.first_seen_at)}`;
      },
    },
    { key: "last", label: "Last chance", icon: "clock", tone: "var(--red)", core: true, match: within(0, 2), why: closes },
    { key: "women", label: "For women in tech", icon: "female", tone: "#D6336C", core: true, match: forWomen },
    {
      // Prize money per person registered: where a good result is most within reach.
      key: "odds",
      label: "Best odds",
      icon: "target",
      tone: "var(--green)",
      match: (h) => (h.registrations ?? 0) >= 10 && (h.prize_usd ?? 0) >= 500,
      score: (h) => (h.prize_usd ?? 0) / (h.registrations ?? 1),
      why: (h) => `${money((h.prize_usd ?? 0) / (h.registrations ?? 1))} in prizes per person registered`,
    },
    { key: "students", label: "For students", icon: "student", tone: "#5856D6", match: (h) => h.student_only === true, why: () => "Students only" },
    { key: "beginners", label: "Beginner friendly", icon: "plant", tone: "var(--green)", match: (h) => BEGINNER.test(text(h)) },
    {
      key: "bigtech",
      label: "Backed by big tech",
      icon: "buildings",
      tone: "#0A84FF",
      match: (h) => BIG_TECH.test(h.organizer ?? "") || BIG_TECH.test(h.title),
      why: (h) => (h.organizer ? `By ${h.organizer}` : null),
    },
    { key: "career", label: "Could lead to a job", icon: "briefcase", tone: "#8E5E3C", match: (h) => CAREER.test(text(h)), why: () => "Internships, interviews or job offers" },
    { key: "ai", label: "For AI builders", icon: "cpu", tone: "#7B3FFF", match: (h) => has(h, "AI/ML") },
    { key: "web3", label: "Web3 and crypto", icon: "cube", tone: "#E8A33D", match: (h) => has(h, "web3/blockchain") },
    { key: "climate", label: "Climate and impact", icon: "leaf", tone: "#1B9E5A", match: (h) => has(h, "climate") },
    { key: "health", label: "Health tech", icon: "heartbeat", tone: "#E5484D", match: (h) => has(h, "health") },
    { key: "games", label: "Game jam", icon: "game", tone: "#AF52DE", match: (h) => has(h, "gaming") },
    { key: "security", label: "Security and CTF", icon: "shield", tone: "#30A46C", match: (h) => has(h, "cybersecurity") || CTF.test(h.title) },
    { key: "hardware", label: "Hardware and robotics", icon: "robot", tone: "#6E56CF", match: (h) => has(h, "hardware/IoT") || has(h, "robotics") },
    { key: "fintech", label: "Fintech", icon: "chart", tone: "#12A594", match: (h) => has(h, "fintech") },
    { key: "education", label: "Edtech", icon: "news", tone: "#3E63DD", match: (h) => has(h, "education") },
    { key: "inperson", label: "Meet in person", icon: "pin", tone: "#F76B15", match: (h) => h.format === "in_person" && !!place(h), why: (h) => place(h) },
    { key: "anywhere", label: "Join from anywhere", icon: "globe", tone: "var(--green)", match: (h) => h.format === "online" && h.international_ok === true, why: () => "Online and open worldwide" },
    {
      key: "weekend",
      label: "This weekend",
      icon: "calendar",
      tone: "#0091FF",
      match: (h) => !!h.start_date && Date.parse(h.start_date) >= Math.max(satStart, now - DAY) && Date.parse(h.start_date) < monStart,
      why: (h) => `Starts ${weekdayDate(h.start_date)}`,
    },
    {
      key: "sprint",
      label: "Short sprint",
      icon: "lightning",
      tone: "#AF52DE",
      match: (h) => {
        const s = span(h);
        const start = h.start_date ? Date.parse(h.start_date) : 0;
        return s !== null && s <= 3 * DAY && start > now && start - now < 21 * DAY;
      },
      why: (h) => `${durationDays(h.start_date, h.end_date) ?? "A few days"} · starts ${weekdayDate(h.start_date)}`,
    },
    {
      key: "marathon",
      label: "Take your time",
      icon: "hourglass",
      tone: "#8E8E93",
      match: (h) => (span(h) ?? 0) >= 28 * DAY && (!h.end_date || Date.parse(h.end_date) > now + 14 * DAY),
      why: (h) => `${Math.round((span(h) ?? 0) / (7 * DAY))} weeks · ends ${weekdayDate(h.end_date)}`,
    },
  ];

  const core = kinds.filter((k) => k.core);
  const rest = shuffled(
    kinds.filter((k) => !k.core),
    Math.floor(todayStart / DAY),
  );

  const used = new Set<string>();
  const out: Spotlight[] = [];
  for (const k of [...core, ...rest]) {
    if (out.length >= MAX) break;
    const score = k.score ?? ((h: Hackathon) => h.prize_usd ?? -1);
    const h = pool.filter((x) => !used.has(x.id) && k.match(x)).sort((a, b) => score(b) - score(a))[0];
    if (!h) continue;
    used.add(h.id);
    out.push({ key: k.key, label: k.label, icon: k.icon, tone: k.tone, h, why: k.why ? k.why(h) : null });
  }
  return out;
}
