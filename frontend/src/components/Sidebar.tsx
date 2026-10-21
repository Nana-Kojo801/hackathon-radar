import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { openAdd } from "../lib/add";
import { SIDEBAR_W } from "../lib/desktop";
import { applyFilters, DEFAULT_FILTERS, type Filters } from "../lib/filters";
import { usePersonal } from "../lib/personal";
import { linkTo, navigate, type Route, TAB_PATH } from "../lib/router";
import { useData } from "../lib/store";
import { cn } from "../lib/utils";
import { AppIcon, Icon, type IconName } from "./Icon";

const SHORTCUTS: { label: string; dot: string; patch: Partial<Filters> }[] = [
  { label: "Closing this week", dot: "var(--orange-fill)", patch: { within: "7", sort: "deadline" } },
  { label: "New today", dot: "var(--accent)", patch: { newOnly: true } },
  { label: "$50K+ prizes", dot: "#34C759", patch: { minPrize: "50000" } },
  { label: "Online", dot: "#AF52DE", patch: { format: "online" } },
];

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The desktop sidebar, in place of the tab bar: the four places, the stats,
 * a search box that takes you to Explore (Ctrl/⌘ K), and shortcuts that open
 * Explore with a filter set.
 */
export function Sidebar({ route, badge }: { route: Route; badge: number }) {
  const d = useData();
  const p = usePersonal();
  const search = useRef<HTMLInputElement>(null);
  const firstRun = d.meta?.first_run_at ?? null;

  const counts = useMemo(
    () => SHORTCUTS.map((s) => applyFilters(d.items, { ...DEFAULT_FILTERS, ...s.patch }, d.newSince, firstRun).length),
    [d.items, d.newSince, firstRun],
  );
  const savedCount = useMemo(() => Object.values(p.items).filter((t) => t.status === "saved" || t.status === "registered" || t.status === "submitted").length, [p.items]);

  // Ctrl K (⌘ K on a Mac) or "/" jumps to the search box from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        search.current?.focus();
        search.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onExplore = route.tab === "explore" && !route.overlay;
  const sameAs = (patch: Partial<Filters>) => onExplore && JSON.stringify({ ...d.filters, sort: "" }) === JSON.stringify({ ...DEFAULT_FILTERS, ...patch, sort: "" });
  const open = (patch: Partial<Filters>) => {
    d.setFilters({ ...DEFAULT_FILTERS, sort: d.filters.sort, ...patch });
    navigate("/explore");
  };
  const stats = route.overlay?.kind === "stats";
  const at = (tab: Route["tab"]) => route.tab === tab && !stats && !(tab === "explore" && SHORTCUTS.some((s) => sameAs(s.patch)));

  const sync = !p.key
    ? { icon: "cloudOff" as IconName, text: "Not connected", tone: "text-label-2" }
    : p.error
      ? { icon: "cloudOff" as IconName, text: p.error === "key" ? "Key not accepted" : "Offline", tone: "text-orange" }
      : { icon: "cloudCheck" as IconName, text: p.syncing ? "Syncing…" : "Synced with your phone", tone: "text-green" };

  return (
    <aside
      aria-label="Sidebar"
      className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-y-auto border-r hairline bg-[color-mix(in_srgb,var(--bg)_94%,var(--label))] px-3 pt-5 pb-4 desk:flex"
      style={{ width: SIDEBAR_W }}
    >
      <a href="/" onClick={linkTo("/")} className="flex items-center gap-2.5 px-2 pb-4">
        <AppIcon size={30} radius={7} />
        <span className="min-w-0">
          <span className="block text-[15px] leading-tight font-semibold">Hack Radar</span>
          <span className="block text-caption text-label-2">Every open hackathon</span>
        </span>
      </a>

      <label className="mx-0.5 mb-3.5 flex h-9 items-center gap-2 rounded-[10px] bg-fill px-2.5 text-label-2">
        <Icon name="search" size={16} stroke={2.4} />
        <span className="sr-only">Search hackathons</span>
        <input
          ref={search}
          type="search"
          value={d.filters.q}
          onChange={(e) => {
            d.setFilters({ ...d.filters, q: e.target.value });
            if (!onExplore) navigate("/explore");
          }}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-label outline-none placeholder:text-label-2"
        />
        <kbd className="rounded-[5px] border border-[var(--sep)] px-1.5 text-[11px] font-semibold text-label-2">{MAC ? "⌘K" : "Ctrl K"}</kbd>
      </label>

      <nav aria-label="Pages" className="flex flex-col gap-0.5">
        <Item href={TAB_PATH.today} icon="home" on={at("today")}>
          Today
        </Item>
        <Item href={TAB_PATH.explore} icon="compass" on={at("explore")} count={d.items.length || undefined}>
          Explore
        </Item>
        <Item href={TAB_PATH.saved} icon="bookmark" on={at("saved")} count={savedCount || undefined} badge={badge}>
          Saved
        </Item>
        <Item href="/settings/stats" icon="chart" on={stats}>
          Stats
        </Item>
      </nav>

      <button type="button" onClick={() => openAdd()} className={cn(itemClass(false), "mt-0.5 text-left")}>
        <Icon name="plus" size={20} className="shrink-0 text-tint" />
        Add a hackathon
      </button>

      <h2 className="px-2.5 pt-5 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-label-2 uppercase">Shortcuts</h2>
      <div className="flex flex-col gap-0.5">
        {SHORTCUTS.map((s, i) => {
          const on = sameAs(s.patch);
          return (
            <button key={s.label} type="button" onClick={() => open(s.patch)} aria-current={on ? "page" : undefined} className={cn(itemClass(on), "text-left")}>
              <span className="mx-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="text-caption font-semibold text-label-2 tabular">{counts[i]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-auto flex flex-col gap-0.5 pt-5">
        <Item href={TAB_PATH.settings} icon="gear" on={at("settings")}>
          Settings
        </Item>
        <a href="/settings" onClick={linkTo("/settings")} className="flex items-center gap-2 px-2.5 py-1.5 text-caption text-label-2">
          <Icon name={sync.icon} size={15} stroke={2.2} className={sync.tone} />
          {sync.text}
        </a>
      </div>
    </aside>
  );
}

function itemClass(on: boolean) {
  return cn(
    "flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-[14px] font-medium transition-colors",
    on ? "bg-card text-tint shadow-[0_1px_2px_rgba(0,0,0,0.06)]" : "text-label hover:bg-fill",
  );
}

function Item({ href, icon, on, count, badge, children }: { href: string; icon: IconName; on: boolean; count?: number; badge?: number; children: ReactNode }) {
  return (
    <a href={href} onClick={linkTo(href)} aria-current={on ? "page" : undefined} className={itemClass(on)}>
      <Icon name={icon} size={20} filled={on} className="shrink-0 text-tint" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {/* Saved hackathons closing this week, like the tab bar's badge; otherwise how many there are. */}
      {badge ? (
        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-fill px-1 text-[11px] font-bold text-white">{badge}</span>
      ) : (
        count !== undefined && <span className="text-caption font-semibold text-label-2 tabular">{count}</span>
      )}
    </a>
  );
}
