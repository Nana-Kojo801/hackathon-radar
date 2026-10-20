import { motion } from "framer-motion";

import { bouncy, pageSpring, pressSmall } from "../lib/motion";
import { linkTo, TAB_PATH, type Tab } from "../lib/router";
import { cn } from "../lib/utils";
import { Icon, type IconName } from "./Icon";

const TABS: { tab: Tab; label: string; icon: IconName; fill: boolean }[] = [
  { tab: "today", label: "Today", icon: "home", fill: true },
  { tab: "explore", label: "Explore", icon: "compass", fill: false },
  { tab: "saved", label: "Saved", icon: "bookmark", fill: true },
  { tab: "settings", label: "Settings", icon: "gear", fill: false },
];

/** The floating glass tab bar. The selection pill springs between tabs. */
export function TabBar({ active, hidden, badge, onReselect }: { active: Tab; hidden: boolean; badge: number; onReselect: (t: Tab) => void }) {
  return (
    <motion.nav
      aria-label="Tabs"
      initial={false}
      animate={{ y: hidden ? 140 : 0, opacity: hidden ? 0 : 1 }}
      transition={pageSpring}
      className="glass fixed bottom-[max(14px,calc(env(safe-area-inset-bottom)-6px))] left-1/2 z-40 grid h-[62px] w-[calc(100%-40px)] max-w-[420px] grid-cols-4 rounded-full p-1"
      style={{ x: "-50%" }}
    >
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
            className={cn("relative flex flex-col items-center justify-center gap-px rounded-full text-[10px] leading-3 font-semibold tracking-normal outline-none", on ? "text-tint" : "text-label")}
          >
            {on && <motion.span layoutId="tab-pill" transition={bouncy} className="absolute inset-0 rounded-full bg-soft" />}
            <span className="relative">
              <Icon name={t.icon} size={24} stroke={1.9} filled={on && t.fill} />
              {t.tab === "saved" && badge > 0 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={bouncy}
                  className="absolute -top-1 -right-2.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full border-[1.5px] border-[var(--card)] bg-red-fill px-1 text-[10.5px] font-bold text-white"
                >
                  {badge}
                </motion.span>
              )}
            </span>
            <span className="relative">{t.label}</span>
          </motion.a>
        );
      })}
    </motion.nav>
  );
}
