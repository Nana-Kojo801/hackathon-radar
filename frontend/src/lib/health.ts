import type { Meta } from "./api";
import { SOURCE_NAME, timeAgo } from "./format";

const HOUR = 3_600_000;
/** Runs are every 6 hours; two missed runs in a row means the schedule itself is failing. */
const STALE_AFTER = 13 * HOUR;
/** A run that started this recently and hasn't finished is still going, not failed. */
const RUNNING_FOR = 45 * 60_000;

const NAMES: Record<string, string> = { ...SOURCE_NAME, web: "Web search", enrich: "AI summaries" };

function list(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What, if anything, the list page should warn about: sources whose last run
 * failed, or refreshes that stopped happening. `key` changes whenever the
 * problem does, so a dismissed warning comes back for a new failure.
 */
export function healthWarning(meta: Meta | null, now = Date.now()): { key: string; text: string } | null {
  if (!meta) return null;
  if (meta.last_refresh && now - Date.parse(meta.last_refresh) > STALE_AFTER) {
    return {
      key: `stale:${meta.last_refresh}`,
      text: `Listings were last refreshed ${timeAgo(meta.last_refresh, now)}. The scheduled refresh may be failing, so some details could be out of date.`,
    };
  }
  const failed = (meta.sources ?? []).filter((s) => {
    if (!(s.source in NAMES) || s.healthy) return false;
    const running = !s.finished_at && now - Date.parse(s.started_at) < RUNNING_FOR;
    return !running;
  });
  if (!failed.length) return null;
  const listing = failed.filter((s) => s.source !== "enrich").map((s) => NAMES[s.source]);
  const parts: string[] = [];
  if (listing.length)
    parts.push(`${list(listing)} didn't refresh on the last run, so ${listing.length > 1 ? "their" : "its"} listings may be out of date.`);
  if (failed.some((s) => s.source === "enrich")) parts.push("Some new listings may be missing their summaries and details until the next run.");
  return { key: failed.map((s) => `${s.source}@${s.started_at}`).join("|"), text: parts.join(" ") };
}
