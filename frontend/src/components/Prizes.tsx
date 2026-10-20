import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import type { Hackathon, Prize } from "../lib/api";
import { cleanText, compactMoney, money, prizeFull } from "../lib/format";
import { rise } from "../lib/motion";
import { cn } from "../lib/utils";
import { Icon } from "./Icon";

/**
 * The prize section, laid out from what the hackathon actually offers: the
 * pool, how it splits between main places, tracks and special awards (a bar
 * whose colours match the group tabs), then each group's places. Prizes come
 * from the platform, or from the AI's reading of the description.
 */

export interface PrizeItem {
  name: string;
  track: string | null;
  rank: number | null;
  usd: number | null;
  text: string | null;
  winners: number;
  perks: string[];
}

const ORDINAL = "(1st|2nd|3rd|[4-9]th|first|second|third|fourth|fifth)";
const RANK_WORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };

function rankOf(word: string): number {
  const w = word.toLowerCase();
  return RANK_WORD[w] ?? parseInt(w, 10);
}

/** Read the track and place out of a platform prize name ("Fire TV Track - 1st Place"). */
export function fromPlatform(p: Prize & { track?: string | null; rank?: number | null }): PrizeItem {
  let name = cleanText(p.name);
  let track: string | null = p.track ?? null;
  let rank: number | null = p.rank ?? null;
  const suffix = name.match(new RegExp(`^(.*?)\\s*[-–—:|,]\\s*${ORDINAL}\\s*(place|prize|winner)?$`, "i"));
  const prefix = name.match(new RegExp(`^${ORDINAL}\\s*(place|prize)?\\s*[-–—:|,]?\\s*(.*)$`, "i"));
  if (rank === null && suffix) {
    rank = rankOf(suffix[2]);
    track = track ?? (suffix[1].trim() || null);
  } else if (rank === null && prefix) {
    rank = rankOf(prefix[1]);
    track = track ?? (prefix[3].trim() || null);
  } else if (rank === null && /grand prize|overall winner|^winner$/i.test(name)) rank = 1;
  else if (rank === null && /runner[- ]?up/i.test(name)) rank = 2;
  if (track) track = track.replace(/\s+track$/i, "").trim() || null;
  if (rank && track) name = track;
  return { name, track, rank, usd: p.amount_usd ?? null, text: p.amount_text ?? null, winners: p.winners || 1, perks: (p.perks ?? []).map(cleanText).filter(Boolean) };
}

const PLACE = ["", "1st", "2nd", "3rd"];
const place = (r: number) => PLACE[r] ?? `${r}th`;
const METAL = ["", "gold", "silver", "bronze"];

function amount(p: PrizeItem): string {
  if (p.usd) return money(p.usd);
  return p.text ?? (p.perks.length ? "Prizes" : "TBA");
}

const value = (p: PrizeItem) => (p.usd ?? 0) * (p.winners || 1);

interface Group {
  key: string;
  name: string;
  list: PrizeItem[];
  total: number;
}

/** Sorts prizes into what the hackathon actually has: main places, one group per track, special awards. */
function groupPrizes(items: PrizeItem[]): Group[] {
  const groups: Group[] = [];
  const add = (key: string, name: string, list: PrizeItem[]) => list.length && groups.push({ key, name, list, total: list.reduce((n, p) => n + value(p), 0) });
  const ranked = items.filter((p) => p.rank).sort((a, b) => a.rank! - b.rank!);
  add("main", "Main prizes", ranked.filter((p) => !p.track));
  const tracks = [...new Set(ranked.map((p) => p.track).filter(Boolean))] as string[];
  for (const t of tracks) add(`t:${t}`, t, ranked.filter((p) => p.track === t));
  add("awards", groups.length ? "Special awards" : "Awards", items.filter((p) => !p.rank));
  return groups;
}

/** Groups get steps of the accent, strongest first (an ordered scale, so no rainbow). */
function shade(i: number): string {
  const steps = [100, 68, 46, 32, 22];
  return `color-mix(in srgb, var(--accent) ${steps[Math.min(i, steps.length - 1)]}%, var(--card-2))`;
}

const SHOWN = 5;

