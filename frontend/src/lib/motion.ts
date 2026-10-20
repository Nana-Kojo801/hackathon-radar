import type { Transition } from "framer-motion";

/**
 * Springs for the whole app. Damping ratios sit between 0.65 and 1: quick to
 * respond, a small overshoot on the playful bits, and nothing that wobbles.
 */

/** Default for most movement: lively, settles with a barely visible overshoot (ζ ≈ 0.79). */
export const spring: Transition = { type: "spring", stiffness: 520, damping: 34, mass: 0.9 };

/** Selection indicators, toggles, tab pill: a visible little bounce (ζ ≈ 0.65). */
export const bouncy: Transition = { type: "spring", stiffness: 600, damping: 28, mass: 0.8 };

/** Pages pushing in and out: firm, no overshoot (ζ ≈ 1), like iOS navigation. */
export const pageSpring: Transition = { type: "spring", stiffness: 380, damping: 40, mass: 1 };

/** Sheets and menus rising into place (ζ ≈ 0.83). */
export const sheetSpring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 1 };

/** Press feedback for buttons, cards and rows. */
export const press = { scale: 0.97 };
export const pressSmall = { scale: 0.9 };

/** Staggered entrance for lists. */
export function rise(i: number, max = 8) {
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring, delay: Math.min(i, max) * 0.035 },
  } as const;
}
