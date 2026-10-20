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
}

export const DataContext = createContext<AppData | null>(null);

export function useData(): AppData {
  const d = useContext(DataContext);
  if (!d) throw new Error("useData outside DataContext");
  return d;
}

/** Ask Explore to focus its search field when it next shows. */
let focusSearch = false;
export function requestSearchFocus(): void {
  focusSearch = true;
}
export function takeSearchFocus(): boolean {
  const v = focusSearch;
  focusSearch = false;
  return v;
}
