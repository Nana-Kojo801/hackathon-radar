import { motion } from "framer-motion";
import { Bookmark, CloudOff, Loader2, NotebookPen, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";

import { TopBar } from "../components/Brand";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { FieldSelect } from "../components/ui/select";
import type { Hackathon } from "../lib/api";
import { deadlineLabel, prizeText, sourceName, timeAgo } from "../lib/format";
import { STAGES, type Stage, type Tracked, track, usePersonal } from "../lib/personal";
import { navigate } from "../lib/router";
import { cn } from "../lib/utils";

type Tab = "active" | "submitted" | "results" | "notes" | "hidden";

const TABS: { id: Tab; label: string; stages: (Stage | null)[]; empty: string }[] = [
  { id: "active", label: "Active", stages: ["saved", "registered"], empty: "Hackathons you save or register for show up here, soonest deadline first." },
  { id: "submitted", label: "Submitted", stages: ["submitted"], empty: "Mark a hackathon as Submitted once your project is in." },
  { id: "results", label: "Results", stages: ["won", "not_placed"], empty: "Wins and the ones that didn't place." },
  { id: "notes", label: "Notes", stages: [null], empty: "Hackathons with a note but no stage." },
  { id: "hidden", label: "Not interested", stages: ["hidden"], empty: "Hackathons you hide from the list. You can bring them back here." },
];

interface Entry {
  id: string;
  t: Tracked;
  h: Hackathon;
}

function deadlineOrder(h: Hackathon): number {
  const d = Date.parse(h.registration_deadline ?? h.start_date ?? "");
  return Number.isNaN(d) ? Number.MAX_SAFE_INTEGER : d < Date.now() ? Number.MAX_SAFE_INTEGER - 1 : d;
}

export function MyHackathons({ live }: { live: Map<string, Hackathon> }) {
  const p = usePersonal();
  const [tab, setTab] = useState<Tab>("active");

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const [id, t] of Object.entries(p.items)) {
      const h = live.get(id) ?? t.hackathon;
      if (h) out.push({ id, t, h });
    }
    return out;
  }, [p.items, live]);

  const byTab = useMemo(() => {
    const m = new Map<Tab, Entry[]>();
    for (const tb of TABS) {
      const list = entries.filter((e) => tb.stages.includes(e.t.status));
      list.sort(tb.id === "active" ? (a, b) => deadlineOrder(a.h) - deadlineOrder(b.h) : (a, b) => Date.parse(b.t.updated_at) - Date.parse(a.t.updated_at));
      m.set(tb.id, list);
    }
    return m;
  }, [entries]);

  const current = TABS.find((x) => x.id === tab)!;
  const rows = byTab.get(tab) ?? [];

  return (
    <div>
      <TopBar />
      <section className="px-5 pt-5 pb-4 wide:px-7 wide:pt-7 wide:pb-5">
        <h1 className="text-[27px] leading-tight font-bold tracking-[-0.02em] text-ink wide:text-[42px]">My hackathons</h1>
        <p className="mt-1 flex items-center gap-2 text-[15px] text-periwinkle wide:text-[17px]">
          {!p.key ? (
            "Not connected on this device"
          ) : p.syncing ? (
            <>
              <Loader2 className="spin h-4 w-4" strokeWidth={2.2} /> Syncing…
            </>
          ) : p.error === "offline" ? (
            <>
              <CloudOff className="h-4 w-4" strokeWidth={2.2} /> Couldn't reach the server, showing what's saved here. It retries on its own.
            </>
          ) : p.error === "key" ? (
            "The server didn't accept this device's key. Check it in Settings."
          ) : (
            `Synced ${timeAgo(p.lastSync)}`
          )}
        </p>
      </section>

      {!p.key ? (
        <div className="mx-5 mb-8 rounded-[14px] border border-line bg-field px-5 py-5 wide:mx-7">
          <p className="text-[16px] text-ink-2">Connect this device to save hackathons, track your stage and keep notes. They sync between your phone and laptop.</p>
          <Button variant="primary" className="mt-3 h-11 rounded-[10px] px-4" onClick={() => navigate("/settings")}>
            Connect in Settings
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto border-b border-line px-5 pb-3 wide:px-7" role="tablist" aria-label="Stages">
            {TABS.map((tb) => {
              const n = byTab.get(tb.id)?.length ?? 0;
              return (
                <button
                  key={tb.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === tb.id}
                  onClick={() => setTab(tb.id)}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-[15px] font-medium transition-colors",
                    tab === tb.id ? "bg-ink text-white" : "bg-field text-ink-2 hover:bg-[#e9eef5]",
                  )}
                >
                  {tb.label}
                  <span className={cn("text-[13px]", tab === tb.id ? "text-white/75" : "text-slate")}>{n}</span>
                </button>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <p className="px-5 py-10 text-center text-[15.5px] text-slate wide:px-7">{current.empty}</p>
          ) : (
            <ul key={tab}>
              {rows.map((e, i) => (
                <MyRow key={e.id} e={e} index={i} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function MyRow({ e, index }: { e: Entry; index: number }) {
  const { h, t } = e;
  const ended = h.status === "ended";
  const deadline = deadlineLabel(h);
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: index * 0.03 }}
      className="border-b border-line px-5 py-4 last:border-b-0 wide:px-7 wide:py-5"
    >
      <div className="flex flex-col gap-3 wide:flex-row wide:items-start wide:justify-between wide:gap-8">
        <div className="min-w-0 flex-1">
          <a
            href={`/h/${h.id}`}
            onClick={(ev) => {
              if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
              ev.preventDefault();
              navigate(`/h/${h.id}`);
            }}
            className="text-[18px] leading-snug font-bold tracking-[-0.01em] text-ink hover:text-teal wide:text-[22px]"
          >
            {h.title}
          </a>
          <p className="mt-0.5 text-[14px] text-periwinkle">{[h.organizer, sourceName(h)].filter(Boolean).join(" · ")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink">{prizeText(h)}</span>
            {ended ? (
              <Badge tone="grey" size="sm" className="rounded-full">
                Event ended
              </Badge>
            ) : (
              deadline && (
                <Badge tone={deadline.tone} size="sm" className="rounded-full" title={deadline.full ?? undefined}>
                  {deadline.text}
                </Badge>
              )
            )}
          </div>
          {t.note && (
            <p className="mt-2 flex gap-2 text-[14px] leading-snug whitespace-pre-line text-ink-2">
              <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-slate" strokeWidth={2} />
              <span className="line-clamp-3">{t.note}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-end gap-2 wide:w-[230px]">
          {t.status === "hidden" ? (
            <Button variant="outline" className="h-10 rounded-[10px] px-3.5 text-[14.5px] text-ink-2" onClick={() => track(h, { status: null })}>
              <Undo2 className="h-4 w-4" strokeWidth={2.2} /> Show in list again
            </Button>
          ) : t.status === null ? (
            <Button variant="soft" className="h-10 rounded-[10px] px-3.5 text-[14.5px]" onClick={() => track(h, { status: "saved" })}>
              <Bookmark className="h-4 w-4" strokeWidth={2.2} /> Save
            </Button>
          ) : (
            <FieldSelect
              value={t.status}
              onChange={(v) => track(h, { status: v })}
              options={STAGES}
              className="w-full"
              triggerClassName="h-10 w-full"
            />
          )}
        </div>
      </div>
    </motion.li>
  );
}
