import type { ReactNode } from "react";

import type { Hackathon } from "./api";
import { countdown, dateRange, FORMAT_LABEL, hostOf, isNew, prizeLabel } from "./format";

const TONE: Record<string, string> = {
  urgent: "text-rose-600 dark:text-rose-400 font-semibold",
  soon: "text-amber-700 dark:text-amber-300 font-medium",
  normal: "text-stone-600 dark:text-stone-300",
  muted: "text-stone-400 dark:text-stone-500",
};

const FORMAT_STYLE: Record<string, string> = {
  online: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  in_person: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  hybrid: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
  unknown: "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
};

export function Badge({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${className}`}>
      {children}
    </span>
  );
}

export function RegisterLink({ url, compact = false }: { url: string; compact?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-[0.98] ${
        compact ? "px-2 py-1 text-[11px] whitespace-nowrap" : "px-3.5 py-2 text-sm"
      }`}
    >
      Register →
    </a>
  );
}

export function HackathonCard({ h, firstRunAt }: { h: Hackathon; firstRunAt: string | null }) {
  const prize = prizeLabel(h);
  const cd = countdown(h);
  const dates = dateRange(h);
  const fresh = isNew(h, firstRunAt);

  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-sm dark:border-stone-800 dark:bg-stone-900/60">
      <div className="flex items-start gap-3">
        <div className="min-w-[4.75rem] text-left">
          <div
            className={`font-mono text-2xl leading-none font-bold tracking-tight ${
              prize.known ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400 dark:text-stone-500 text-lg"
            }`}
            title={h.prize_text || undefined}
          >
            {prize.main}
          </div>
          {prize.sub && (
            <div className="mt-1 line-clamp-2 text-[10px] leading-tight text-stone-500 dark:text-stone-400">
              {prize.sub}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <h2 className="line-clamp-2 text-[15px] leading-snug font-semibold">
              <a href={h.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {h.title}
              </a>
            </h2>
            {fresh && <Badge className="mt-0.5 bg-amber-400 text-amber-950">NEW</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
            {[h.organizer, h.location_text, hostOf(h.source_url)].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      {h.summary && <p className="line-clamp-2 text-[13px] leading-snug text-stone-700 dark:text-stone-300">{h.summary}</p>}

      <div className="flex flex-wrap items-center gap-1">
        <Badge className={FORMAT_STYLE[h.format]}>{FORMAT_LABEL[h.format]}</Badge>
        {h.status === "upcoming" && (
          <Badge className="bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300">Upcoming</Badge>
        )}
        {h.international_ok === true && (
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">🌍 Intl OK</Badge>
        )}
        {h.international_ok === false && (
          <Badge className="bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">Region-locked</Badge>
        )}
        {h.student_only && (
          <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300">Students</Badge>
        )}
        {h.categories.map((c) => (
          <Badge key={c} className="border border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300">
            {c}
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2 dark:border-stone-800">
        <div className="min-w-0 text-xs leading-tight">
          {cd && <div className={TONE[cd.tone]}>{cd.label}</div>}
          <div className="truncate text-stone-500 dark:text-stone-400">
            {dates ?? "Dates TBA"}
            <span className="ml-1.5 text-stone-400 dark:text-stone-500">via {h.source}</span>
          </div>
        </div>
        <RegisterLink url={h.source_url} />
      </div>
    </article>
  );
}

export function HackathonTable({ items, firstRunAt }: { items: Hackathon[]; firstRunAt: string | null }) {
  return (
    <div className="overflow-hidden rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900/60">
      <table className="w-full table-fixed text-left text-xs">
        <thead className="bg-stone-50 text-[10px] tracking-wide text-stone-500 uppercase dark:bg-stone-900 dark:text-stone-400">
          <tr>
            <th className="w-[4.75rem] px-2 py-1.5">Prize</th>
            <th className="px-2 py-1.5">Hackathon</th>
            <th className="hidden w-24 px-2 py-1.5 sm:table-cell">Format</th>
            <th className="w-[4.25rem] px-2 py-1.5">Closes</th>
            <th className="hidden w-48 px-2 py-1.5 md:table-cell">Categories</th>
            <th className="w-[5.5rem] px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
          {items.map((h) => {
            const prize = prizeLabel(h);
            const cd = countdown(h);
            return (
              <tr key={h.id} className="align-middle">
                <td
                  className={`px-2 py-1.5 font-mono text-sm font-bold ${
                    prize.known ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400"
                  }`}
                  title={h.prize_text || undefined}
                >
                  {prize.main}
                </td>
                <td className="px-2 py-1.5">
                  <div className="line-clamp-2 leading-snug font-medium">
                    <a href={h.source_url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {h.title}
                    </a>
                    {isNew(h, firstRunAt) && <Badge className="ml-1 bg-amber-400 text-amber-950">NEW</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-stone-500 dark:text-stone-400">
                    {[FORMAT_LABEL[h.format], h.location_text !== FORMAT_LABEL[h.format] ? h.location_text : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </td>
                <td className="hidden px-2 py-1.5 sm:table-cell">{FORMAT_LABEL[h.format]}</td>
                <td className={`px-2 py-1.5 text-[11px] leading-tight ${cd ? TONE[cd.tone] : "text-stone-400"}`}>
                  {cd ? shortCountdown(cd.label) : "TBA"}
                </td>
                <td className="hidden truncate px-2 py-1.5 text-stone-500 md:table-cell">{h.categories.join(", ")}</td>
                <td className="px-2 py-1.5 text-right">
                  <RegisterLink url={h.source_url} compact />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function shortCountdown(label: string): string {
  return label
    .replace(/^Closes in /, "")
    .replace(/^(Starts|Ends) in /, (_, v: string) => `${v.toLowerCase()} `)
    .replace(/(\d+d) \d+h/, "$1");
}
