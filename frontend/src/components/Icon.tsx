import type { SVGProps } from "react";

/** Stroke icons drawn on a 24px grid, in the spirit of SF Symbols. */
const PATHS = {
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.8-3.8",
  back: "m15 18-6-6 6-6",
  chevron: "m9 18 6-6-6-6",
  chevronDown: "m7 10 5 5 5-5",
  updown: "m8 9 4-4 4 4M8 15l4 4 4-4",
  close: "M18 6 6 18M6 6l12 12",
  check: "M20 6 9 17l-5-5",
  more: "",
  filters: "M4 7h10M18 7h2M4 17h4M12 17h8M16 4.5v5M10 14.5v5",
  share: "M12 3v12M8 7l4-4 4 4M6 11h-.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H18",
  bookmark: "M18 21l-6-4-6 4V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z",
  calendar: "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5zM16 2.5v4M8 2.5v4M3.5 10h17",
  calendarAdd: "M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5zM16 2.5v4M8 2.5v4M3.5 10h17M12 13v5M9.5 15.5h5",
  clock: "M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19zM12 7v5l3 2",
  globe: "M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19zM2.5 12h19M12 2.5a14.5 14.5 0 0 1 0 19 14.5 14.5 0 0 1 0-19z",
  monitor: "M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5zM8 20.5h8M12 16.5v4",
  pin: "M19 10c0 6-7 11.5-7 11.5S5 16 5 10a7 7 0 0 1 14 0zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  shuffle: "M3 7h4c4 0 6 10 10 10h4M3 17h4c1.6 0 2.8-1.5 3.8-3.4M13.2 10.4C14.2 8.5 15.4 7 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3",
  pencil: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  eyeOff: "M9.9 9.9a3 3 0 1 0 4.2 4.2M10.7 5.1A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  arrowUpRight: "M7 17 17 7M8 7h9v9",
  bell: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0",
  mail: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM22 7.5l-10 6-10-6",
  news: "M4 4h12v16H6a2 2 0 0 1-2-2zM16 8h4v10a2 2 0 0 1-2 2M8 8h4M8 12h4M8 16h4",
  palette: "M12 2.5a9.5 9.5 0 0 0 0 19c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h1.9c2.9 0 5.2-2.4 5.2-5.2C21.5 6.3 17.2 2.5 12 2.5zM7.5 12.5h.01M9.5 7.5h.01M14.5 7.5h.01M17 11.5h.01",
  home: "M4 10.6 12 4l8 6.6V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z",
  compass: "M12 21.5a9.5 9.5 0 1 0 0-19 9.5 9.5 0 0 0 0 19zM15.6 8.4l-1.9 5.3-5.3 1.9 1.9-5.3z",
  gear: "M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  key: "M15.5 7.5l3 3L22 7l-3-3M21 2l-9.6 9.6M7.5 21a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z",
  refresh: "M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5",
  cloudCheck: "M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 9.5zM9.5 13l2 2 3.5-3.5",
  cloudOff: "M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 1.3-2.1M10.8 5.1A6 6 0 0 1 18 8.5a4 4 0 0 1 2.4 7.1M3 3l18 18",
  alert: "M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01",
  moon: "M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a7 7 0 0 0 10.8 10.8z",
  link: "M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1-1",
  trophy: "M7 4h10v4a5 5 0 0 1-10 0zM7 6H4.5a2.5 2.5 0 0 0 2.6 3.5M17 6h2.5a2.5 2.5 0 0 1-2.6 3.5M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z",
  copy: "M9 9h10.5a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5H10.5A1.5 1.5 0 0 1 9 20zM15 9V4.5A1.5 1.5 0 0 0 13.5 3H4.5A1.5 1.5 0 0 0 3 4.5v9A1.5 1.5 0 0 0 4.5 15H9",
  plus: "M12 5v14M5 12h14",
  mic: "M9 2.5h6v12H9zM5 11a7 7 0 0 0 14 0M12 18v3.5",
  ticket: "M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM14.5 6v2.5M14.5 11v2M14.5 15.5V18",
  send: "M21.5 2.5 10.5 13.5M21.5 2.5l-7 19-4-8-8-4z",
  flag: "M5 21V4M5 4.5c3-2 6 2 9 0s4-1 5-1v9c-1 0-2-1-5 1s-6-2-9 0",
  sparkle: "M12 3l1.8 5.4a2 2 0 0 0 1.3 1.3L20.5 11.5l-5.4 1.8a2 2 0 0 0-1.3 1.3L12 20l-1.8-5.4a2 2 0 0 0-1.3-1.3L3.5 11.5l5.4-1.8a2 2 0 0 0 1.3-1.3z",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, stroke = 2, filled, ...rest }: { name: IconName; size?: number; stroke?: number; filled?: boolean } & Omit<SVGProps<SVGSVGElement>, "stroke" | "name">) {
  if (name === "more") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
        <circle cx="5.5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="18.5" cy="12" r="1.8" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={PATHS[name]} />
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
