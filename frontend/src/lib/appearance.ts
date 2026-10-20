import { useSyncExternalStore } from "react";

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
export type AccentId = (typeof ACCENTS)[number]["id"];

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
  return ACCENTS.find((a) => a.id === id)?.hex ?? ACCENTS[0].hex;
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
  const tint = dark ? mix(accent, 255, 0.4) : accent;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.glass = state.liquidGlass ? "liquid" : "frosted";
  root.dataset.density = state.density;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-hi", mix(accent, 255, 0.3));
  root.style.setProperty("--tint", tint);
  root.style.setProperty("--ink", dark ? mix(accent, 255, 0.55) : mix(accent, 0, 0.2));
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

/** The radar mark on a canvas: rings, a sweep and a blip. */
export function drawIcon(size: number, style: IconStyle, accentId: AccentId = state.accent): HTMLCanvasElement {
  const accent = accentHex(accentId);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  if (style === "classic") {
    const grad = g.createLinearGradient(0, 0, size * 0.4, size);
    grad.addColorStop(0, mix(accent, 255, 0.3));
    grad.addColorStop(1, accent);
    g.fillStyle = grad;
  } else {
    g.fillStyle = style === "light" ? "#ffffff" : "#000000";
  }
  g.fillRect(0, 0, size, size);
  const fg = style === "classic" ? "#ffffff" : style === "light" ? accent : mix(accent, 255, 0.4);
  const u = size / 24;
  const cx = 12 * u;
  g.lineCap = "round";
  g.strokeStyle = fg;
  g.lineWidth = 1.7 * u * 0.62;
  g.globalAlpha = 0.4;
  g.beginPath();
  g.arc(cx, cx, 8.5 * u * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.7;
  g.beginPath();
  g.arc(cx, cx, 4.6 * u * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = 2.1 * u * 0.62;
  g.beginPath();
  g.moveTo(cx, cx);
  g.lineTo(cx + 6 * u * 0.62, cx - 6 * u * 0.62);
  g.stroke();
  g.fillStyle = fg;
  g.beginPath();
  g.arc(cx, cx, 1.7 * u * 0.62, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(cx + 3.7 * u * 0.62, cx + 3.3 * u * 0.62, 1.2 * u * 0.62, 0, Math.PI * 2);
  g.fill();
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
