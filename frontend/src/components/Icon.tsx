import type { SVGProps } from "react";

import { ICON_PATHS } from "./icons.generated";

export type IconName = keyof typeof ICON_PATHS;

/**
 * The app's icons: Phosphor (components/icons.generated.ts, built by
 * scripts/icons.mjs), rounded and friendly in the spirit of SF Symbols. Three
 * weights: regular, bold (asked for with a heavier `stroke`, from 2.4) and
 * solid (`filled`, for selected states).
 */
export function Icon({ name, size = 20, stroke = 2, filled, ...rest }: { name: IconName; size?: number; stroke?: number; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, "stroke" | "name">) {
  const weight = filled ? "fill" : stroke >= 2.4 ? "bold" : "regular";
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" {...rest}>
      <path d={ICON_PATHS[name][weight]} />
    </svg>
  );
}

/** The app mark: a bold H sending out a signal. Paths on a 24px grid, shared with the canvas icon. */
export const MARK_H = "M5.6 6.2v11.6M12.6 6.2v11.6M5.6 12h7";
export const MARK_WAVES = ["M16.2 9.4a3.7 3.7 0 0 1 0 5.2", "M18.7 6.9a7.3 7.3 0 0 1 0 10.2"];

export function RadarMark({ size = 24, color = "currentColor", wave }: { size?: number; color?: string; wave?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={MARK_H} strokeWidth="3.1" />
      <path d={MARK_WAVES[0]} strokeWidth="2.1" stroke={wave ?? color} />
      <path d={MARK_WAVES[1]} strokeWidth="2.1" stroke={wave ?? color} strokeOpacity="0.55" />
    </svg>
  );
}

export function AppIcon({ size = 58, radius }: { size?: number; radius?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius ?? size * 0.235,
        background: "linear-gradient(160deg, var(--accent-hi) 0%, var(--accent) 100%)",
        boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.2)",
      }}
    >
      <RadarMark size={size * 0.7} color="#fff" />
    </span>
  );
}
