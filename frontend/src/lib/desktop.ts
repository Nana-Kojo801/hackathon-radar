import { useMedia } from "./router";

/**
 * The desktop layout: from this width the app shows a sidebar instead of the
 * tab bar, and pages use the room (Explore gets a preview pane, Saved a board,
 * Settings opens its pages beside the list). The `desk:` CSS variant matches.
 */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/** The sidebar's width, which pages pushed in from the right leave uncovered. */
export const SIDEBAR_W = 260;

export function useDesktop(): boolean {
  return useMedia(DESKTOP_QUERY);
}

export function isDesktop(): boolean {
  return window.matchMedia(DESKTOP_QUERY).matches;
}
