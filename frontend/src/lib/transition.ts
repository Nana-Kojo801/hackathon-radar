/**
 * Springs as CSS easing curves. Animations that use these run on the browser's
 * compositor (CSS transitions and element.animate), so they stay smooth even
 * while the page is busy rendering, which JS-driven animation can't promise.
 * The curves are sampled from the same springs as lib/motion.ts.
 */

const CURVES = {
  /** k=380, c=40, m=1: page pushes; firm, no overshoot. */
  page: {
    ms: 545,
    linear:
      "linear(0, 0.0256, 0.0841, 0.1534, 0.2296, 0.3142, 0.3895, 0.4606, 0.5319, 0.5911, 0.6443, 0.6957, 0.737, 0.7733, 0.8077, 0.8349, 0.8585, 0.8806, 0.8979, 0.9128, 0.9267, 0.9375, 0.9468, 0.9553, 0.962, 0.9677, 0.9729, 0.977, 0.9805, 0.9836, 0.9861, 0.9882, 0.9901, 0.9916, 0.9929, 0.9941, 0.995, 0.9957, 0.9964, 0.997, 0.9974, 0.9979, 0.9982, 0.9985, 0.9987, 0.9989, 0.9991, 0.9992, 1)",
    fallback: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
  /** k=640, c=50, m=1: switching tabs; quick and firm, no overshoot. */
  tab: {
    ms: 380,
    linear:
      "linear(0, 0.0302, 0.0979, 0.1845, 0.278, 0.3708, 0.4586, 0.5388, 0.6104, 0.6731, 0.7274, 0.7738, 0.8132, 0.8463, 0.8739, 0.897, 0.916, 0.9317, 0.9446, 0.9551, 0.9637, 0.9707, 0.9764, 0.981, 0.9848, 0.9878, 0.9902, 0.9922, 0.9937, 0.995, 0.996, 0.9968, 0.9975, 0.998, 0.9984, 0.9987, 0.999, 0.9992, 0.9994, 1)",
    fallback: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
  /** k=600, c=28, m=0.8: menus and selection pills; a small bounce. */
  pop: {
    ms: 422,
    linear:
      "linear(0, 0.037, 0.1139, 0.2042, 0.3189, 0.4379, 0.5539, 0.6502, 0.7475, 0.8315, 0.9012, 0.9515, 0.9957, 1.028, 1.0499, 1.0632, 1.0692, 1.0706, 1.068, 1.0624, 1.056, 1.0479, 1.0395, 1.0313, 1.0237, 1.0177, 1.0118, 1.0068, 1.0029, 1.0002, 0.998, 0.9964, 0.9955, 0.9951, 0.995, 0.9952, 0.9956, 0.9961, 0.9966, 0.9972, 0.9978, 0.9983, 0.9988, 0.9992, 0.9995, 0.9998, 1, 1.0001, 1)",
    fallback: "cubic-bezier(0.34, 1.4, 0.64, 1)",
  },
  /** k=420, c=34, m=1: sheets; settles with a hint of overshoot. */
  sheet: {
    ms: 467,
    linear:
      "linear(0, 0.0247, 0.0708, 0.1396, 0.2193, 0.3037, 0.3802, 0.4626, 0.5403, 0.6049, 0.6702, 0.7283, 0.7791, 0.819, 0.8571, 0.8892, 0.9134, 0.9358, 0.9539, 0.9671, 0.9788, 0.9878, 0.9946, 0.9992, 1.0029, 1.0054, 1.0069, 1.0078, 1.0082, 1.0082, 1.0079, 1.0074, 1.0068, 1.0062, 1.0055, 1.0048, 1.0041, 1.0036, 1.003, 1.0025, 1.0021, 1.0017, 1.0013, 1.0011, 1.0008, 1.0006, 1.0005, 1.0003, 1)",
    fallback: "cubic-bezier(0.32, 0.72, 0, 1)",
  },
} as const;

export type Curve = keyof typeof CURVES;

const linearOk = typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)");

export function easing(c: Curve): string {
  return linearOk ? CURVES[c].linear : CURVES[c].fallback;
}

export function duration(c: Curve): number {
  return reducedMotion() ? 0 : CURVES[c].ms;
}

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The element's current horizontal (or vertical) offset, mid-animation included. */
export function currentOffset(el: HTMLElement, axis: "x" | "y" = "x"): number {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  const m = new DOMMatrixReadOnly(t);
  return axis === "x" ? m.m41 : m.m42;
}

/** Move an element between two translations with a spring curve, ending on `to`. */
export function slide(el: HTMLElement, axis: "x" | "y", from: number, to: number, curve: Curve, done?: () => void): Animation | null {
  const prop = (v: number) => (axis === "x" ? `translate3d(${v}px,0,0)` : `translate3d(0,${v}px,0)`);
  el.getAnimations().forEach((a) => a.cancel());
  el.style.transform = prop(to);
  const ms = duration(curve);
  if (!ms || from === to) {
    done?.();
    return null;
  }
  const anim = el.animate([{ transform: prop(from) }, { transform: prop(to) }], { duration: ms, easing: easing(curve) });
  anim.onfinish = () => done?.();
  return anim;
}

export function fade(el: HTMLElement, from: number, to: number, curve: Curve): void {
  el.getAnimations().forEach((a) => a.cancel());
  el.style.opacity = String(to);
  const ms = duration(curve);
  if (ms && from !== to) el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: "ease-out" });
}
