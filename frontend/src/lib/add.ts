import { useSyncExternalStore } from "react";

import { API_URL, type Format, type Hackathon, type HackathonDetail } from "./api";
import { personalState } from "./personal";

/**
 * Add a hackathon the radar hasn't found (backend app/add.py): find it from a link, a name or a
 * shared post, confirm the details, and it's stored as a listing and saved to your list.
 */

export interface Candidate {
  title: string;
  url: string;
  organizer: string | null;
  prize_text: string | null;
  location_text: string | null;
  dates_text: string | null;
  start_date: string | null;
  end_date: string | null;
  registration_deadline: string | null;
  format: Format;
  description: string | null;
  /** Already on the radar: its id. */
  existing_id?: string | null;
  /** Pictures from its page, shown while you pick and kept on the listing. */
  banner_url?: string | null;
  logo_url?: string | null;
}

export class AddError extends Error {}

/**
 * One request, with the server's own explanation on failure. Finding takes a while (a search,
 * reading pages, the AI), so the wait is long; a sleeping server gets one more try.
 */
async function request<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const key = personalState().key;
  if (!key) throw new AddError("Connect this device in Settings first.");
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { "X-Personal-Key": key, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(100_000),
      });
    } catch {
      if (attempt < 1) continue;
      throw new AddError("Couldn't reach the server. It may be waking up; try again in a minute.");
    }
    if (res.status === 204) return undefined as T;
    if (res.ok) return (await res.json()) as T;
    const detail = await res
      .json()
      .then((j: { detail?: unknown }) => (typeof j.detail === "string" ? j.detail : null))
      .catch(() => null);
    if (res.status === 401) throw new AddError("The server didn't accept this device's key. Reconnect it in Settings.");
    if (res.status === 404) throw new AddError("The server is running an older version without this. Redeploy it from main.");
    throw new AddError(detail ?? `Something went wrong on the server (HTTP ${res.status}). Try again.`);
  }
}

export function findHackathon(text: string): Promise<{ candidates: Candidate[]; searched: boolean }> {
  return request("/me/add/find", { text });
}

export function addHackathon(c: Candidate): Promise<{ hackathon: Hackathon; created: boolean }> {
  const { existing_id: _, ...body } = c;
  return request("/me/add", body);
}

/** Change a hackathon you added; returns it as its page shows it. */
export function editHackathon(id: string, c: Candidate): Promise<HackathonDetail> {
  const { existing_id: _, ...body } = c;
  return request(`/me/add/${id}`, body, "PATCH");
}

export function deleteHackathon(id: string): Promise<void> {
  return request(`/me/add/${id}`, null, "DELETE");
}

/** A listing's fields as the form edits them. */
export function toCandidate(h: Hackathon | HackathonDetail): Candidate {
  const day = (iso: string | null) => iso?.slice(0, 10) ?? null;
  return {
    title: h.title,
    url: h.source_url,
    organizer: h.organizer,
    prize_text: h.prize_text,
    location_text: h.location_text,
    dates_text: null,
    start_date: day(h.start_date),
    end_date: day(h.end_date),
    registration_deadline: day(h.registration_deadline),
    format: h.format,
    description: ("description" in h ? h.description : null) ?? h.summary,
    banner_url: h.banner_url ?? null,
    logo_url: h.logo_url ?? h.icon_url ?? null,
  };
}

// ---------------------------------------------------------------- the sheet, opened from anywhere

export interface SheetRequest {
  text: string;
  seq: number;
  /** Editing a hackathon you added (or, with remove, confirming its deletion). */
  edit?: { id: string; c: Candidate; remove?: boolean };
}

let open: SheetRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

/** Open the Add a hackathon sheet, optionally with text filled in (a search, a shared post). */
export function openAdd(text = ""): void {
  open = { text, seq: ++seq };
  listeners.forEach((l) => l());
}

/** Open the sheet to edit a hackathon you added, or straight at "delete it?". */
export function openEdit(h: Hackathon | HackathonDetail, opts: { remove?: boolean } = {}): void {
  open = { text: "", seq: ++seq, edit: { id: h.id, c: toCandidate(h), remove: opts.remove } };
  listeners.forEach((l) => l());
}

export function closeAdd(): void {
  open = null;
  listeners.forEach((l) => l());
}

export function useAddSheet(): SheetRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}
