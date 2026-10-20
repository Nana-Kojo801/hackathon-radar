import { type MouseEvent, useEffect, useState } from "react";

/**
 * A small history router. Four tabs (Today, Explore, Saved, Settings), plus
 * pages that slide in over them: a hackathon (/h/<id>) and the settings
 * sub-pages. A hackathon opens over whichever tab you came from.
 */

export type Tab = "today" | "explore" | "saved" | "settings";
export type Overlay = { kind: "detail"; id: string } | { kind: "appearance" } | { kind: "notifications" } | { kind: "email" } | { kind: "stats" };

export interface Route {
  tab: Tab;
  overlay: Overlay | null;
  /** Stable key for the overlay, for animations. */
  key: string | null;
}

export const TAB_PATH: Record<Tab, string> = { today: "/", explore: "/explore", saved: "/saved", settings: "/settings" };

let lastTab: Tab = "today";

function read(): string {
  return window.location.pathname;
}

export function parse(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  const detail = clean.match(/^\/h\/([0-9a-f-]{36})$/i);
  if (detail) return { tab: lastTab, overlay: { kind: "detail", id: detail[1] }, key: `h:${detail[1]}` };
  if (clean === "/settings/appearance") return { tab: "settings", overlay: { kind: "appearance" }, key: "appearance" };
  if (clean === "/settings/notifications") return { tab: "settings", overlay: { kind: "notifications" }, key: "notifications" };
  if (clean === "/settings/stats") return { tab: "settings", overlay: { kind: "stats" }, key: "stats" };
  if (clean === "/settings/email") return { tab: "settings", overlay: { kind: "email" }, key: "email" };
  const tab: Tab = clean === "/explore" ? "explore" : clean === "/saved" || clean === "/me" ? "saved" : clean === "/settings" ? "settings" : "today";
  lastTab = tab;
  return { tab, overlay: null, key: null };
}

export function usePath(): string {
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onPop = () => setPath(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === read() + window.location.search) return;
  // inApp marks entries we pushed ourselves, so "back" can use history safely.
  const state = { inApp: true };
  if (opts.replace) window.history.replaceState(state, "", to);
  else window.history.pushState(state, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goBack(fallback = TAB_PATH[lastTab]): void {
  if ((window.history.state as { inApp?: boolean } | null)?.inApp) window.history.back();
  else navigate(fallback, { replace: true });
}

/** Link click handler that keeps cmd/ctrl-click opening a new tab. */
export function linkTo(to: string) {
  return (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatch(mql.matches);
    mql.addEventListener("change", on);
    on();
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return match;
}
