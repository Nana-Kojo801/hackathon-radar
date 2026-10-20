import { animate, type MotionValue, type ValueAnimationTransition } from "framer-motion";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * A one-axis drag that moves a motion value with the finger, then either
 * commits (past `distance`, or flicked faster than `speed` px/ms) or springs
 * back to 0. Pointer capture keeps it going when the finger leaves the handle.
 */
export function dragHandle(
  value: MotionValue<number>,
  opts: { axis: "x" | "y"; distance: () => number; speed?: number; spring: ValueAnimationTransition; onCommit: () => void; resist?: number },
) {
  return (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const start = opts.axis === "x" ? e.clientX : e.clientY;
    let last = start;
    let lastT = performance.now();
    let velocity = 0;
    const move = (ev: PointerEvent) => {
      const p = opts.axis === "x" ? ev.clientX : ev.clientY;
      const now = performance.now();
      velocity = (p - last) / Math.max(1, now - lastT);
      last = p;
      lastT = now;
      const d = p - start;
      // Following the finger forwards; a little resistance the wrong way.
      value.set(d >= 0 ? d : d * (opts.resist ?? 0.05));
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      if (value.get() > opts.distance() || velocity > (opts.speed ?? 0.6)) opts.onCommit();
      else animate(value, 0, opts.spring);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
}
