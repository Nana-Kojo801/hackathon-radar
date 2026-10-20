import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { TabActiveContext } from "../components/kit";
import { explainError } from "./errors";
import { call, usePersonal } from "./personal";

/**
 * "Refresh now" and its live progress (backend app/refresh.py). A run is the
 * GitHub Actions refresh, then the snapshot publish; the pipeline records the
 * step it's on and each source as it finishes, so the view can follow along.
 */

export interface GhRun {
  id: number;
  status: string; // queued, in_progress, completed (and a few waiting states)
  conclusion: string | null;
  event: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string | null;
  url: string | null;
}

export interface StepStats {
  [k: string]: number | string[] | undefined;
}

export interface RefreshStatus {
  configured: boolean;
  error: string | null;
  refresh: GhRun | null;
  publish: GhRun | null;
  pipeline: {
    id: number;
    started_at: string;
    finished_at: string | null;
    stage: string | null;
    progress: { plan?: { sources: string[] } } & Record<string, StepStats | undefined>;
    fetched: number;
    new: number;
    errors: number;
    tokens_used: number;
  } | null;
  sources: { source: string; started_at: string; finished_at: string | null; fetched: number; new: number; errors: number; error_text: string | null }[];
}

export const STEPS = [
  { key: "start", label: "Start on GitHub" },
  { key: "sources", label: "Search the platforms" },
  { key: "details", label: "Read hackathon pages" },
  { key: "enrich", label: "AI checks new listings" },
  { key: "polish", label: "Tidy descriptions" },
  { key: "artwork", label: "Find covers and logos" },
  { key: "alerts", label: "Send alerts" },
  { key: "publish", label: "Update the app" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

export type Phase =
  | { state: "idle" }
  | { state: "running"; step: StepKey }
  | { state: "done"; at: string }
  | { state: "failed"; step: StepKey; url: string | null };

const ACTIVE_GH = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);
/** A run the pipeline started this long ago and never finished was cut off. */
const STALE_MS = 45 * 60_000;

/** Where a run is, from GitHub's view of the workflows and the pipeline's own record. */
export function phaseOf(s: RefreshStatus | null, requestedAt: number | null, now = Date.now()): Phase {
  if (!s) return requestedAt ? { state: "running", step: "start" } : { state: "idle" };
  const p = s.pipeline;
  const r = s.refresh;
  // Just asked: GitHub takes a few seconds to list the new run.
  if (requestedAt && (!r || Date.parse(r.created_at) < requestedAt - 15_000)) return { state: "running", step: "start" };
  const pipelineOfRun = p && r && Date.parse(p.started_at) >= Date.parse(r.created_at) - 60_000 ? p : null;
  const stageStep = (stage: string | null | undefined): StepKey => (STEPS.some((x) => x.key === stage) ? (stage as StepKey) : "sources");

  if (r && ACTIVE_GH.has(r.status)) {
    if (!pipelineOfRun) return { state: "running", step: "start" };
    if (!pipelineOfRun.finished_at) return { state: "running", step: stageStep(pipelineOfRun.stage) };
    return { state: "running", step: "alerts" };
  }
  if (r && r.status === "completed") {
    if (r.conclusion !== "success") {
      const at: StepKey = !pipelineOfRun ? "start" : !pipelineOfRun.finished_at ? stageStep(pipelineOfRun.stage) : "alerts";
      return { state: "failed", step: at, url: r.url };
    }
    const pub = s.publish;
    if (!pub || ACTIVE_GH.has(pub.status)) {
      // The publish starts a moment after the refresh ends; give it a few minutes to show up.
      const ended = Date.parse(r.updated_at ?? r.created_at);
      if (pub || now - ended < 5 * 60_000) return { state: "running", step: "publish" };
    }
    return { state: "done", at: pub?.updated_at ?? r.updated_at ?? r.created_at };
  }
  // No GitHub view (no token): follow the pipeline alone.
  if (p && !p.finished_at && now - Date.parse(p.started_at) < STALE_MS) return { state: "running", step: stageStep(p.stage) };
  if (p?.finished_at) return { state: "done", at: p.finished_at };
  return { state: "idle" };
}

/** The latest run, polled quickly while one is going and slowly otherwise; only while Settings is on screen. */
export function useRefresh() {
  const key = usePersonal().key;
  const active = useContext(TabActiveContext);
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusProblem, setStatusProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const phase = phaseOf(status, requestedAt);
  const running = phase.state === "running";
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      setStatus(await call<RefreshStatus>("/me/refresh"));
      setStatusProblem(null);
    } catch (e) {
      // The next poll tries again; if the server is just old, say so.
      const x = explainError(e, "this");
      setStatusProblem(x.outdated ? x.text : null);
    } finally {
      inflight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!key || !active) return;
    void load();
    const every = running ? 3000 : 30_000;
    const id = window.setInterval(() => document.visibilityState === "visible" && void load(), every);
    return () => window.clearInterval(id);
  }, [key, active, running, load, tick]);

  // Once GitHub lists the run that was asked for, stop treating it as "just asked".
  useEffect(() => {
    if (requestedAt && status?.refresh && Date.parse(status.refresh.created_at) >= requestedAt - 15_000) setRequestedAt(null);
  }, [status, requestedAt]);

  const start = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await call("/me/refresh", { method: "POST" });
      setRequestedAt(Date.now());
      setTick((t) => t + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("409") ? "A refresh is already running." : msg.includes("503") ? "Needs a GitHub token on the server first." : explainError(e, "this").text);
      setTick((t) => t + 1);
    } finally {
      setStarting(false);
    }
  }, []);

  return { status, phase, start, starting, error: error ?? statusProblem };
}
