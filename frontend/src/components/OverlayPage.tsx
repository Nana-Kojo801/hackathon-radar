import { createContext, type ReactNode, useContext, useRef } from "react";

import { goBack } from "../lib/router";
import { cn } from "../lib/utils";
import { BarBacking, GlassButton, useScrolled } from "./kit";

/** Set by the desktop Settings page, which shows its pages beside the list rather than pushed over it. */
export const InlinePage = createContext(false);

/**
 * The frame for a page that slides in over the tabs: its own scroll area, a
 * glass back button, a title that appears once you scroll, and room for a
 * floating bar at the bottom.
 */
export function OverlayPage({
  title,
  right,
  bar,
  children,
  backLabel = "Back",
  backTo,
  backdrop,
  wide,
}: {
  title: string;
  right?: ReactNode;
  bar?: ReactNode;
  children: ReactNode;
  backLabel?: string;
  backTo?: string;
  backdrop?: ReactNode;
  /** Use the width of a desktop window (the hackathon page, stats) instead of a phone column. */
  wide?: boolean;
}) {
  const inline = useContext(InlinePage);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled(60, scroller);
  if (inline) return <div className="pt-4">{children}</div>;
  const width = wide ? "max-w-[720px] desk:max-w-[1160px]" : "max-w-[720px]";
  return (
    <>
      <div ref={scroller} className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain page-bg">
        {backdrop}
        <div className="sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
          <BarBacking show={scrolled} />
          <div className={cn("relative mx-auto flex h-[60px] items-center justify-between gap-3 px-4", wide && "desk:px-10", width)}>
            <GlassButton label={backLabel} icon="back" onClick={() => goBack(backTo)} />
            <div className="bar-title min-w-0 flex-1 truncate text-center text-body font-semibold" data-show={scrolled || undefined}>
              {title}
            </div>
            <div className="flex min-w-[44px] justify-end gap-2">{right}</div>
          </div>
        </div>
        <div className={cn("relative mx-auto", width)}>{children}</div>
      </div>
      {bar && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">{bar}</div>}
    </>
  );
}
