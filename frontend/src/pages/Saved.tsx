import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { HackRow } from "../components/HackRow";
import { Icon } from "../components/Icon";
import { CompactBar, DeskHeader, DueTag, EmptyState, GlassButton, LargeTitle, PrimaryButton, Segmented, StageTag, Thumb, useScrolled } from "../components/kit";
import type { Hackathon } from "../lib/api";
import { meta } from "../components/HackRow";
import { useAppearance } from "../lib/appearance";
import { openAdd } from "../lib/add";
import { useDesktop } from "../lib/desktop";
import { daysLeft, prizeFull, prizeShort, timeAgo, weekdayDate } from "../lib/format";
import { press, rise, spring } from "../lib/motion";
import { type Stage, type Tracked, track, usePersonal } from "../lib/personal";
import { prefetchOn } from "../lib/prefetch";
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
  const desktop = useDesktop();
  const [showHidden, setShowHidden] = useState(false);

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

  const statusLine = (
    <span className="flex items-center gap-1.5">
      <Icon name={p.key && !p.error ? "cloudCheck" : "cloudOff"} size={14} stroke={2.2} />
      {status}
    </span>
  );

  if (desktop) {
    const hiddenList = groups.hidden.length ? (
      <ul className="card overflow-hidden rounded-[22px]">
        {groups.hidden.map((e, i) => (
          <HiddenRow key={e.id} e={e} index={i} last={i === groups.hidden.length - 1} />
        ))}
      </ul>
    ) : (
      <EmptyState icon="eyeOff" title="Nothing hidden" text="Hackathons you mark Not interested disappear from your lists and wait here." />
    );
    return (
      <div className="mx-auto max-w-[1240px] px-10 pt-8 pb-16">
        <DeskHeader
          title={showHidden ? "Hidden" : "Saved"}
          subtitle={showHidden ? "Hackathons you marked Not interested" : statusLine}
          accessory={
            <>
            <button
              type="button"
              onClick={() => openAdd()}
              className="flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-subhead font-semibold text-on-accent hover:brightness-110"
            >
              <Icon name="plus" size={17} stroke={2.6} />
              Add a hackathon
            </button>
            <button
              type="button"
              aria-pressed={showHidden}
              onClick={() => setShowHidden((v) => !v)}
              className="flex h-10 items-center gap-2 rounded-full bg-fill px-4 text-subhead font-semibold text-label hover:bg-[color-mix(in_srgb,var(--fill)_100%,var(--label)_6%)]"
            >
              <Icon name={showHidden ? "bookmark" : "eyeOff"} size={17} />
              {showHidden ? "Back to the board" : "Hidden"}
              {!showHidden && <span className="text-label-2 tabular">{groups.hidden.length}</span>}
            </button>
            </>
          }
        />
        {!p.key && (
          <a href="/settings" onClick={linkTo("/settings")} className="mt-4 flex items-center gap-3 rounded-[18px] bg-soft px-4 py-3">
            <Icon name="cloudOff" size={20} className="shrink-0 text-tint" />
            <span className="flex-1 text-subhead text-label">Connect this device in Settings to sync saved hackathons with your phone and get notifications.</span>
            <Icon name="chevron" size={14} stroke={2.8} className="text-label-3" />
          </a>
        )}
        <div className="mt-6">
          {showHidden ? (
            hiddenList
          ) : entries.length - groups.hidden.length === 0 ? (
            <EmptyState
              icon="bookmark"
              title="Nothing saved yet"
              text="Save hackathons from Explore or their page. They line up here by stage: saved, registered, submitted and results."
              action={
                <PrimaryButton href="/explore" className="h-11 text-subhead">
                  Explore hackathons
                </PrimaryButton>
              }
            />
          ) : (
            <Board groups={groups} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-32">
      <CompactBar title="Saved" show={scrolled} />
      <LargeTitle title="Saved" subtitle={statusLine} accessory={<GlassButton label="Add a hackathon" icon="plus" size={40} onClick={() => openAdd()} />} />

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
    <motion.a href={`/h/${h.id}`} onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)} {...rise(index, 4)} whileTap={press} className="card block rounded-[22px] p-4 pl-3.5">
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
      <a href={`/h/${e.h.id}`} onClick={linkTo(`/h/${e.h.id}`)} {...prefetchOn(e.h)} className="shrink-0 opacity-70">
        <Thumb h={e.h} size={48} radius={12} />
      </a>
      <div className={cn("flex min-h-[70px] min-w-0 flex-1 items-center gap-2.5 py-2.5 pr-3", !last && "border-b hairline")}>
        <a href={`/h/${e.h.id}`} onClick={linkTo(`/h/${e.h.id}`)} {...prefetchOn(e.h)} className="min-w-0 flex-1">
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

// ---------------------------------------------------------------- desktop board

type Column = "saved" | "registered" | "submitted" | "results";

const COLUMNS: { key: Column; title: string; hint: string; dot: string }[] = [
  { key: "saved", title: "Saved", hint: "Register before these close", dot: "var(--accent)" },
  { key: "registered", title: "Registered", hint: "Build and submit", dot: "#34C759" },
  { key: "submitted", title: "Submitted", hint: "Waiting on the judges", dot: "#AF52DE" },
  { key: "results", title: "Results", hint: "How it went", dot: "var(--orange-fill)" },
];

const MOVED: Record<string, string> = { saved: "Saved", registered: "Registered", submitted: "Submitted", won: "Won. Congratulations!", not_placed: "Didn't place" };

/**
 * Saved hackathons as a board, one column per stage. Drag a card to the next column to move it
 * on; the Results column splits into Won and Didn't place while you drag.
 */
function Board({ groups }: { groups: { soon: Entry[]; later: Entry[]; notes: Entry[]; submitted: Entry[]; results: Entry[] } }) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const active = [...groups.soon, ...groups.later];
  const lists: Record<Column, Entry[]> = {
    saved: [...active.filter((e) => e.t.status === "saved"), ...groups.notes],
    registered: active.filter((e) => e.t.status === "registered"),
    submitted: groups.submitted,
    results: groups.results,
  };
  const all = Object.values(lists).flat();
  const drop = (status: Stage) => {
    const e = all.find((x) => x.id === drag);
    setDrag(null);
    setOver(null);
    if (!e || e.t.status === status) return;
    track(e.h, { status });
    toast(MOVED[status] ?? "Moved", "check");
  };
  const target = (key: string, status: Stage) => ({
    onDragOver: (ev: React.DragEvent) => {
      if (!drag) return;
      ev.preventDefault();
      ev.stopPropagation();
      ev.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDrop: (ev: React.DragEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      drop(status);
    },
  });

  return (
    <>
      <div className="grid grid-cols-4 items-start gap-4">
        {COLUMNS.map((c) => {
          const list = lists[c.key];
          const droppable = c.key !== "results";
          return (
            <section
              key={c.key}
              aria-label={c.title}
              {...(droppable ? target(c.key, c.key as Stage) : {})}
              onDragLeave={(ev) => !ev.currentTarget.contains(ev.relatedTarget as Node) && over === c.key && setOver(null)}
              className={cn(
                "flex min-h-[260px] min-w-0 flex-col gap-2.5 rounded-[22px] bg-fill p-3 transition-shadow",
                over === c.key && "shadow-[inset_0_0_0_2px_var(--accent)]",
              )}
            >
              <div className="flex items-center gap-2 px-1.5 pt-1">
                <span className="h-2 w-2 rounded-full" style={{ background: c.dot }} />
                <h2 className="text-callout font-bold">{c.title}</h2>
                <span className="ml-auto text-footnote font-semibold text-label-2 tabular">{list.length}</span>
              </div>
              <p className="-mt-1.5 px-1.5 text-caption text-label-2">{c.hint}</p>
              {list.map((e) => (
                <BoardCard key={e.id} e={e} dragging={drag === e.id} onDrag={setDrag} onDragEnd={() => (setDrag(null), setOver(null))} />
              ))}
              {c.key === "results" && drag && (
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["won", "Won", "trophy"],
                      ["not_placed", "Didn't place", "flag"],
                    ] as const
                  ).map(([status, label, icon]) => (
                    <div
                      key={status}
                      {...target(status, status)}
                      className={cn(
                        "flex h-20 flex-col items-center justify-center gap-1 rounded-[14px] border-2 border-dashed text-footnote font-semibold",
                        over === status ? "border-accent bg-soft text-ink" : "border-[var(--sep)] text-label-2",
                      )}
                    >
                      <Icon name={icon} size={18} />
                      {label}
                    </div>
                  ))}
                </div>
              )}
              {!list.length && !drag && <p className="px-1.5 py-6 text-center text-footnote text-label-2">Nothing here yet</p>}
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-center text-footnote text-label-2">Drag a card to another column to move it on, or open it to update your progress and notes.</p>
    </>
  );
}

function BoardCard({ e, dragging, onDrag, onDragEnd }: { e: Entry; dragging: boolean; onDrag: (id: string) => void; onDragEnd: () => void }) {
  const { h, t } = e;
  const footer =
    t.status === "won" ? (
      <span className="inline-flex h-6 items-center gap-1 rounded-[7px] bg-[var(--gold-bg)] px-2 text-footnote font-semibold text-[var(--gold-fg)] shadow-[inset_0_0_0_1px_var(--gold-ring)]">
        <Icon name="trophy" size={13} filled />
        Won
      </span>
    ) : t.status === "not_placed" ? (
      <span className="inline-flex h-6 items-center rounded-[7px] bg-neutral-soft px-2 text-footnote font-semibold text-label-2">Didn't place</span>
    ) : t.status === "submitted" ? (
      <span className="text-footnote text-label-2">Submitted {timeAgo(t.updated_at)}</span>
    ) : t.status === "registered" && h.end_date && (daysLeft(h) ?? -1) < 0 ? (
      <span className="text-footnote text-label-2">Ends {weekdayDate(h.end_date)}</span>
    ) : (
      <DueTag h={h} />
    );
  return (
    <a
      href={`/h/${h.id}`}
      onClick={linkTo(`/h/${h.id}`)} {...prefetchOn(h)}
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData("text/plain", e.id);
        ev.dataTransfer.effectAllowed = "move";
        onDrag(e.id);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "card flex cursor-grab flex-col gap-2.5 rounded-[16px] p-3 transition-[opacity,transform] hover:-translate-y-px active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <span className="flex gap-2.5">
        <Thumb h={h} size={36} radius={10} />
        <span className="min-w-0">
          <span className="line-clamp-2 text-subhead leading-snug font-semibold">{h.title}</span>
          <span className="block truncate text-caption text-label-2">{meta(h)}</span>
        </span>
      </span>
      {t.note && (
        <span className="flex gap-1.5 text-caption text-label-2">
          <Icon name="pencil" size={12} className="mt-px shrink-0" />
          <span className="line-clamp-2">{t.note}</span>
        </span>
      )}
      <span className="flex items-center justify-between gap-2">
        {footer}
        <span className="text-subhead font-bold tabular">{prizeShort(h)}</span>
      </span>
    </a>
  );
}
