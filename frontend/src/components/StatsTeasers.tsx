import { motion } from "framer-motion";
import { useEffect } from "react";

import { bouncy, press, rise } from "../lib/motion";
import { usePersonal } from "../lib/personal";
import { linkTo } from "../lib/router";
import { useMyStats } from "../lib/stats";
import { Icon } from "./Icon";

/**
 * The ways into the stats page: a card in Settings and "Your week" on Today.
 * Kept apart from the page itself, which loads on demand with its charts.
 */

/** Fetch the stats page's code ahead of a tap, so it slides in ready. */
function usePreload() {
  useEffect(() => {
    const t = window.setTimeout(() => void import("../pages/Stats"), 1500);
    return () => window.clearTimeout(t);
  }, []);
}

/** Tiny columns for a teaser: the last few weeks of opens. */
function MiniBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <span className="flex h-7 items-end gap-[3px]" aria-hidden="true">
      {values.map((v, i) => (
        <motion.span
          key={i}
          className="w-[5px] rounded-t-[2px]"
          style={{ height: `${Math.max(8, (v / max) * 100)}%`, background: i === values.length - 1 ? "var(--accent)" : "color-mix(in srgb, var(--accent) 38%, var(--card-2))", transformOrigin: "bottom" }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 22, delay: i * 0.03 }}
        />
      ))}
    </span>
  );
}

const statsGradient = "linear-gradient(140deg, var(--accent-hi) 0%, var(--accent) 72%)";

/** The way in from Settings, near the top like an account card. */
export function StatsCard() {
  const p = usePersonal();
  const me = useMyStats();
  usePreload();
  const s = p.key ? me.data : null;
  const weeks = s?.activity.per_week.slice(-8).map((w) => w.count ?? 0) ?? [];
  const summary = s
    ? `${s.funnel.registered} registered · ${s.funnel.won} won`
    : p.key
      ? "Your funnel, habits and activity"
      : "Market trends, and yours once connected";
  return (
    <motion.a href="/settings/stats" onClick={linkTo("/settings/stats")} whileTap={press} {...rise(1)} className="card mx-4 mt-3 flex items-center gap-3.5 rounded-[22px] p-3.5">
      <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[13px] text-on-accent" style={{ background: statsGradient }}>
        <Icon name="chart" size={24} stroke={2.5} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold tracking-[-0.02em]">Your stats</span>
        <span className="block truncate text-footnote text-label-2">{summary}</span>
      </span>
      {weeks.some((v) => v > 0) && <MiniBars values={weeks} />}
      <Icon name="chevron" size={14} className="shrink-0 text-label-3" />
    </motion.a>
  );
}

/** "Your week" on Today, for a connected device with some activity. */
export function WeekRecap() {
  const p = usePersonal();
  const me = useMyStats();
  usePreload();
  const s = p.key ? me.data : null;
  if (!s || !s.activity.since) return null;
  const r = s.recap;
  const weeks = s.activity.per_week.slice(-8).map((w) => w.count ?? 0);
  const figures: [number, string][] = [
    [r.opens, r.opens === 1 ? "visit" : "visits"],
    [r.views, "viewed"],
    [r.saved, "saved"],
    [r.registered, "registered"],
  ];
  return (
    <motion.a href="/settings/stats" onClick={linkTo("/settings/stats")} whileTap={press} transition={bouncy} className="card mx-4 mt-8 block rounded-[22px] p-4">
      <span className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-[9px] text-on-accent" style={{ background: statsGradient }}>
          <Icon name="chart" size={18} stroke={2.5} />
        </span>
        <span className="flex-1 text-headline font-semibold tracking-[-0.02em]">Your week</span>
        <span className="flex items-center gap-1 text-subhead font-medium text-tint">
          Stats <Icon name="chevron" size={12} />
        </span>
      </span>
      <span className="mt-3.5 flex items-end gap-3">
        <span className="grid min-w-0 flex-1 grid-cols-4 gap-2">
          {figures.map(([n, label]) => (
            <span key={label} className="min-w-0">
              <span className="block text-title2 font-bold tracking-[-0.025em] tabular">{n}</span>
              <span className="block truncate text-caption text-label-2">{label}</span>
            </span>
          ))}
        </span>
        <MiniBars values={weeks} />
      </span>
    </motion.a>
  );
}
