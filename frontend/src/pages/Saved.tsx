import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { HackRow } from "../components/HackRow";
import { Icon } from "../components/Icon";
import { CompactBar, DueTag, EmptyState, LargeTitle, PrimaryButton, Segmented, StageTag, Thumb, useScrolled } from "../components/kit";
import type { Hackathon } from "../lib/api";
import { useAppearance } from "../lib/appearance";
import { daysLeft, prizeFull, prizeShort, timeAgo, weekdayDate } from "../lib/format";
import { press, rise, spring } from "../lib/motion";
import { type Stage, type Tracked, track, usePersonal } from "../lib/personal";
import { linkTo } from "../lib/router";
import { useData } from "../lib/store";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";

type Segment = "active" | "submitted" | "results" | "hidden";

interface Entry {
  id: string;
  t: Tracked;
  h: Hackathon;
}

function deadlineOrder(h: Hackathon): number {
  const d = Date.parse(h.registration_deadline ?? h.start_date ?? "");
  return Number.isNaN(d) ? Number.MAX_SAFE_INTEGER : d < Date.now() ? Number.MAX_SAFE_INTEGER - 1 : d;
}

let lastSegment: Segment = "active";

export function Saved() {
  const p = usePersonal();
  const d = useData();
  const look = useAppearance();
  const scrolled = useScrolled(52);
  const [segment, setSegmentState] = useState<Segment>(lastSegment);
  const setSegment = (s: Segment) => {
    lastSegment = s;
    setSegmentState(s);
  };
  const [openId, setOpenId] = useState<string | null>(null);

  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const [id, t] of Object.entries(p.items)) {
      const h = d.live.get(id) ?? t.hackathon;
      if (h) out.push({ id, t, h });
    }
    return out;
  }, [p.items, d.live]);

  const groups = useMemo(() => {
    const by = (stages: (Stage | null)[]) => entries.filter((e) => stages.includes(e.t.status));
    const active = by(["saved", "registered"]).sort((a, b) => deadlineOrder(a.h) - deadlineOrder(b.h));
    const soon = active.filter((e) => {
      const n = daysLeft(e.h);
      return n !== null && n >= 0 && n < 7;
    });
    const later = active.filter((e) => !soon.includes(e));
    const recent = (a: Entry, b: Entry) => Date.parse(b.t.updated_at) - Date.parse(a.t.updated_at);
    return {
      soon,
      later,
      notes: by([null]).sort(recent),
      submitted: by(["submitted"]).sort(recent),
      results: by(["won", "not_placed"]).sort(recent),
      hidden: by(["hidden"]).sort(recent),
    };
  }, [entries]);

  const counts: Record<Segment, number> = {
    active: groups.soon.length + groups.later.length + groups.notes.length,
    submitted: groups.submitted.length,
    results: groups.results.length,
    hidden: groups.hidden.length,
  };

  const status = !p.key
    ? "Saved on this device only"
    : p.syncing
      ? "Syncing…"
      : p.error === "offline"
        ? "Offline. Changes sync when the server answers."
        : p.error === "key"
          ? "The server didn't accept this device's key"
          : `Synced ${timeAgo(p.lastSync)}`;

  const list = (rows: Entry[]) => (
    <ul className="card mx-4 overflow-hidden rounded-[22px]">
      {rows.map((e, i) => (
        <HackRow key={e.id} h={e.h} index={i} last={i === rows.length - 1} stage={e.t.status} density={look.density} openId={openId} setOpenId={setOpenId} />
      ))}
    </ul>
  );

  return (
    <div className="pb-32">
      <CompactBar title="Saved" show={scrolled} />
      <LargeTitle
        title="Saved"
        subtitle={
          <span className="flex items-center gap-1.5">
            <Icon name={p.key && !p.error ? "cloudCheck" : "cloudOff"} size={14} stroke={2.2} />
            {status}
          </span>
        }
      />

      {!p.key && (
        <a href="/settings" onClick={linkTo("/settings")} className="mx-4 mt-4 flex items-center gap-3 rounded-[18px] bg-soft px-4 py-3">
          <Icon name="cloudOff" size={20} className="shrink-0 text-tint" />
          <span className="flex-1 text-subhead text-label">Connect this device in Settings to sync saved hackathons with your laptop and get notifications.</span>
          <Icon name="chevron" size={14} stroke={2.8} className="text-label-3" />
        </a>
      )}

      <Segmented<Segment>
        label="Stage"
        value={segment}
        onChange={setSegment}
        className="mx-4 mt-4"
        options={(["active", "submitted", "results", "hidden"] as Segment[]).map((s) => ({
          value: s,
          label: (
            <>
              {s === "active" ? "Active" : s === "submitted" ? "Submitted" : s === "results" ? "Results" : "Hidden"}
              <span className="text-[12.5px] font-medium text-label-2 tabular">{counts[s]}</span>
            </>
          ),
        }))}
      />

      {/* Keyed, so a new segment slides in (.swap-in in index.css). */}
      <div key={segment} className="swap-in">
          {segment === "active" &&
            (counts.active === 0 ? (
              <EmptyState
                icon="bookmark"
                title="Nothing saved yet"
                text="Swipe left on any hackathon and tap Save, or use the bookmark on its page. Deadlines show up here and on Today."
                action={
                  <PrimaryButton href="/explore" className="h-11 text-subhead">
                    Explore hackathons
                  </PrimaryButton>
                }
              />
            ) : (
              <>
                {groups.soon.length > 0 && (
                  <>
                    <h2 className="mx-5 mt-7 mb-2.5 text-title2 font-bold tracking-[-0.022em]">Closing this week</h2>
                    <div className="space-y-3 px-4">
                      {groups.soon.map((e, i) => (
                        <SoonCard key={e.id} e={e} index={i} />
                      ))}
                    </div>
                  </>
                )}
                {groups.later.length > 0 && (
                  <>
                    <h2 className="mx-5 mt-7 mb-2.5 text-title2 font-bold tracking-[-0.022em]">Later</h2>
                    {list(groups.later)}
                  </>
                )}
                {groups.notes.length > 0 && (
                  <>
                    <h2 className="mx-5 mt-7 mb-2.5 text-title2 font-bold tracking-[-0.022em]">Notes</h2>
                    {list(groups.notes)}
                  </>
                )}
              </>
            ))}
          {segment === "submitted" &&
            (groups.submitted.length ? <div className="mt-5">{list(groups.submitted)}</div> : <EmptyState icon="check" title="No submissions yet" text="Mark a hackathon Submitted on its page once your project is in." />)}
          {segment === "results" &&
            (groups.results.length ? <div className="mt-5">{list(groups.results)}</div> : <EmptyState icon="trophy" title="No results yet" text="Wins and the ones that didn't place land here." />)}
          {segment === "hidden" &&
            (groups.hidden.length ? (
              <ul className="card mx-4 mt-5 overflow-hidden rounded-[22px]">
                {groups.hidden.map((e, i) => (
                  <HiddenRow key={e.id} e={e} index={i} last={i === groups.hidden.length - 1} />
                ))}
              </ul>
            ) : (
              <EmptyState icon="eyeOff" title="Nothing hidden" text="Hackathons you mark Not interested disappear from your lists and wait here." />
            ))}
      </div>
    </div>
  );
}

