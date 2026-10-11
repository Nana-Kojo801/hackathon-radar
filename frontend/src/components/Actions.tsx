import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarPlus, Check, Download, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { Hackathon } from "../lib/api";
import { calendarEvents, downloadIcs, googleCalendarUrl, pageUrl } from "../lib/calendar";
import { prizeText } from "../lib/format";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

const actionClass = "h-11 w-full rounded-[10px] px-3 text-[15px] font-semibold text-ink-2";

export function CalendarButton({ h, className }: { h: Hackathon; className?: string }) {
  const events = useMemo(() => calendarEvents(h), [h]);
  const [open, setOpen] = useState(false);

  if (!events.length) {
    return (
      <Button variant="outline" disabled className={cn(actionClass, className)} title="No dates announced yet">
        <CalendarPlus className="h-[18px] w-[18px]" strokeWidth={2} />
        Add to calendar
      </Button>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="outline" className={cn(actionClass, "data-[state=open]:border-teal/50", className)}>
          <CalendarPlus className="h-[18px] w-[18px] text-teal" strokeWidth={2} />
          Add to calendar
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="anim-pop z-50 w-[272px] rounded-[12px] border border-line bg-white p-1.5 shadow-[0_12px_32px_-12px_rgba(10,16,51,0.25)] outline-none"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[12.5px] font-medium text-slate">Google Calendar</div>
          {events.map((ev) => (
            <a
              key={ev.kind}
              href={googleCalendarUrl(ev, h.location_text)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex h-10 items-center rounded-[8px] px-2.5 text-[14.5px] font-medium text-ink-2 outline-none hover:bg-[#eef6fb] focus-visible:bg-[#eef6fb]"
            >
              {ev.label}
            </a>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={() => {
              downloadIcs(h, events);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left outline-none hover:bg-[#eef6fb] focus-visible:bg-[#eef6fb]"
          >
            <Download className="h-4 w-4 shrink-0 text-teal" strokeWidth={2.2} />
            <span>
              <span className="block text-[14.5px] font-medium text-ink-2">Apple Calendar or Outlook</span>
              <span className="block text-[12.5px] text-slate">
                Downloads an .ics file with {events.length > 1 ? "both dates" : "the date"}
                {events.some((e) => e.kind === "deadline") ? " and a reminder a day before the deadline" : ""}
              </span>
            </span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Phones get the system share sheet; elsewhere the link is copied. */
export function ShareButton({ h, className }: { h: Hackathon; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const share = async () => {
    const url = pageUrl(h);
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: h.title, text: `${h.title} · ${prizeText(h)}`, url });
        return;
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return; // closed the share sheet
      }
    }
    if (await copy(url)) setCopied(true);
  };

  return (
    <Button variant="outline" onClick={share} className={cn(actionClass, copied && "border-[#bfe5cc] bg-pill-green-bg text-pill-green", className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={copied ? "copied" : "share"}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-2"
          aria-live="polite"
        >
          {copied ? <Check className="h-[18px] w-[18px]" strokeWidth={2.4} /> : <Share2 className="h-[18px] w-[18px] text-teal" strokeWidth={2} />}
          {copied ? "Link copied" : "Share"}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no clipboard permission: the textarea trick still works.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}
