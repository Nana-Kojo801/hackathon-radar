import { motion } from "framer-motion";
import { type ReactNode, useEffect, useState } from "react";

import { countdown, SOURCE_NAME, timeAgo } from "../lib/format";
import { bouncy, press } from "../lib/motion";
import { type Phase, type RefreshStatus, STEPS, type StepKey, useRefresh } from "../lib/refresh";
import { navigate } from "../lib/router";
import { checkForNewData } from "../lib/store";
import { cn } from "../lib/utils";
import { Icon } from "./Icon";

/**
 * "Run the search" in Settings: a button, and while a run is going, where it
 * is: each platform as it's searched (found / new), then the AI, tidying,
 * covers, alerts and publishing steps, with a timer.
 */
export function RefreshCard() {
  const { status, phase, start, starting, error, lastRun, next, late } = useRefresh();
  const running = phase.state === "running";
  const stepIndex = running || phase.state === "failed" ? STEPS.findIndex((s) => s.key === phase.step) : phase.state === "done" ? STEPS.length : -1;
  const since = runStart(status);
  const now = useNow(running ? 1000 : 30_000);
  const totals = sourceTotals(status);
  // When a run has finished (seen here or not), load the fresh list if the app doesn't have it yet.
  const doneAt = phase.state === "done" ? phase.at : null;
  useEffect(() => {
    if (doneAt) checkForNewData();
  }, [doneAt]);
  // Show the steps while running, and for a while after a run ends.
  const recent = phase.state === "failed" || (phase.state === "done" && now - Date.parse(phase.at) < 15 * 60_000);
  const showSteps = running || recent;
  // The steps fold away: open while a run is going (or just failed), folded once it's done, unless
  // you open or close them yourself. A new run opens them again.
  const [expanded, setExpanded] = useState<boolean | null>(null);
  useEffect(() => {
    if (running) setExpanded(null);
  }, [running]);
  const stepsOpen = expanded ?? (running || phase.state === "failed");

  return (
    <section className="mx-4 mt-6">
      <h3 className="mx-4 mb-1.5 text-footnote font-medium tracking-[0.01em] text-label-2 uppercase">Search</h3>
      <div className="card overflow-hidden rounded-[22px]">
        <div className="flex items-center gap-3 p-3.5">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]", phase.state === "failed" ? "bg-red-soft text-red" : phase.state === "done" && recent ? "bg-green-soft text-green" : "bg-soft text-tint")}>
            <Icon name={phase.state === "failed" ? "alert" : phase.state === "done" && recent ? "check" : late ? "clock" : "refresh"} size={22} stroke={2.2} className={cn(running && "spin")} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-body font-semibold tracking-[-0.02em]">{late && !recent ? "Waiting for the scheduled run" : title(phase, recent)}</div>
            <div className="text-footnote text-label-2">
              {late && !recent
                ? `It was due ${timeAgo(new Date(next.at).toISOString(), now)}. GitHub often starts scheduled runs late; its steps show here once it starts.`
                : subtitle(phase, totals, since, now, recent, lastRun, next.at)}
            </div>
          </div>
          {running ? (
            <span className="shrink-0 text-subhead font-semibold text-label-2 tabular">{since ? countdown(now - since).replace(/^0:/, "") : ""}</span>
          ) : (
            <motion.button
              type="button"
              whileTap={press}
              transition={bouncy}
              disabled={starting || !status?.configured}
              onClick={() => void start()}
              className="h-9 shrink-0 rounded-full bg-accent px-4 text-subhead font-semibold text-on-accent disabled:opacity-40"
            >
              {starting ? "Starting…" : "Run now"}
            </motion.button>
          )}
        </div>

        {(running || phase.state === "failed") && (
          <div className="mx-3.5 mb-3 h-1 overflow-hidden rounded-full bg-fill">
            <div
              className={cn("h-full rounded-full transition-[width] duration-700 ease-out", phase.state === "failed" ? "bg-red-fill" : "bg-accent")}
              style={{ width: `${Math.max(6, ((stepIndex + 0.5) / STEPS.length) * 100)}%` }}
            />
          </div>
        )}

        {showSteps && (
          <button
            type="button"
            aria-expanded={stepsOpen}
            onClick={() => setExpanded(!stepsOpen)}
            className="flex h-11 w-full items-center justify-between border-t hairline px-3.5 text-subhead font-medium text-tint"
          >
            {stepsOpen ? "Hide the steps" : `Show the steps${running ? "" : phase.state === "failed" ? " (stopped)" : " (all done)"}`}
            <Icon name="chevronDown" size={14} stroke={2.6} className={cn("transition-transform duration-200", stepsOpen && "rotate-180")} />
          </button>
        )}
        {showSteps && stepsOpen && (
          <ol className="border-t hairline px-3.5 py-3">
            {STEPS.map((s, i) => (
              <Step key={s.key} label={s.label} state={i < stepIndex ? "done" : i === stepIndex && running ? "now" : i === stepIndex && phase.state === "failed" ? "failed" : "todo"} detail={detail(s.key, status)} last={i === STEPS.length - 1}>
                {s.key === "sources" && i <= stepIndex && <Sources status={status} />}
              </Step>
            ))}
          </ol>
        )}

        {(error || status?.error || (status && !status.configured)) && (
          <p className="border-t hairline px-3.5 py-2.5 text-footnote text-label-2">
            {error ?? status?.error ?? "To run it from here, add a GITHUB_TOKEN on the server (see README › Refresh now). Scheduled runs still show here."}
          </p>
        )}
        {phase.state === "done" && recent && totals.new > 0 && (
          <button type="button" onClick={() => navigate("/explore?new=1")} className="flex h-11 w-full items-center gap-1 border-t hairline px-3.5 text-subhead font-semibold text-tint">
            See {totals.new} new {totals.new === 1 ? "hackathon" : "hackathons"}
            <Icon name="chevron" size={13} />
          </button>
        )}
        {(phase.state === "failed" || (running && status?.refresh?.url)) && status?.refresh?.url && (
          <a href={status.refresh.url} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center gap-1 border-t hairline px-3.5 text-subhead font-medium text-tint">
            View the run on GitHub
            <Icon name="arrowUpRight" size={13} />
          </a>
        )}
      </div>
    </section>
  );
}

