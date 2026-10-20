import { animate, motion, type PanInfo, useMotionValue, useTransform, type ValueAnimationTransition } from "framer-motion";
import { type MouseEvent, useEffect, useRef } from "react";

import type { Hackathon } from "../lib/api";
import type { Density } from "../lib/appearance";
import { categoryLabel, FORMAT_LABEL, hostOf, mainCategory, prizeShort, sourceName } from "../lib/format";
import { rise, spring } from "../lib/motion";
import { type Stage, track } from "../lib/personal";
import { navigate } from "../lib/router";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";
import { Icon } from "./Icon";
import { DueTag, StageTag, Thumb } from "./kit";

const ACTIONS_W = 148;

export function meta(h: Hackathon): string {
  const where = h.format === "online" ? "Online" : h.format === "unknown" ? null : h.location_text?.split(",").slice(-2).join(",").trim() || FORMAT_LABEL[h.format];
  const cat = mainCategory(h);
  return [h.organizer ?? (h.source === "web" ? hostOf(h.source_url) : sourceName(h)), where, cat && categoryLabel(cat)].filter(Boolean).join(" · ");
}

/**
 * A hackathon in a list. Swipe left for Save and Hide; the row springs open
 * past a third of the way (or on a flick) and closes otherwise. Only one row
 * stays open at a time.
 */
export function HackRow({
  h,
  stage,
  density,
  index,
  last,
  openId,
  setOpenId,
  swipe = true,
}: {
  h: Hackathon;
  stage: Stage | null;
  density: Density;
  index: number;
  last?: boolean;
  openId?: string | null;
  setOpenId?: (id: string | null) => void;
  swipe?: boolean;
}) {
  const x = useMotionValue(0);
  const actionsOpacity = useTransform(x, [-ACTIONS_W, -24, 0], [1, 0.4, 0]);
  const actionsScale = useTransform(x, [-ACTIONS_W, -24], [1, 0.7]);
  const dragged = useRef(false);
  const comfy = density === "comfortable";
  const saved = stage !== null && stage !== "hidden";

  useEffect(() => {
    if (openId !== h.id && x.get() !== 0) animate(x, 0, spring as ValueAnimationTransition);
  }, [openId, h.id, x]);

  const settle = (open: boolean) => {
    animate(x, open ? -ACTIONS_W : 0, spring as ValueAnimationTransition);
    setOpenId?.(open ? h.id : null);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    // Decide by where the row ended up, so nudging an open row keeps it open; a flick wins either way.
    const v = info.velocity.x;
    settle(v < -450 || (v < 450 && x.get() < -ACTIONS_W / 3));
    window.setTimeout(() => (dragged.current = false), 60);
  };

  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (dragged.current) return;
    if (x.get() < -4) return settle(false);
    navigate(`/h/${h.id}`);
  };

  const save = () => {
    track(h, { status: saved ? null : "saved" });
    toast(saved ? "Removed from Saved" : "Saved", "bookmark");
    settle(false);
  };
  const hide = () => {
    track(h, { status: "hidden" });
    toast("Hidden from your lists", "eye-off");
    settle(false);
  };

  return (
    <motion.li {...rise(index)} className="relative overflow-hidden">
      {swipe && (
        <motion.div style={{ opacity: actionsOpacity }} className="absolute inset-y-0 right-0 flex gap-1.5 py-2 pr-2" aria-hidden={openId !== h.id}>
          <motion.button
            type="button"
            style={{ scale: actionsScale }}
            whileTap={{ scale: 0.92 }}
            onClick={hide}
            tabIndex={openId === h.id ? 0 : -1}
            className="flex w-[66px] flex-col items-center justify-center gap-1 rounded-[16px] bg-[#8e8e93] text-caption font-semibold text-white"
          >
            <Icon name="eyeOff" size={20} />
            Hide
          </motion.button>
          <motion.button
            type="button"
            style={{ scale: actionsScale }}
            whileTap={{ scale: 0.92 }}
            onClick={save}
            tabIndex={openId === h.id ? 0 : -1}
            className="flex w-[66px] flex-col items-center justify-center gap-1 rounded-[16px] bg-accent text-caption font-semibold text-on-accent"
          >
            <Icon name="bookmark" size={20} filled={!saved} />
            {saved ? "Unsave" : "Save"}
          </motion.button>
        </motion.div>
      )}
      <motion.a
        href={`/h/${h.id}`}
        onClick={onClick}
        drag={swipe ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: -ACTIONS_W, right: 0 }}
        dragElastic={{ left: 0.12, right: 0.04 }}
        dragMomentum={false}
        onDragStart={() => (dragged.current = true)}
        onDragEnd={onDragEnd}
        style={{ x, touchAction: "pan-y" }}
        className="relative flex items-start gap-3 bg-card pl-3.5 outline-none select-none active:bg-[color-mix(in_srgb,var(--card)_92%,var(--label))]"
        draggable={false}
      >
        <Thumb h={h} size={comfy ? 64 : 56} radius={comfy ? 15 : 14} className="mt-3.5" />
        <div className={cn("flex min-w-0 flex-1 gap-2.5 py-3.5 pr-3.5", !last && "border-b hairline")}>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-callout leading-[1.3] font-semibold tracking-[-0.015em]">{h.title}</div>
            <div className="mt-px truncate text-footnote text-label-2">{meta(h)}</div>
            {comfy && h.summary && <div className="mt-1 line-clamp-2 text-[calc(14px*var(--ts))] leading-[1.36] text-label-2">{h.summary}</div>}
            <div className="mt-[7px] flex flex-wrap items-center gap-1.5">
              <DueTag h={h} />
              {stage && <StageTag status={stage} />}
            </div>
          </div>
          <div className="shrink-0 text-right text-[calc(17px*var(--ts))] leading-[1.25] font-bold tracking-[-0.02em] tabular">{prizeShort(h)}</div>
        </div>
      </motion.a>
    </motion.li>
  );
}
