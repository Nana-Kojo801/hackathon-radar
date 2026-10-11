import { useEffect, useState } from "react";

/** A two-route history router: "/" and "/h/<id>". No dependency needed for that. */

function read(): string {
  return window.location.pathname;
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
  if (to === read()) return;
  // inApp marks entries we pushed ourselves, so "back" can use history safely.
  const state = { inApp: true };
  if (opts.replace) window.history.replaceState(state, "", to);
  else window.history.pushState(state, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function goBack(fallback = "/"): void {
  if ((window.history.state as { inApp?: boolean } | null)?.inApp) window.history.back();
  else navigate(fallback, { replace: true });
}

export function detailId(path: string): string | null {
  const m = path.match(/^\/h\/([0-9a-f-]{36})\/?$/i);
  return m ? m[1] : null;
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
