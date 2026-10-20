import { type ReactNode, useRef } from "react";

import { goBack } from "../lib/router";
import { BarBacking, GlassButton, useScrolled } from "./kit";

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
}: {
  title: string;
  right?: ReactNode;
  bar?: ReactNode;
  children: ReactNode;
  backLabel?: string;
  backTo?: string;
  backdrop?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useScrolled(60, scroller);
  return (
    <>
      <div ref={scroller} className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain page-bg">
        {backdrop}
        <div className="sticky top-0 z-20 pt-[env(safe-area-inset-top)]">
          <BarBacking show={scrolled} />
          <div className="relative mx-auto flex h-[60px] max-w-[720px] items-center justify-between gap-3 px-4">
            <GlassButton label={backLabel} icon="back" onClick={() => goBack(backTo)} />
            <div className="bar-title min-w-0 flex-1 truncate text-center text-body font-semibold" data-show={scrolled || undefined}>
              {title}
            </div>
            <div className="flex min-w-[44px] justify-end gap-2">{right}</div>
          </div>
        </div>
        <div className="relative mx-auto max-w-[720px]">{children}</div>
      </div>
      {bar && <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]">{bar}</div>}
    </>
  );
}
