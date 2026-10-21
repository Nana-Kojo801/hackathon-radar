import { createContext, useContext } from "react";

import type { Hackathon, Meta } from "./api";
import type { Filters } from "./filters";

/** The hackathon list and filters, loaded once in App and shared by every page. */
export interface AppData {
  /** Open and upcoming hackathons, minus the ones you marked "not interested". */
  items: Hackathon[];
  /** Every loaded hackathon by id, hidden ones included. */
  live: Map<string, Hackathon>;
  meta: Meta | null;
  loading: boolean;
  slow: boolean;
  error: string | null;
  retry: () => void;
  filters: Filters;
  setFilters: (f: Filters) => void;
  /** Start of your previous visit, for "new since"; null means "the last 48 hours". */
  newSince: string | null;
  categories: { category: string; count: number }[];
  warning: { key: string; text: string } | null;
  /** Show a hackathon you just added before the published list has it. */
  addLocal: (h: Hackathon) => void;
}

export const DataContext = createContext<AppData | null>(null);

export function useData(): AppData {
  const d = useContext(DataContext);
  if (!d) throw new Error("useData outside DataContext");
  return d;
}

/** Ask Explore to focus its search field when it next shows (it stays mounted, so it listens too). */
let focusSearch = false;
export const SEARCH_FOCUS_EVENT = "radar:search-focus";
export function requestSearchFocus(): void {
  focusSearch = true;
  window.dispatchEvent(new Event(SEARCH_FOCUS_EVENT));
}
export function takeSearchFocus(): boolean {
  const v = focusSearch;
  focusSearch = false;
  return v;
}

/** Ask App to check for a newer list (a refresh just finished); it reloads only if there is one. */
export const DATA_STALE_EVENT = "radar:data-stale";
export function checkForNewData(): void {
  window.dispatchEvent(new Event(DATA_STALE_EVENT));
}