function SoonCard({ e, index }: { e: Entry; index: number }) {
  const { h, t } = e;
  const days = daysLeft(h) ?? 0;
  const used = Math.min(1, Math.max(0.06, 1 - days / 14));
  const urgent = days <= 1;
  return (
    <motion.a href={`/h/${h.id}`} onClick={linkTo(`/h/${h.id}`)} {...rise(index, 4)} whileTap={press} className="card block rounded-[22px] p-4 pl-3.5">
      <div className="flex items-center gap-3">
        <Thumb h={h} size={52} radius={13} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-callout leading-[1.3] font-semibold tracking-[-0.015em]">{h.title}</div>
          <div className="mt-0.5 truncate text-footnote text-label-2">{[h.organizer, prizeFull(h), h.format === "online" ? "Online" : null].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="mt-3.5 flex items-center justify-between">
        <span className={cn("text-subhead font-semibold tabular", urgent ? "text-red" : "text-orange")}>
          {days === 0 ? "Closes today" : `${days} ${days === 1 ? "day" : "days"} left`} · {weekdayDate(h.registration_deadline)}
        </span>
        {t.status && <StageTag status={t.status} className="h-6 rounded-[8px] px-2.5 text-footnote" />}
      </div>
      <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-track">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${used * 100}%` }}
          transition={{ ...spring, delay: 0.1 + index * 0.05 }}
          className={cn("h-full rounded-full", urgent ? "bg-red-fill" : "bg-orange-fill")}
        />
      </div>
      {t.note && (
        <div className="mt-3 flex gap-2 rounded-[12px] bg-card-2 px-3 py-2.5 text-subhead leading-snug text-label-2">
          <Icon name="pencil" size={15} className="mt-0.5 shrink-0" />
          <span className="line-clamp-3 whitespace-pre-line">{t.note}</span>
        </div>
      )}
    </motion.a>
  );
}

function HiddenRow({ e, index, last }: { e: Entry; index: number; last: boolean }) {
  return (
    <motion.li {...rise(index)} className="flex items-center gap-3 pl-3.5">
      <a href={`/h/${e.h.id}`} onClick={linkTo(`/h/${e.h.id}`)} className="shrink-0 opacity-70">
        <Thumb h={e.h} size={48} radius={12} />
      </a>
      <div className={cn("flex min-h-[70px] min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-3", !last && "border-b hairline")}>
        <a href={`/h/${e.h.id}`} onClick={linkTo(`/h/${e.h.id}`)} className="min-w-0 flex-1">
          <div className="truncate text-callout font-semibold text-label-2">{e.h.title}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <DueTag h={e.h} />
            <span className="text-footnote text-label-2 tabular">{prizeShort(e.h)}</span>
          </div>
        </a>
        <motion.button
          type="button"
          whileTap={press}
          onClick={() => {
            track(e.h, { status: null });
            toast("Back in your lists", "check");
          }}
          className="h-8 shrink-0 rounded-full bg-fill px-3 text-footnote font-semibold text-tint"
        >
          Show again
        </motion.button>
      </div>
    </motion.li>
  );
}
