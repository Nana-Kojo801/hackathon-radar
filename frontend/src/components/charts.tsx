import { AnimatePresence, motion } from "framer-motion";
import { type PointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { bouncy, spring } from "../lib/motion";
import { cn } from "../lib/utils";

/**
 * Small hand-drawn charts for the stats page, in the app's own look: thin
 * marks with 4px rounded data-ends, hairline grids, the accent for "you" and a
 * recessive grey for comparisons, text in label colours (never the series
 * colour). Bars grow in when scrolled into view; tap or hover a mark to read
 * its exact value.
 */

// ---------------------------------------------------------------- helpers

function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** A round axis maximum: 1, 2, 2.5, 5 x 10^n. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p;
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

/** A bar with a rounded top (4px) and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Which mark is being inspected. Touch taps hold it for a moment; the mouse follows hover. */
function useInspect() {
  const [active, setActive] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const bind = (i: number) => ({
    onPointerEnter: (e: PointerEvent) => e.pointerType === "mouse" && setActive(i),
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      setActive(i);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setActive(null), 2600);
    },
  });
  const leave = { onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && setActive(null) };
  return { active, bind, leave };
}

function Tip({ show, x, children }: { show: boolean; x: number; children: ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.96 }}
          transition={spring}
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-[10px] bg-label px-2.5 py-1.5 text-center text-caption leading-tight font-semibold whitespace-nowrap text-bg shadow-lg"
          style={{ left: x }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5 text-footnote text-label-2">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- columns

export interface Series {
  name: string;
  color: string;
}

/**
 * Columns over time, one or more series side by side. A null value is a
 * period with no data yet (drawn as a faint stub, not as zero).
 */
export function Columns({
  data,
  series = [{ name: "", color: "var(--accent)" }],
  height = 132,
  format = compact,
  tip,
  xLabels = "ends",
}: {
  data: { label: string; values: (number | null)[] }[];
  series?: Series[];
  height?: number;
  format?: (n: number) => string;
  /** Tooltip heading for a column, e.g. "Week of 6 Oct". */
  tip?: (i: number) => string;
  xLabels?: "ends" | "all";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const { active, bind, leave } = useInspect();
  const axis = 30;
  const plotW = Math.max(0, width - axis);
  const top = 8;
  const plotH = height - top;
  // At least 0-1-2, so small counts get whole-number ticks.
  const max = niceMax(Math.max(2, ...data.flatMap((d) => d.values.map((v) => v ?? 0))));
  const band = data.length ? plotW / data.length : 0;
  const groupW = Math.min(band * 0.62, series.length * 24 + (series.length - 1) * 2);
  const barW = (groupW - (series.length - 1) * 2) / series.length;
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const showLabel = (i: number) => xLabels === "all" || i === 0 || i === data.length - 1 || i === Math.floor((data.length - 1) / 2);

  return (
    <div ref={ref} className="relative select-none" {...leave}>
      {width > 0 && (
        <svg width={width} height={height + 22} className="block overflow-visible" role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={plotW} y1={y(t)} y2={y(t)} stroke="var(--sep)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={width} y={y(t) + 4} textAnchor="end" className="fill-label-2 text-[11px] tabular">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = i * band + (band - groupW) / 2;
            return (
              <g key={d.label}>
                {d.values.map((v, s) =>
                  v == null ? (
                    <rect key={s} x={x0 + s * (barW + 2)} y={y(0) - 2} width={barW} height={2} rx={1} fill="var(--fill)" />
                  ) : (
                    <motion.path
                      key={s}
                      d={columnPath(x0 + s * (barW + 2), y(v), barW, y(0) - y(v))}
                      fill={series[s]?.color}
                      opacity={active == null || active === i ? 1 : 0.45}
                      initial={{ scaleY: 0 }}
                      whileInView={{ scaleY: 1 }}
                      viewport={{ once: true, margin: "-40px" }}
                      transition={{ ...bouncy, delay: i * 0.025 }}
                      style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
                    />
                  ),
                )}
                {showLabel(i) && (
                  <text x={x0 + groupW / 2} y={height + 16} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"} className="fill-label-2 text-[11px]">
                    {d.label}
                  </text>
                )}
                {/* Hit area: the whole band, taller than the mark. */}
                <rect x={i * band} y={0} width={band} height={height} fill="transparent" {...bind(i)} />
              </g>
            );
          })}
        </svg>
      )}
      <Tip show={active != null} x={active == null ? 0 : Math.min(Math.max(active * band + band / 2, 50), plotW - 40)}>
        {active != null && (
          <>
            <div className="font-normal opacity-70">{tip ? tip(active) : data[active].label}</div>
            {data[active].values.map((v, s) => (
              <div key={s}>
                {series.length > 1 ? `${series[s].name}: ` : ""}
                {v == null ? "No data yet" : format(v)}
              </div>
            ))}
          </>
        )}
      </Tip>
    </div>
  );
}

