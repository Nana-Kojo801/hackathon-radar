/**
 * The app mark, "Scope": code brackets around a crosshair. Paths on a
 * 100-unit grid, shared by the in-app icon (components/Icon.tsx) and the
 * home-screen icon drawn on a canvas (lib/appearance.ts). The static icons in
 * public/ are drawn from the same shapes, plus a one-colour version for the
 * notification badge (Android shows only its silhouette).
 *
 * Stroke widths: ring 1.5 (at 20% opacity), brackets 7, sight 3.5.
 */
export const SCOPE = {
  /** A faint ring behind the sight. */
  ring: "M50 23a27 27 0 1 0 0 54a27 27 0 1 0 0-54Z",
  brackets: "M28 31L15 50L28 69M72 31L85 50L72 69",
  sight: "M50 38a12 12 0 1 0 0 24a12 12 0 1 0 0-24ZM50 31V38M50 62V69M31 50H38M62 50H69",
  dot: "M50 45.8a4.2 4.2 0 1 0 0 8.4a4.2 4.2 0 1 0 0-8.4Z",
} as const;