export function Prizes({ h, items }: { h: Hackathon; items: PrizeItem[] }) {
  const groups = useMemo(() => groupPrizes(items), [items]);
  const [active, setActive] = useState(groups[0]?.key);
  const [all, setAll] = useState(false);
  const group = groups.find((g) => g.key === active) ?? groups[0];
  const total = groups.reduce((n, g) => n + g.total, 0);
  const winners = items.reduce((n, p) => n + (p.winners || 1), 0);
  const tracks = groups.filter((g) => g.key.startsWith("t:")).length;
  const perks = [...new Set(items.flatMap((p) => p.perks))];
  const pool = h.prize_usd ? prizeFull(h) : total ? money(total) : "Prizes TBA";
  const summary = [`${items.length} ${items.length === 1 ? "prize" : "prizes"}`, winners > items.length ? `${winners} winners` : null, tracks > 1 ? `${tracks} tracks` : null].filter(Boolean).join(" · ");
  const rows = all ? group.list : group.list.slice(0, SHOWN);
  const split = groups.length > 1 && total > 0;

  return (
    <section>
      <h2 className="mx-5 mt-8 mb-2.5 text-title2 font-bold tracking-[-0.022em]">Prizes</h2>
      <motion.div {...rise(0)} className="card mx-4 overflow-hidden rounded-[22px]">
        <div className="flex items-start gap-3 px-4 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-footnote font-medium text-label-2">Prize pool</div>
            <div className="mt-0.5 text-[calc(34px*var(--ts))] leading-[1.1] font-bold tracking-[-0.035em] tabular">{pool}</div>
            <div className="mt-1 text-footnote text-label-2">{summary}</div>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-[var(--gold-bg)] text-[var(--gold-fg)] shadow-[inset_0_0_0_1px_var(--gold-ring)]">
            <Icon name="trophy" size={22} />
          </span>
        </div>

        {split && (
          <motion.div
            className="mx-4 mt-4 flex h-2 gap-[2px] overflow-hidden rounded-full"
            initial={{ clipPath: "inset(0 100% 0 0 round 99px)" }}
            whileInView={{ clipPath: "inset(0 0% 0 0 round 99px)" }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            aria-hidden="true"
          >
            {groups.map((g, i) => g.total > 0 && <div key={g.key} style={{ flexGrow: g.total, background: shade(i) }} />)}
          </motion.div>
        )}

        {groups.length > 1 && (
          <div role="tablist" aria-label="Prize groups" className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-4">
            {groups.map((g, i) => {
              const on = g.key === group.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={(e) => {
                    setActive(g.key);
                    setAll(false);
                    e.currentTarget.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
                  }}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-footnote font-semibold whitespace-nowrap transition-colors",
                    on ? "bg-label text-bg" : "bg-fill text-label",
                  )}
                >
                  {split && <span className="h-2 w-2 rounded-full" style={{ background: shade(i) }} />}
                  {g.name}
                  {g.total > 0 && <span className={cn("font-medium tabular", on ? "opacity-70" : "text-label-2")}>{compactMoney(g.total)}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2">
          {/* A new group just slides in (CSS, index.css .prize-list). No exit animation: the old list
              being lifted out of the layout while it faded made Safari flicker at the end. */}
          <ul key={group.key} className="prize-list">
            {rows.map((p, i) => (
              <PrizeRow key={`${p.name}-${p.rank}-${i}`} p={p} lead={i === 0 && p.rank === 1} first={i === 0} />
            ))}
          </ul>
          {group.list.length > SHOWN && (
            <button type="button" onClick={() => setAll((a) => !a)} className="flex h-11 w-full items-center gap-1 border-t hairline px-4 text-subhead font-semibold text-tint">
              {all ? "Show fewer" : `Show all ${group.list.length}`}
              <Icon name="chevronDown" size={14} className={cn("transition-transform", all && "rotate-180")} />
            </button>
          )}
        </div>

        {perks.length > 0 && (
          <div className="flex items-start gap-2.5 border-t hairline px-4 py-3">
            <Icon name="gift" size={18} className="mt-px shrink-0 text-tint" />
            <p className="text-footnote leading-snug text-label-2">
              <span className="font-semibold text-label">Also: </span>
              {perks.slice(0, 6).join(" · ")}
            </p>
          </div>
        )}
      </motion.div>
    </section>
  );
}

function Badge({ p }: { p: PrizeItem }) {
  const metal = p.rank ? METAL[p.rank] : null;
  if (metal)
    return (
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-subhead font-bold tabular"
        style={{ background: `var(--${metal}-bg)`, color: `var(--${metal}-fg)`, boxShadow: `inset 0 0 0 1px var(--${metal}-ring)` }}
      >
        {p.rank}
      </span>
    );
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill text-label-2">
      {p.rank ? <span className="text-footnote font-bold tabular">{p.rank}</span> : <Icon name={p.usd ? "trophy" : "gift"} size={17} />}
    </span>
  );
}

function PrizeRow({ p, lead, first }: { p: PrizeItem; lead: boolean; first: boolean }) {
  // "1st place" for plain places and track places; named ones ("Grand Prize", "Runner-up") keep their name.
  const title = !p.rank ? p.name : p.track || new RegExp(`^${ORDINAL}`, "i").test(p.name) ? `${place(p.rank)} place` : p.name;
  const sub = [p.winners > 1 ? `${p.winners} winners${p.usd ? `, ${compactMoney(p.usd)} each` : ""}` : null, ...p.perks].filter(Boolean).join(" · ");
  return (
    <li className="relative flex items-center gap-3 px-4 py-2.5">
      {/* Inset separator, starting after the badge like an iOS list. */}
      {!first && <span aria-hidden="true" className="absolute top-0 right-0 left-[64px] h-px bg-[var(--sep)]" />}
      <Badge p={p} />
      <div className="min-w-0 flex-1">
        <div className={cn("leading-snug", lead ? "text-callout font-semibold" : "text-subhead font-medium")}>{title}</div>
        {sub && <div className="line-clamp-2 text-caption text-label-2">{sub}</div>}
      </div>
      <div className={cn("shrink-0 text-right font-bold tracking-[-0.02em] tabular", lead ? "text-title3" : "text-callout")}>{p.winners > 1 && p.usd ? compactMoney(value(p)) : amount(p)}</div>
    </li>
  );
}