function Step({ label, state, detail, last, children }: { label: string; state: "done" | "now" | "failed" | "todo"; detail: string | null; last: boolean; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-2.5 last:pb-0">
      {!last && <span aria-hidden="true" className={cn("absolute top-[22px] bottom-0 left-[10px] w-[2px] rounded-full", state === "done" ? "bg-accent" : "bg-fill")} />}
      <span
        className={cn(
          "relative z-[1] mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full",
          state === "done" && "bg-accent text-on-accent",
          state === "now" && "bg-soft text-tint",
          state === "failed" && "bg-red-fill text-white",
          state === "todo" && "bg-fill text-label-3",
        )}
      >
        {state === "done" ? <Icon name="check" size={13} stroke={3} /> : state === "now" ? <Icon name="refresh" size={13} stroke={2.6} className="spin" /> : state === "failed" ? <Icon name="close" size={12} stroke={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      </span>
      <div className="min-w-0 flex-1 pt-px">
        <div className={cn("text-subhead leading-tight", state === "todo" ? "text-label-2" : "font-semibold")}>{label}</div>
        {detail && state !== "todo" && <div className="text-footnote text-label-2">{detail}</div>}
        {children}
      </div>
    </li>
  );
}

/** Each platform: searched (found, new), searching now, or waiting. */
function Sources({ status }: { status: RefreshStatus | null }) {
  const rows = status?.sources ?? [];
  const plan = status?.pipeline?.progress.plan?.sources ?? rows.map((r) => r.source);
  if (!plan.length) return null;
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
      {plan.map((name) => {
        const r = rows.find((x) => x.source === name);
        const label = name === "web" ? "Web" : (SOURCE_NAME[name] ?? name);
        return (
          <div key={name} className="flex items-center gap-1.5 text-footnote">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !r ? "bg-label-3" : !r.finished_at ? "animate-pulse bg-accent" : r.errors && !r.fetched ? "bg-red-fill" : "bg-green")} />
            <span className={cn("min-w-0 flex-1 truncate", !r && "text-label-2")}>{label}</span>
            <span className="shrink-0 text-label-2 tabular">{!r ? "" : !r.finished_at ? "…" : r.errors && !r.fetched ? "failed" : `${r.fetched}${r.new ? ` · ${r.new} new` : ""}`}</span>
          </div>
        );
      })}
    </div>
  );
}

function useNow(every: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(id);
  }, [every]);
  return now;
}

function runStart(s: RefreshStatus | null): number | null {
  const t = s?.refresh?.started_at ?? s?.refresh?.created_at ?? s?.pipeline?.started_at;
  return t ? Date.parse(t) : null;
}

function sourceTotals(s: RefreshStatus | null) {
  const rows = s?.sources ?? [];
  return { found: rows.reduce((n, r) => n + r.fetched, 0), new: rows.reduce((n, r) => n + r.new, 0) };
}

const num = (v: unknown) => (typeof v === "number" ? v : 0);

function detail(step: StepKey, s: RefreshStatus | null): string | null {
  const p = s?.pipeline?.progress ?? {};
  switch (step) {
    case "start":
      return s?.refresh?.status === "queued" ? "Waiting for a GitHub runner" : "Setting up";
    case "sources": {
      const t = sourceTotals(s);
      return t.found ? `${t.found} found · ${t.new} new` : null;
    }
    case "details":
      return p.details ? `${num(p.details.fetched)} pages read` : null;
    case "enrich":
      return p.enrich ? `${num(p.enrich.enriched)} checked${num(p.enrich.dropped) ? `, ${num(p.enrich.dropped)} weren't real hackathons` : ""}` : null;
    case "polish":
      return p.polish ? `${num(p.polish.polished)} tidied` : null;
    case "artwork":
      return p.artwork ? `${num(p.artwork.covers)} covers · ${num(p.artwork.logos)} logos` : null;
    case "alerts":
      return "Emails and notifications for new matches";
    case "publish":
      return "So the app loads the new list";
  }
}

function title(phase: Phase, recent: boolean): string {
  if (phase.state === "running") return STEPS.find((s) => s.key === phase.step)?.label ?? "Running";
  if (phase.state === "failed") return "The last run stopped";
  if (phase.state === "done" && recent) return "Search finished";
  return "Run the search";
}

function subtitle(phase: Phase, totals: { found: number; new: number }, since: number | null, now: number, recent: boolean, lastRun: string | null, nextAt: number): string {
  if (phase.state === "running") return totals.found ? `${totals.found} found so far · ${totals.new} new` : "Started just now";
  if (phase.state === "failed") return `At "${STEPS.find((x) => x.key === phase.step)?.label}". The next scheduled run tries again.`;
  if (phase.state === "done" && recent) return `${totals.new} new · finished ${timeAgo(phase.at, now)}${since ? ` · took ${countdown(Date.parse(phase.at) - since).replace(/^0:/, "")}` : ""}`;
  const at = new Date(nextAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const mins = Math.max(1, Math.round((nextAt - now) / 60_000));
  const inWords = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  return `${lastRun ? `Last run ${timeAgo(lastRun, now)}. ` : ""}Next around ${at}, in ${inWords}.`;
}
