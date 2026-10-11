import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

/** Animates from 0 to `value` after mount (and whenever value changes). */
function useEased(value: number, delay: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t = setTimeout(() => {
      raf = requestAnimationFrame(() => setV(value));
    }, delay);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [value, delay]);
  return v;
}

interface RingProps {
  /** 0..1 share of the ring to fill; null draws an empty track. */
  value: number | null;
  color: string;
  size: number;
  thickness: number;
  hole?: string;
  track?: string;
  delay?: number;
  children?: ReactNode;
  label?: string;
}

export function Ring({ value, color, size, thickness, hole = "#17181C", track = "#26282E", delay = 0, children, label }: RingProps) {
  const p = useEased(value == null ? 0 : value * 100, delay);
  const style = { width: size, height: size, "--c": color, "--track": track, "--p": p } as CSSProperties;
  return (
    <div className="ring relative shrink-0" style={style} role={label ? "img" : undefined} aria-label={label}>
      <div
        className="absolute flex flex-col items-center justify-center rounded-full text-center"
        style={{ inset: thickness, background: hole }}
      >
        {children}
      </div>
    </div>
  );
}

export interface Segment {
  color: string;
  share: number; // 0..1
}

/** A donut split into segments (prize breakdown), revealed with a sweep. */
export function SplitRing({ segments, size, thickness, hole, gap = 0.6 }: { segments: Segment[]; size: number; thickness: number; hole: string; gap?: number }) {
  const p = useEased(100, 120);
  let acc = 0;
  const stops = segments.map((s) => {
    const a = acc;
    const b = acc + s.share * 100;
    acc = b;
    const end = Math.max(a, b - gap);
    return `${s.color} ${a.toFixed(2)}% ${end.toFixed(2)}%, transparent ${end.toFixed(2)}% ${b.toFixed(2)}%`;
  });
  const style = { width: size, height: size, "--p": p, background: `conic-gradient(${stops.join(", ")})` } as CSSProperties;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="split-ring absolute inset-0" style={style} />
      <div className="absolute rounded-full" style={{ inset: thickness, background: hole }} />
    </div>
  );
}

/** Counts up to a number once, for big prize figures. */
export function CountUp({ value, format, duration = 900 }: { value: number; format: (n: number) => string; duration?: number }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setN(a + (value - a) * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(n)}</>;
}
