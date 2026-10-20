import { motion } from "framer-motion";

import { bouncy, pressSmall } from "../lib/motion";
import { linkTo, TAB_PATH, type Tab } from "../lib/router";
import { duration, easing } from "../lib/transition";
import { cn } from "../lib/utils";
import { Icon, type IconName } from "./Icon";

const TABS: { tab: Tab; label: string; icon: IconName; fill: boolean }[] = [
  { tab: "today", label: "Today", icon: "home", fill: true },
  { tab: "explore", label: "Explore", icon: "compass", fill: false },
  { tab: "saved", label: "Saved", icon: "bookmark", fill: true },
  { tab: "settings", label: "Settings", icon: "gear", fill: false },
];

/**
 * The floating glass tab bar. The selection pill slides to the tab you pick
 * with a springy curve; the bar tucks away while a page is pushed over it.
 * Both are CSS transitions, so they stay smooth while the new page renders.
 */
export function TabBar({ active, hidden, badge, onReselect }: { active: Tab; hidden: boolean; badge: number; onReselect: (t: Tab) => void }) {
  const index = Math.max(0, TABS.findIndex((t) => t.tab === active));
  return (
    <nav
      aria-label="Tabs"
      className="glass fixed bottom-[max(14px,calc(env(safe-area-inset-bottom)-6px))] left-1/2 z-40 h-[62px] w-[calc(100%-40px)] max-w-[420px] rounded-full p-1"
      style={{
        transform: `translate3d(-50%, ${hidden ? 140 : 0}px, 0)`,
        opacity: hidden ? 0 : 1,
        transition: `transform ${duration("page")}ms ${easing("page")}, opacity ${duration("page") * 0.6}ms ease-out`,
      }}
    >
      <div className="relative grid h-full grid-cols-4">
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-soft"
          style={{ transform: `translate3d(${index * 100}%,0,0)`, transition: `transform ${duration("pop")}ms ${easing("pop")}` }}
        />
        {TABS.map((t) => {
          const on = t.tab === active;
          return (
            <motion.a
              key={t.tab}
              href={TAB_PATH[t.tab]}
              aria-current={on ? "page" : undefined}
              onClick={(e) => {
                if (on && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  onReselect(t.tab);
                  return;
                }
                linkTo(TAB_PATH[t.tab])(e);
              }}
              whileTap={pressSmall}
              transition={bouncy}
              className={cn(
                "relative flex flex-col items-center justify-center gap-px rounded-full text-[10px] leading-3 font-semibold tracking-normal transition-colors duration-200 outline-none",
                on ? "text-tint" : "text-label",
              )}
            >
              <span className="relative">
                <Icon name={t.icon} size={24} stroke={1.9} filled={on && t.fill} />
                {t.tab === "saved" && badge > 0 && (
                  <span className="absolute -top-1 -right-2.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-[1.5px] border-[var(--card)] bg-red-fill px-1 text-[10.5px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </span>
              <span>{t.label}</span>
            </motion.a>
          );
        })}
      </div>
    </nav>
  );
}
