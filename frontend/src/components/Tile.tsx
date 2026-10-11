import { motion } from "framer-motion";
import { memo } from "react";

import type { Hackathon } from "../lib/api";
import { colorOf, FORMAT_LABEL, isNew, isUrgent, prizeShort, remaining, shortLeft, SOURCE_NAME } from "../lib/format";
import { Ring } from "./Ring";

interface TileProps {
  h: Hackathon;
  index: number;
  selected: boolean;
  firstRunAt: string | null;
  onOpen: (id: string) => void;
}

export const Tile = memo(function Tile({ h, index, selected, firstRunAt, onOpen }: TileProps) {
  const color = colorOf(h);
  const urgent = isUrgent(h);
  const fresh = isNew(h, firstRunAt);
  const left = shortLeft(h);
  return (
    <motion.button
      layout="position"
      type="button"
      onClick={() => onOpen(h.id)}
      aria-label={`${h.title}, ${h.prize_usd ? prizeShort(h) : "no prize listed"}, ${left}`}
      aria-current={selected ? "true" : undefined}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.15 } }}
      transition={{ type: "spring", stiffness: 380, damping: 32, delay: Math.min(index, 12) * 0.025 }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      className="group relative flex min-w-0 flex-col gap-2.5 rounded-[24px] bg-panel p-3.5 pb-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink/60"
    >
      {selected && (
        <motion.span
          layoutId="selected-outline"
          className="pointer-events-none absolute inset-0 rounded-[24px] border-[1.5px]"
          style={{ borderColor: color }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        />
      )}
      {fresh && (
        <span className="absolute top-3 right-3 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-bold text-ground">NEW</span>
      )}
      <span className="mx-auto mt-0.5 block transition-transform duration-300 group-hover:scale-[1.04]">
        <Ring value={remaining(h)} color={color} size={116} thickness={10} delay={120 + Math.min(index, 14) * 45}>
          <span className={`font-display text-[22px] leading-none font-black tracking-tight ${h.prize_usd ? "text-white" : "text-[#6B6F78]"}`}>
            {prizeShort(h)}
          </span>
          <span className={`mt-1 flex items-center gap-1 text-[11.5px] font-semibold ${urgent ? "text-urgent" : "text-muted"}`}>
            {urgent && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-urgent" />}
            {left}
          </span>
        </Ring>
      </span>
      <span className="line-clamp-2 text-[14px] leading-snug font-semibold">{h.title}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
        <span className="truncate">
          {FORMAT_LABEL[h.format]} · {h.organizer || SOURCE_NAME[h.source]}
        </span>
      </span>
    </motion.button>
  );
});