// ---------------------------------------------------------------- horizontal bars

/** A ranked list as bars, value at the tip. */
export function HBars({ rows, format = compact, color = "var(--accent)", labelWidth = 104 }: { rows: { label: string; value: number; color?: string }[]; format?: (n: number) => string; color?: string; labelWidth?: number }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={r.label} className="flex items-center gap-3">
          <span className="line-clamp-2 shrink-0 text-subhead leading-tight text-label" style={{ width: labelWidth }}>
            {r.label}
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <motion.div
              className="h-[10px] rounded-r-[4px]"
              style={{ background: r.color ?? color, width: `${Math.max(1.5, (r.value / max) * 100)}%`, transformOrigin: "left" }}
              initial={{ scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ ...bouncy, delay: i * 0.04 }}
            />
            <span className="shrink-0 text-footnote font-semibold text-label-2 tabular">{format(r.value)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** You vs everyone: each row's share in two thin bars. */
export function PairBars({ rows, a, b, labelWidth = 104 }: { rows: { label: string; a: number; b: number }[]; a: Series; b: Series; labelWidth?: number }) {
  const max = Math.max(0.01, ...rows.flatMap((r) => [r.a, r.b]));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div>
      <Legend items={[{ label: a.name, color: a.color }, { label: b.name, color: b.color }]} className="mb-3" />
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="line-clamp-2 shrink-0 text-subhead leading-tight text-label" style={{ width: labelWidth }}>
              {r.label}
            </span>
            <div className="min-w-0 flex-1 space-y-[3px]">
              {[
                [r.a, a.color],
                [r.b, b.color],
              ].map(([v, c], k) => (
                <div key={k} className="flex items-center gap-2">
                  <motion.div
                    className="h-[7px] rounded-r-[4px]"
                    style={{ background: c as string, width: (v as number) > 0 ? `${Math.max(1.5, ((v as number) / max) * 100)}%` : 0, transformOrigin: "left" }}
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, margin: "-30px" }}
                    transition={{ ...bouncy, delay: i * 0.04 + k * 0.03 }}
                  />
                  <span className={cn("shrink-0 text-caption tabular", k === 0 ? "font-semibold text-label" : "text-label-2")}>{pct(v as number)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Parts of a whole in one bar, 2px gaps between parts, with a legend that carries the numbers. */
export function StackBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <motion.div
        className="flex h-[14px] gap-[2px] overflow-hidden rounded-[5px]"
        initial={{ clipPath: "inset(0 100% 0 0)" }}
        whileInView={{ clipPath: "inset(0 0% 0 0)" }}
        viewport={{ once: true, margin: "-30px" }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        {total === 0 ? <div className="flex-1 bg-fill" /> : shown.map((p) => <div key={p.label} style={{ flexGrow: p.value, background: p.color }} />)}
      </motion.div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate text-subhead">{p.label}</span>
            <span className="text-subhead font-semibold tabular">{total ? `${Math.round((p.value / total) * 100)}%` : "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ring

/** A share of a whole as a ring, the number in the middle. */
export function Ring({ value, total, size = 112, children }: { value: number; total: number; size?: number; children?: ReactNode }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const share = total ? value / total : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={stroke} />
        {share > 0 && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: share }}
            viewport={{ once: true }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- heat grids

/** One hue, light to dark: zero is the empty fill, the busiest cell the full accent. */
function heat(v: number, max: number): string {
  if (!v || !max) return "var(--fill)";
  const t = 0.22 + 0.78 * (v / max);
  return `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, var(--card-2))`;
}

export function HeatLegend() {
  return (
    <div className="flex items-center gap-1.5 text-caption text-label-2">
      Less
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="h-2.5 w-2.5 rounded-[3px]" style={{ background: heat(i, 4) }} />
      ))}
      More
    </div>
  );
}

/** Rows x columns of counts, e.g. weekday x time of day. */
export function HeatGrid({ grid, rows, cols, describe }: { grid: number[][]; rows: string[]; cols: string[]; describe: (r: number, c: number, v: number) => string }) {
  const max = Math.max(0, ...grid.flat());
  const [sel, setSel] = useState<[number, number] | null>(null);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `28px repeat(${cols.length}, minmax(0, 1fr))` }}>
        {grid.map((row, r) => (
          <div key={r} className="contents">
            <span className="self-center text-caption text-label-2">{rows[r]}</span>
            {row.map((v, c) => (
              <motion.button
                key={c}
                type="button"
                aria-label={describe(r, c, v)}
                onClick={() => setSel(sel && sel[0] === r && sel[1] === c ? null : [r, c])}
                className={cn("aspect-[1.35] rounded-[5px] outline-offset-1", sel && sel[0] === r && sel[1] === c && "outline-2 outline-label")}
                style={{ background: heat(v, max) }}
                initial={{ opacity: 0, scale: 0.6 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ ...bouncy, delay: (r + c) * 0.018 }}
              />
            ))}
          </div>
        ))}
        <span />
        {cols.map((c, i) => (
          <span key={i} className="text-center text-[10.5px] text-label-2">
            {c}
          </span>
        ))}
      </div>
      <div className="mt-3 flex min-h-[20px] items-center justify-between gap-3">
        <span className="truncate text-footnote font-medium">{sel ? describe(sel[0], sel[1], grid[sel[0]][sel[1]]) : <span className="text-label-2">Tap a square for details</span>}</span>
        <HeatLegend />
      </div>
    </div>
  );
}

/** The coming weeks as a calendar, each day shaded by a count (Monday first). */
export function CalendarHeat({ counts, weeks = 8, describe }: { counts: Record<string, number>; weeks?: number; describe: (date: Date, v: number) => string }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const max = Math.max(0, ...Object.values(counts));
  const [sel, setSel] = useState<Date | null>(null);
  return (
    <div>
      <div className="grid grid-flow-col gap-[3px]" style={{ gridTemplateRows: "auto repeat(7, minmax(0, 1fr))", gridTemplateColumns: `24px repeat(${weeks}, minmax(0, 1fr))` }}>
        <span />
        {["M", "", "W", "", "F", "", "S"].map((l, i) => (
          <span key={i} className="self-center text-caption text-label-2">
            {l}
          </span>
        ))}
        {Array.from({ length: weeks }, (_, w) => (
          <div key={w} className="contents">
            <span className="truncate text-center text-[10.5px] text-label-2">
              {days[w * 7].getDate() <= 7 || w === 0 ? days[w * 7].toLocaleDateString(undefined, { month: "short" }) : ""}
            </span>
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const past = d < today;
              const v = counts[key(d)] ?? 0;
              const on = sel?.getTime() === d.getTime();
              return (
                <motion.button
                  key={key(d)}
                  type="button"
                  disabled={past}
                  aria-label={describe(d, v)}
                  onClick={() => setSel(on ? null : d)}
                  className={cn("aspect-square rounded-[5px] outline-offset-1", past && "opacity-25", on && "outline-2 outline-label", d.getTime() === today.getTime() && !on && "outline-1 outline-label-2")}
                  style={{ background: past ? "var(--fill)" : heat(v, max) }}
                  initial={{ opacity: 0, scale: 0.6 }}
                  whileInView={{ opacity: past ? 0.25 : 1, scale: 1 }}
                  viewport={{ once: true, margin: "-30px" }}
                  transition={{ ...bouncy, delay: w * 0.03 }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex min-h-[20px] items-center justify-between gap-3">
        <span className="truncate text-footnote font-medium">{sel ? describe(sel, counts[key(sel)] ?? 0) : <span className="text-label-2">Tap a day for details</span>}</span>
        <HeatLegend />
      </div>
    </div>
  );
}
