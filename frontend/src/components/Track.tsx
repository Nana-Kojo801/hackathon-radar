import { Bookmark, BookmarkCheck, Check, CloudOff, EyeOff, Loader2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Hackathon } from "../lib/api";
import { STAGES, type Stage, stageLabel, track, usePersonal } from "../lib/personal";
import { navigate } from "../lib/router";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { FieldSelect } from "./ui/select";

/** "Saved on this device · will sync" etc., for a tracked hackathon. */
function SyncNote({ id }: { id: string }) {
  const { pending, error, syncing } = usePersonal();
  if (!pending.includes(id)) {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-slate">
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} /> Synced
      </span>
    );
  }
  if (error === "offline" && !syncing) {
    return (
      <span className="flex items-center gap-1.5 text-[12.5px] text-slate" title="The server is asleep or you're offline. It retries on its own.">
        <CloudOff className="h-3.5 w-3.5" strokeWidth={2.2} /> Saved here, will sync
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-slate">
      <Loader2 className="spin h-3.5 w-3.5" strokeWidth={2.2} /> Syncing
    </span>
  );
}

/** The details page's tracking block: save, stage, not interested, notes. */
export function TrackPanel({ h, className }: { h: Hackathon; className?: string }) {
  const p = usePersonal();
  const t = p.items[h.id];
  const status: Stage | null = t?.status ?? null;
  const [note, setNote] = useState(t?.note ?? "");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // Take the stored note when the hackathon changes, or a sync brings a new one
  // (but never while you're typing in it).
  useEffect(() => {
    if (document.activeElement !== noteRef.current) setNote(t?.note ?? "");
  }, [h.id, t?.note]);

  if (!p.key) {
    return (
      <div className={cn("rounded-[12px] border border-line bg-field px-4 py-3.5", className)}>
        <p className="text-[14.5px] leading-snug text-ink-2">Save hackathons, track where you are with them and keep notes.</p>
        <Button variant="soft" size="sm" className="mt-2.5 h-9 rounded-[9px] px-3.5" onClick={() => navigate("/settings")}>
          Connect this device
        </Button>
      </div>
    );
  }

  const tracked = status !== null && status !== "hidden";
  return (
    <div className={cn("space-y-3", className)}>
      {status === "hidden" ? (
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-line bg-field px-3.5 py-2.5">
          <span className="flex items-center gap-2 text-[14.5px] text-ink-2">
            <EyeOff className="h-4 w-4 text-slate" strokeWidth={2.2} /> Hidden from your list
          </span>
          <Button variant="ghost" size="sm" className="h-8 px-2.5 text-teal" onClick={() => track(h, { status: null })}>
            <Undo2 className="h-4 w-4" strokeWidth={2.2} /> Undo
          </Button>
        </div>
      ) : tracked ? (
        <div className="flex items-end gap-2.5">
          <FieldSelect
            label="My stage"
            value={status as Exclude<Stage, "hidden">}
            onChange={(v) => track(h, { status: v })}
            options={STAGES}
            className="min-w-0 flex-1"
            triggerClassName="h-11 w-full"
            prefix={<BookmarkCheck className="h-[18px] w-[18px] text-teal" strokeWidth={2} />}
          />
          <Button variant="outline" className="h-11 rounded-[10px] px-3 text-[14.5px] text-ink-2" onClick={() => track(h, { status: null })}>
            Remove
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="primary" className="h-11 rounded-[10px] text-[15px]" onClick={() => track(h, { status: "saved" })}>
            <Bookmark className="h-[18px] w-[18px]" strokeWidth={2} /> Save
          </Button>
          <Button variant="outline" className="h-11 rounded-[10px] text-[15px] text-ink-2" onClick={() => track(h, { status: "hidden" })}>
            <EyeOff className="h-[18px] w-[18px] text-slate" strokeWidth={2} /> Not interested
          </Button>
        </div>
      )}

      <label className="block">
        <span className="mb-1.5 flex items-center justify-between">
          <span className="text-[13.5px] font-medium text-[#4a5fb0]">Notes</span>
          {(t || note) && <SyncNote id={h.id} />}
        </span>
        <textarea
          ref={noteRef}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            track(h, { note: e.target.value }, { debounce: true });
          }}
          rows={3}
          maxLength={5000}
          placeholder="Ideas, teammates, things to check…"
          className="block w-full resize-y rounded-[10px] border border-field-line bg-white px-3 py-2.5 text-[15px] leading-snug text-ink outline-none placeholder:text-[#8a9bcf] focus:border-teal/40 focus:shadow-[0_0_0_3px_rgba(1,124,145,0.1)]"
        />
      </label>
      {tracked && (
        <button
          type="button"
          onClick={() => track(h, { status: "hidden" })}
          className="flex items-center gap-1.5 text-[13.5px] font-medium text-slate hover:text-ink-2"
        >
          <EyeOff className="h-3.5 w-3.5" strokeWidth={2.2} /> Not interested
        </button>
      )}
    </div>
  );
}

/** The small stage badge shown on cards and rows. */
export function StageBadge({ status, className }: { status: Stage; className?: string }) {
  return (
    <Badge tone="sky" size="sm" className={cn("gap-1 rounded-full px-2 align-middle", className)}>
      <BookmarkCheck className="h-3.5 w-3.5" strokeWidth={2.2} />
      {stageLabel(status)}
    </Badge>
  );
}
