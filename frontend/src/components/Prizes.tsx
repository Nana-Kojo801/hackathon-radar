import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useMemo, useState } from "react";

import type { Hackathon, Prize } from "../lib/api";
import { cleanText, compactMoney, money, prizeFull } from "../lib/format";
import { bouncy, rise, spring } from "../lib/motion";
import { cn } from "../lib/utils";
import { Icon } from "./Icon";

/**
 * The prize section, laid out from what the hackathon actually offers:
 * a podium when there are 1st/2nd/3rd places, a card per track when prizes
 * are grouped by track, and tiles for special awards. Prizes come from the
 * platform, or from the AI's reading of the description when it has none.
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

const MEDAL = [
  "",
  "bg-[linear-gradient(145deg,#FFE58A,#F5B700)] text-[#6B4A00]",
  "bg-[linear-gradient(145deg,#F1F1F4,#B8BAC2)] text-[#45464D]",
  "bg-[linear-gradient(145deg,#F6C9A6,#C77D45)] text-[#5A2F10]",
];
const PLACE = ["", "1st", "2nd", "3rd"];

function amount(p: PrizeItem): string {
  if (p.usd) return money(p.usd);
  return p.text ?? (p.perks.length ? "Prizes" : "TBA");
}

function Medal({ rank, size = 36 }: { rank: number | null; size?: number }) {
  if (!rank || rank > 3)
    return (
      <span className="flex shrink-0 items-center justify-center rounded-full bg-soft text-tint" style={{ width: size, height: size }}>
        {rank ? <span className="text-footnote font-bold">{rank}th</span> : <Icon name="trophy" size={size * 0.48} />}
      </span>
    );
  return (
    <span className={cn("flex shrink-0 items-center justify-center rounded-full font-extrabold shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_2px_6px_rgba(0,0,0,0.12)]", MEDAL[rank])} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {rank}
    </span>
  );
}

export function Prizes({ h, items }: { h: Hackathon; items: PrizeItem[] }) {
  const { podium, tracks, awards, total, top } = useMemo(() => {
    const ranked = items.filter((p) => p.rank);
    const byTrack = new Map<string, PrizeItem[]>();
    for (const p of ranked) {
      const k = p.track ?? "";
      byTrack.set(k, [...(byTrack.get(k) ?? []), p]);
    }
    const named = [...byTrack.entries()].filter(([k]) => k);
    const loose = byTrack.get("") ?? [];
    // One group of places, no tracks: a podium. Several tracks: a card each.
    const podium = loose.length >= 2 ? loose.sort((a, b) => a.rank! - b.rank!) : named.length === 1 && !loose.length ? named[0][1].sort((a, b) => a.rank! - b.rank!) : [];
    const tracks = (podium.length && named.length === 1 && !loose.length ? [] : named).map(([name, list]) => ({ name, list: list.sort((a, b) => a.rank! - b.rank!) }));
    const awards = [...items.filter((p) => !p.rank), ...(loose.length === 1 ? loose : [])];
    const sum = items.reduce((s, p) => s + (p.usd ?? 0) * (p.winners || 1), 0);
    const top = items.reduce((m, p) => Math.max(m, p.usd ?? 0), 0);
    return { podium, tracks, awards, total: sum, top };
  }, [items]);
  const [allAwards, setAllAwards] = useState(false);
  const shownAwards = allAwards ? awards : awards.slice(0, 6);
  const trackName = podium.length && podium[0].track ? podium[0].track : null;

  return (
    <section>
      <h2 className="mx-5 mt-8 mb-2.5 text-title2 font-bold tracking-[-0.022em]">Prizes</h2>

      <motion.div {...rise(0)} className="mx-4 overflow-hidden rounded-[22px] p-4 text-white" style={{ background: "linear-gradient(140deg, var(--accent-hi) 0%, var(--accent) 70%)" }}>
        <div className="text-footnote font-semibold tracking-[0.02em] uppercase opacity-80">Prize pool</div>
        <div className="mt-0.5 text-[calc(32px*var(--ts))] leading-tight font-bold tracking-[-0.03em] tabular">{h.prize_usd ? prizeFull(h) : total ? money(total) : "Prizes TBA"}</div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Pill>{items.length} {items.length === 1 ? "prize" : "prizes"}</Pill>
          {tracks.length > 1 && <Pill>{tracks.length} tracks</Pill>}
          {top > 0 && <Pill>Top prize {compactMoney(top)}</Pill>}
          {items.some((p) => p.winners > 1) && <Pill>{items.reduce((n, p) => n + p.winners, 0)} winners</Pill>}
        </div>
      </motion.div>

      {podium.length >= 2 && (
        <div className="card mx-4 mt-3 rounded-[22px] px-3 pt-4 pb-3">
          {trackName && <div className="mb-2 text-center text-footnote font-semibold text-label-2">{trackName}</div>}
          <div className="flex items-end justify-center gap-2">
            {[podium[1], podium[0], podium[2]].map((p, i) =>
              p ? (
                <motion.div
                  key={`${p.rank}-${i}`}
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...bouncy, delay: [0.08, 0, 0.16][i] }}
                  className="flex min-w-0 flex-1 flex-col items-center"
                >
                  <Medal rank={p.rank} size={p.rank === 1 ? 44 : 38} />
                  <div className="mt-1.5 max-w-full truncate text-callout font-bold tracking-[-0.02em] tabular">{amount(p)}</div>
                  {p.winners > 1 && <div className="text-caption text-label-2">× {p.winners} winners</div>}
                  <div
                    className={cn("mt-2 flex w-full items-start justify-center rounded-t-[14px] pt-2 text-footnote font-bold", p.rank === 1 ? "h-[84px] bg-soft text-ink" : p.rank === 2 ? "h-[62px] bg-fill text-label-2" : "h-[46px] bg-fill text-label-2")}
                  >
                    {PLACE[p.rank ?? 0] ?? `${p.rank}th`}
                  </div>
                </motion.div>
              ) : (
                <div key={i} className="flex-1" />
              ),
            )}
          </div>
          {podium.slice(3).length > 0 && (
            <div className="mt-2 space-y-1.5">
              {podium.slice(3).map((p, i) => (
                <div key={i} className="flex items-center gap-3 rounded-[12px] bg-card-2 px-3 py-2">
                  <Medal rank={p.rank} size={28} />
                  <span className="flex-1 text-subhead font-medium">{PLACE[p.rank ?? 0] || `${p.rank}th`} place</span>
                  <span className="text-subhead font-bold tabular">{amount(p)}</span>
                </div>
              ))}
            </div>
          )}
          {podium.some((p) => p.perks.length) && <Perks perks={[...new Set(podium.flatMap((p) => p.perks))]} />}
        </div>
      )}

      {tracks.length > 0 && (
        <div className="no-scrollbar snap-row mt-3 flex gap-3 overflow-x-auto px-4 pb-1">
          {tracks.map((t, i) => (
            <motion.div key={t.name} {...rise(i, 4)} className={cn("card shrink-0 rounded-[22px] p-4", tracks.length > 1 ? "w-[280px]" : "w-full")}>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-soft text-tint">
                  <Icon name="sparkle" size={15} filled />
                </span>
                <div className="min-w-0 flex-1 truncate text-callout font-semibold">{t.name}</div>
                <div className="text-footnote font-semibold text-label-2 tabular">{compactMoney(t.list.reduce((s, p) => s + (p.usd ?? 0) * p.winners, 0)) || ""}</div>
              </div>
              <div className="mt-3 space-y-2">
                {t.list.map((p, j) => (
                  <div key={j} className="flex items-center gap-3">
                    <Medal rank={p.rank} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-subhead font-medium">{PLACE[p.rank ?? 0] || `${p.rank}th`} place</div>
                      {p.perks.length > 0 && <div className="truncate text-caption text-label-2">+ {p.perks.join(" · ")}</div>}
                    </div>
                    <div className="text-callout font-bold tracking-[-0.02em] tabular">{amount(p)}</div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {awards.length > 0 && (
        <>
          {(podium.length > 0 || tracks.length > 0) && <h3 className="mx-5 mt-5 mb-2 text-callout font-semibold">Special awards</h3>}
          <div className={cn("mx-4 grid grid-cols-2 gap-2.5", !(podium.length || tracks.length) && "mt-3")}>
            <AnimatePresence initial={false}>
              {shownAwards.map((p, i) => (
                <motion.div
                  key={`${p.name}-${i}`}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ ...spring, delay: Math.min(i, 6) * 0.03 }}
                  className="card flex flex-col rounded-[20px] p-3.5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-soft text-tint">
                    <Icon name="trophy" size={18} />
                  </span>
                  <div className="mt-2.5 line-clamp-3 text-subhead leading-snug font-semibold">{p.name}</div>
                  <div className="mt-auto pt-2 text-body font-bold tracking-[-0.02em] tabular">{amount(p)}</div>
                  {(p.winners > 1 || p.perks.length > 0) && (
                    <div className="line-clamp-2 text-caption text-label-2">{[p.winners > 1 ? `${p.winners} winners, each` : null, ...p.perks].filter(Boolean).join(" · ")}</div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {awards.length > 6 && (
            <button type="button" onClick={() => setAllAwards((a) => !a)} className="mx-5 mt-2.5 text-subhead font-semibold text-tint">
              {allAwards ? "Show fewer" : `Show all ${awards.length} awards`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-white/20 px-2.5 py-1 text-caption font-semibold backdrop-blur-sm">{children}</span>;
}

function Perks({ perks }: { perks: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-1.5 border-t hairline pt-3">
      {perks.slice(0, 6).map((p) => (
        <span key={p} className="rounded-full bg-fill px-2.5 py-1 text-caption font-medium text-label-2">
          + {p}
        </span>
      ))}
    </div>
  );
}
