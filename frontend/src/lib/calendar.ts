import type { Hackathon } from "./api";
import { prizeText } from "./format";

/**
 * Calendar entries for a hackathon: the registration deadline (a short timed
 * event, with a reminder a day before in the .ics file) and the event itself
 * (all-day, start to end). Google Calendar takes one event per link, so it gets
 * a link each; Apple Calendar and Outlook get one .ics file with both.
 */

export interface CalendarEvent {
  kind: "deadline" | "event";
  label: string;
  title: string;
  /** Timed events: exact UTC instants. All-day events: UTC calendar dates, end exclusive. */
  start: Date;
  end: Date;
  allDay: boolean;
  description: string;
}

const DAY = 86_400_000;

function utcDay(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function pageUrl(h: Pick<Hackathon, "id">): string {
  return `${window.location.origin}/h/${h.id}`;
}

export function calendarEvents(h: Hackathon): CalendarEvent[] {
  const lines = [h.summary, `Prize: ${prizeText(h)}`, `Details: ${pageUrl(h)}`, `Register: ${h.source_url}`].filter(Boolean);
  const description = lines.join("\n");
  const out: CalendarEvent[] = [];
  if (h.registration_deadline) {
    const end = new Date(h.registration_deadline);
    out.push({
      kind: "deadline",
      label: "Registration deadline",
      title: `Registration closes: ${h.title}`,
      start: new Date(end.getTime() - 30 * 60_000),
      end,
      allDay: false,
      description,
    });
  }
  if (h.start_date) {
    const start = utcDay(h.start_date);
    const last = utcDay(h.end_date ?? h.start_date);
    out.push({
      kind: "event",
      label: "Event dates",
      title: h.title,
      start,
      end: new Date(Math.max(last.getTime(), start.getTime()) + DAY),
      allDay: true,
      description,
    });
  }
  return out;
}

function stamp(d: Date, allDay: boolean): string {
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return allDay ? iso.slice(0, 8) : iso; // 20261024 or 20261024T235900Z
}

export function googleCalendarUrl(ev: CalendarEvent, location?: string | null): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${stamp(ev.start, ev.allDay)}/${stamp(ev.end, ev.allDay)}`,
    details: ev.description,
  });
  if (location) params.set("location", location);
  return `https://calendar.google.com/calendar/render?${params}`;
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 lines are at most 75 octets; longer ones continue on lines starting with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (bytes.encode(cur + ch).length > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function icsFile(h: Hackathon, events: CalendarEvent[]): string {
  const now = stamp(new Date(), false);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hackscout//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${h.id}-${ev.kind}@hackscout`,
      `DTSTAMP:${now}`,
      ev.allDay ? `DTSTART;VALUE=DATE:${stamp(ev.start, true)}` : `DTSTART:${stamp(ev.start, false)}`,
      ev.allDay ? `DTEND;VALUE=DATE:${stamp(ev.end, true)}` : `DTEND:${stamp(ev.end, false)}`,
      `SUMMARY:${escapeText(ev.title)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      `URL:${h.source_url}`,
    );
    if (h.location_text) lines.push(`LOCATION:${escapeText(h.location_text)}`);
    if (ev.kind === "deadline") {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(ev.title)}`, "TRIGGER:-P1D", "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadIcs(h: Hackathon, events: CalendarEvent[]): void {
  const blob = new Blob([icsFile(h, events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${h.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "hackathon"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
