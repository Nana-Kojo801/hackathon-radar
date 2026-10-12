import type { HackathonDetail, Prize } from "./api";
import {
  categoryLabel,
  cleanText,
  dateRange,
  durationDays,
  FORMAT_LABEL,
  fullDate,
  money,
  prizeText,
  sourceName,
  timeUtc,
} from "./format";

/** Long enough for any real write-up; keeps the prompt (and an "Open in Claude" link) a sane size. */
const DESCRIPTION_LIMIT = 6000;

function prizeLine(p: Prize): string {
  const amount = p.amount_usd ? money(p.amount_usd) : p.amount_text;
  const winners = p.winners > 1 ? ` (${p.winners} winners)` : "";
  const perks = p.perks.length ? ` + ${p.perks.map(cleanText).join("; ")}` : "";
  return `- ${p.name}${amount ? `: ${amount}` : ""}${winners}${perks}`;
}

function eligibility(h: HackathonDetail): string[] {
  const out: string[] = [];
  if (h.international_ok === true) out.push("open internationally");
  if (h.international_ok === false) out.push("regional (check which countries can enter)");
  if (h.student_only === true) out.push("students only");
  if (h.student_only === false) out.push("not limited to students");
  return out;
}

/**
 * A self-contained brief for Claude: everything the app knows about the
 * hackathon (Claude often doesn't know small or new ones), then the ask.
 * Claude already knows the person it's talking to, so the prompt asks it to
 * tailor the ideas rather than describing them.
 */
export function ideasPrompt(h: HackathonDetail): string {
  const lines: string[] = [];
  lines.push(`I'm considering entering this hackathon. Using what you know about me (my skills, interests and the time I usually have), suggest projects I could build for it.`);
  lines.push("");
  lines.push("## The hackathon");
  lines.push(`Name: ${h.title}`);
  if (h.organizer) lines.push(`Organizer: ${h.organizer}`);
  lines.push(`Page: ${h.source_url} (listed on ${sourceName(h)})`);
  const dates = dateRange(h.start_date, h.end_date);
  if (dates) lines.push(`Dates: ${dates}${durationDays(h.start_date, h.end_date) ? ` (${durationDays(h.start_date, h.end_date)})` : ""}`);
  if (h.registration_deadline) lines.push(`Registration closes: ${fullDate(h.registration_deadline)}, ${timeUtc(h.registration_deadline)}`);
  const where = h.format === "online" ? "Online" : [FORMAT_LABEL[h.format], h.location_text].filter(Boolean).join(", ");
  lines.push(`Format: ${where}`);
  const elig = eligibility(h);
  if (elig.length) lines.push(`Eligibility: ${elig.join(", ")}`);
  if (h.categories.length) lines.push(`Themes: ${h.categories.map(categoryLabel).join(", ")}`);
  lines.push(`Prize pool: ${prizeText(h)}${h.prize_notes ? ` (${cleanText(h.prize_notes)})` : ""}`);
  if (h.prizes.length) {
    lines.push("Prizes:");
    lines.push(...h.prizes.map(prizeLine));
  }

  const paragraphs = (h.description ?? "").split(/\n\s*\n/).map(cleanText).filter(Boolean);
  let description = paragraphs.join("\n\n");
  if (description.length > DESCRIPTION_LIMIT) description = `${description.slice(0, DESCRIPTION_LIMIT).replace(/\s+\S*$/, "")} […]`;
  if (description || h.summary) {
    lines.push("");
    lines.push("## From the hackathon's page");
    lines.push(description || cleanText(h.summary));
  }

  lines.push("");
  lines.push("## What I'd like");
  lines.push("1. 5 to 7 project ideas that fit the themes and what the judges are likely to reward. For each: a one-line pitch, which prize(s) or tracks it targets, why it could stand out, and the core features for a convincing demo.");
  lines.push("2. The idea you'd pick for me, with a rough build plan that fits the time available.");
  lines.push("3. Anything in the rules, eligibility or submission requirements I should double-check on the hackathon's page before registering.");
  lines.push("If anything above is unclear or missing, say what to check on the page rather than guessing.");
  return lines.join("\n");
}

/** claude.ai prefills the message box from ?q= (undocumented, so the prompt is also copied first). */
export function claudeUrl(prompt: string): string {
  const url = `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
  // Very long links can be refused; then just open Claude and let the person paste.
  return url.length <= 12000 ? url : "https://claude.ai/new";
}
