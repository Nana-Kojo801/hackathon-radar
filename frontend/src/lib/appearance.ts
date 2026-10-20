import { useSyncExternalStore } from "react";

import { SCOPE } from "./mark";

/**
 * How the app looks on this device: theme, accent colour, Liquid Glass, text
 * size, list density, home-screen icon and the tab it opens on. Kept in
 * localStorage (it's a per-device choice, like iOS display settings) and
 * applied as data attributes and CSS variables on <html> (see index.css).
 */

export type ThemePref = "system" | "light" | "dark";
export type Density = "compact" | "comfortable";
export type IconStyle = "classic" | "light" | "dark";
export type StartTab = "today" | "explore" | "saved";

export const ACCENTS = [
  { id: "blue", name: "Blue", hex: "#0066FF" },
  { id: "indigo", name: "Indigo", hex: "#5146E5" },
  { id: "teal", name: "Teal", hex: "#00808A" },
  { id: "orange", name: "Orange", hex: "#C2410C" },
  { id: "pink", name: "Pink", hex: "#D6336C" },
  { id: "graphite", name: "Graphite", hex: "#48484A" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"] | "custom";

export const TEXT_SIZES = [
  { name: "Extra small", scale: 0.88 },
  { name: "Small", scale: 0.94 },
  { name: "Default", scale: 1 },
  { name: "Large", scale: 1.12 },
  { name: "Extra large", scale: 1.24 },
] as const;

export interface Appearance {
  theme: ThemePref;
  accent: AccentId;
  liquidGlass: boolean;
  textSize: number;
  density: Density;
  icon: IconStyle;
  startTab: StartTab;
  /** Show the icon badge with saved hackathons closing this week. */
  badge: boolean;
  /** The colour picked with "Custom", used when accent is "custom". */
  customAccent: string;
}

const DEFAULTS: Appearance = {
  theme: "system",
  accent: "blue",
  liquidGlass: true,
  textSize: 2,
  density: "compact",
  icon: "classic",
  startTab: "today",
  badge: true,
  customAccent: "#7C3AED",
};

const KEY = "hackathon-radar:appearance:v1";

function load(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULTS;
}

let state: Appearance = load();
const listeners = new Set<() => void>();

export function useAppearance(): Appearance {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function setAppearance(patch: Partial<Appearance>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* kept for this session */
  }
  apply();
  listeners.forEach((l) => l());
}

export function appearance(): Appearance {
  return state;
}

/** Mix a #rrggbb colour towards white (to = 255) or black (to = 0). */
export function mix(hex: string, to: number, t: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return (
    "#" +
    [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      .map((v) => Math.round(v + (to - v) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}

export function accentHex(id: AccentId): string {
  if (id === "custom") return /^#[0-9a-f]{6}$/i.test(state.customAccent) ? state.customAccent : DEFAULTS.customAccent;
  return ACCENTS.find((a) => a.id === id)?.hex ?? ACCENTS[0].hex;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Nudge a colour towards black (light theme) or white (dark theme) until text in it reads on `bg`. */
function readable(hex: string, bg: string, towards: number, start = 0): string {
  for (let t = start; t <= 1; t += 0.05) {
    const c = mix(hex, towards, t);
    if (contrast(c, bg) >= 4.5) return c;
  }
  return towards ? "#ffffff" : "#000000";
}

const darkQuery = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function isDark(a: Appearance = state): boolean {
  return a.theme === "dark" || (a.theme === "system" && !!darkQuery?.matches);
}

let iconTimer: number | undefined;

/** Write the current appearance onto <html>. Safe to call often. */
export function apply(): void {
  const root = document.documentElement;
  const dark = isDark();
  const accent = accentHex(state.accent);
  // Any colour can be picked, so text colours derived from it are checked for contrast.
  const tint = dark ? readable(accent, "#1c1c1e", 255, 0.4) : readable(accent, "#ffffff", 0);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.glass = state.liquidGlass ? "liquid" : "frosted";
  root.dataset.density = state.density;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-hi", mix(accent, 255, 0.3));
  root.style.setProperty("--tint", tint);
  root.style.setProperty("--ink", dark ? readable(accent, "#2c2c2e", 255, 0.55) : readable(accent, "#eef0f8", 0, 0.2));
  root.style.setProperty("--on-accent", contrast(accent, "#ffffff") >= contrast(accent, "#000000") ? "#ffffff" : "#000000");
  root.style.setProperty("--soft", tint + (dark ? "33" : "17"));
  root.style.setProperty("--ts", String(TEXT_SIZES[state.textSize]?.scale ?? 1));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#000000" : "#f2f2f7");
  window.clearTimeout(iconTimer);
  iconTimer = window.setTimeout(updateIcons, 150);
}

darkQuery?.addEventListener("change", () => {
  if (state.theme === "system") {
    apply();
    listeners.forEach((l) => l());
  }
});

// ---------------------------------------------------------------- icons

export interface MarkColors {
  /** Tile gradient, top-left to bottom-right. */
  bg: [string, string];
  brackets: string;
  ring: string;
  sight: string;
  dot: string;
}

/** The app mark's colours in each icon style; the brackets take the accent. */
export function markColors(style: IconStyle, accent: string): MarkColors {
  if (style === "light") return { bg: ["#ffffff", "#ffffff"], brackets: accent, ring: accent, sight: "#1c1c1e", dot: accent };
  const bright = mix(accent, 255, 0.3);
  if (style === "dark") return { bg: ["#000000", "#000000"], brackets: bright, ring: bright, sight: "#ffffff", dot: bright };
  return { bg: ["#1a1e29", "#0b0c10"], brackets: bright, ring: bright, sight: "#ffffff", dot: "#c6ff3d" };
}

/** The app mark (lib/mark.ts) on a canvas, in the chosen style. */
export function drawIcon(size: number, style: IconStyle, accentId: AccentId = state.accent): HTMLCanvasElement {
  const m = markColors(style, accentHex(accentId));
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, m.bg[0]);
  grad.addColorStop(1, m.bg[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  g.scale(size / 100, size / 100);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.globalAlpha = 0.2;
  g.strokeStyle = m.ring;
  g.lineWidth = 1.5;
  g.stroke(new Path2D(SCOPE.ring));
  g.globalAlpha = 1;
  g.strokeStyle = m.brackets;
  g.lineWidth = 7;
  g.stroke(new Path2D(SCOPE.brackets));
  g.strokeStyle = m.sight;
  g.lineWidth = 3.5;
  g.stroke(new Path2D(SCOPE.sight));
  g.fillStyle = m.dot;
  g.fill(new Path2D(SCOPE.dot));
  return c;
}

/**
 * Point the home-screen and tab icons at the chosen style. iPhone reads
 * apple-touch-icon when the app is added to the Home Screen, so a change
 * shows after removing and re-adding the app.
 */
function updateIcons(): void {
  try {
    const touch = drawIcon(180, state.icon).toDataURL("image/png");
    const fav = drawIcon(64, state.icon).toDataURL("image/png");
    let link = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "apple-touch-icon";
      document.head.appendChild(link);
    }
    link.href = touch;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.type = "image/png";
      icon.href = fav;
    }
  } catch {
    /* canvas unavailable: keep the static icons */
  }
}
