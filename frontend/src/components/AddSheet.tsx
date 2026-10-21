import { type ReactNode, useEffect, useRef, useState } from "react";

import { AddError, addHackathon, type Candidate, closeAdd, deleteHackathon, editHackathon, findHackathon, useAddSheet } from "../lib/add";
import type { Format } from "../lib/api";
import { fallbackArt, hostOf } from "../lib/format";
import { forget, personalState, track, usePersonal } from "../lib/personal";
import { putDetail } from "../lib/prefetch";
import { goBack, linkTo, navigate } from "../lib/router";
import { checkForNewData, useData } from "../lib/store";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";
import { Icon } from "./Icon";
import { GlassButton, PrimaryButton, Segmented, Sheet } from "./kit";

type Phase = "input" | "finding" | "results";

const FORMATS: { value: Format; label: string }[] = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
  { value: "unknown", label: "Not sure" },
];

/**
 * Add a hackathon the radar hasn't found. Paste a link, type its name, or share a post to the
 * app; the server reads or searches the web and the AI picks out the details. You check them
 * (anything not found is left empty, never guessed), and it's added to Explore and saved.
 */
export function AddSheet() {
  const req = useAddSheet();
  const p = usePersonal();
  const d = useData();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Candidate[]>([]);
  const [pick, setPick] = useState(0);
  const [draft, setDraft] = useState<Candidate | null>(null);
  const [adding, setAdding] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  // Editing a hackathon you added, and whether its deletion is being confirmed.
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const run = useRef(0);

  const find = async (t: string) => {
    const mine = ++run.current;
    setPhase("finding");
    setError(null);
    setStartedAt(Date.now());
    try {
      const r = await findHackathon(t.trim());
      if (mine !== run.current) return;
      setFound(r.candidates);
      setPick(0);
      setDraft(r.candidates[0] ?? null);
      setPhase("results");
    } catch (e) {
      if (mine !== run.current) return;
      setError(e instanceof AddError ? e.message : "Something went wrong. Try again.");
      setPhase("input");
    }
  };

  // Opened with text (a search with no results, a shared post): start right away.
  useEffect(() => {
    if (!req) return;
    run.current++;
    setText(req.text);
    setPhase("input");
    setError(null);
    setFound([]);
    setDraft(null);
    setAdding(false);
    setEditId(req.edit?.id ?? null);
    setConfirmRemove(!!req.edit?.remove);
    if (req.edit) {
      setDraft(req.edit.c);
      setPhase("results");
    } else if (req.text.trim() && personalState().key) void find(req.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.seq]);

  const close = () => {
    run.current++;
    closeAdd();
  };

  const add = async () => {
    if (!draft) return;
    setAdding(true);
    setError(null);
    try {
      const r = await addHackathon(draft);
      d.addLocal(r.hackathon);
      track(r.hackathon, { status: "saved" });
      close();
      navigate(`/h/${r.hackathon.id}`);
      toast(r.created ? "Added and saved" : "Saved", "bookmark");
      // The server finds its artwork and details and republishes the list within a minute or so.
      if (r.created) for (const s of [25, 50, 90, 150]) window.setTimeout(checkForNewData, s * 1000);
    } catch (e) {
      setError(e instanceof AddError ? e.message : "Couldn't add it. Try again.");
      setAdding(false);
    }
  };

  const save = async () => {
    if (!draft || !editId) return;
    setAdding(true);
    setError(null);
    try {
      const updated = await editHackathon(editId, draft);
      putDetail(updated);
      d.addLocal(updated);
      close();
      toast("Changes saved", "check");
      // The AI reads it again (summary, prize amount, themes) and the list is republished.
      for (const s of [25, 50, 90]) window.setTimeout(checkForNewData, s * 1000);
    } catch (e) {
      setError(e instanceof AddError ? e.message : "Couldn't save the changes. Try again.");
      setAdding(false);
    }
  };

  const remove = async () => {
    if (!editId) return;
    setAdding(true);
    setError(null);
    try {
      await deleteHackathon(editId);
      forget(editId);
      d.removeLocal(editId);
      close();
      if (window.location.pathname === `/h/${editId}`) goBack();
      toast("Hackathon deleted", "check");
    } catch (e) {
      setError(e instanceof AddError ? e.message : "Couldn't delete it. Try again.");
      setAdding(false);
    }
  };

  const openExisting = (id: string) => {
    const h = d.live.get(id);
    if (h) track(h, { status: "saved" });
    close();
    navigate(`/h/${id}`);
    if (h) toast("Saved", "bookmark");
  };

  const footer =
    editId && draft ? (
      confirmRemove ? (
        <div className="flex gap-2.5">
          <PrimaryButton tone="fill" onClick={() => setConfirmRemove(false)} disabled={adding} className="flex-1">
            Keep it
          </PrimaryButton>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={adding}
            className="flex h-[52px] flex-1 items-center justify-center rounded-full bg-red-fill text-body font-semibold text-white disabled:opacity-45"
          >
            {adding ? "Deleting…" : "Delete"}
          </button>
        </div>
      ) : (
        <PrimaryButton onClick={() => void save()} disabled={adding || !draft.title.trim() || !/^https?:\/\/\S+\.\S+/.test(draft.url)} className="w-full">
          {adding ? "Saving…" : "Save changes"}
        </PrimaryButton>
      )
    ) : phase === "results" && draft ? (
      draft.existing_id ? (
        <PrimaryButton onClick={() => openExisting(draft.existing_id!)} className="w-full">
          Open and save it
        </PrimaryButton>
      ) : (
        <PrimaryButton onClick={() => void add()} disabled={adding || !draft.title.trim() || !/^https?:\/\/\S+\.\S+/.test(draft.url)} className="w-full">
          {adding ? "Adding…" : "Add and save"}
        </PrimaryButton>
      )
    ) : phase === "input" && p.key ? (
      <PrimaryButton onClick={() => void find(text)} disabled={text.trim().length < 2} className="w-full">
        Find it
      </PrimaryButton>
    ) : undefined;

  return (
    <Sheet
      open={!!req}
      onOpenChange={(v) => !v && close()}
      title={editId ? (confirmRemove ? "Delete hackathon" : "Edit hackathon") : "Add a hackathon"}
      description={editId ? "Change or delete a hackathon you added." : "Find a hackathon from a link or its name and add it to your list."}
      left={<GlassButton label="Close" icon="close" size={40} onClick={close} />}
      right={
        phase === "results" && !editId ? (
          <button type="button" onClick={() => setPhase("input")} className="h-10 rounded-full bg-fill px-3.5 text-subhead font-semibold">
            Search again
          </button>
        ) : undefined
      }
      footer={footer}
    >
      {!p.key ? (
        <div className="px-3 py-6 text-center">
          <p className="text-callout font-semibold">Connect this device first</p>
          <p className="mt-1 text-subhead text-label-2">Adding uses the radar's AI on your server, so it needs your personal key.</p>
          <a href="/settings" onClick={(e) => (close(), linkTo("/settings")(e))} className="mt-4 inline-flex h-11 items-center rounded-full bg-accent px-5 text-subhead font-semibold text-on-accent">
            Open Settings
          </a>
        </div>
      ) : editId && draft ? (
        confirmRemove ? (
          <div className="px-2 pt-1 pb-2">
            <Art c={draft} />
            <p className="mx-2 mt-4 text-callout font-semibold">Delete “{draft.title}”?</p>
            <p className="mx-2 mt-1 text-subhead text-label-2">It goes from Explore and from your list, with your progress and note on it. This can't be undone.</p>
            {error && <p role="alert" className="mx-2 mt-2 text-subhead text-red">{error}</p>}
          </div>
        ) : (
          <div className="px-1 pt-1">
            <Art c={draft} />
            <div className="mt-4">
              <Form c={draft} onChange={setDraft} intro="Change anything here. The AI reads it again afterwards to update the summary, prize amount and themes." />
            </div>
            {error && (
              <p role="alert" className="mx-3 mt-3 flex gap-1.5 text-subhead text-red">
                <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            <button type="button" onClick={() => setConfirmRemove(true)} className="mx-auto mt-5 mb-1 flex items-center gap-1.5 text-subhead font-semibold text-red">
              <Icon name="trash" size={16} />
              Delete this hackathon
            </button>
          </div>
        )
      ) : phase === "input" ? (
        <div className="px-1 pt-1">
          <label className="block">
            <span className="mx-3 mb-1.5 block text-footnote font-medium text-label-2 uppercase">A link or a name</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && text.trim().length >= 2) {
                  e.preventDefault();
                  void find(text);
                }
              }}
              rows={3}
              autoFocus
              placeholder="Paste the hackathon's link or a post about it, or type its name"
              className="card w-full resize-none rounded-[18px] px-4 py-3 text-body outline-none placeholder:text-label-2"
            />
          </label>
          {error && (
            <p role="alert" className="mx-3 mt-2 flex gap-1.5 text-subhead text-red">
              <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          <ul className="mx-3 mt-4 space-y-2.5 text-subhead text-label-2">
            <Hint icon="link">The hackathon's own page works best.</Hint>
            <Hint icon="search">With just a name, the AI searches the web and shows what it found.</Hint>
            <Hint icon="share">On your phone, share a LinkedIn post to Hack Radar to start here.</Hint>
          </ul>
        </div>
      ) : phase === "finding" ? (
        <Finding startedAt={startedAt} hasLink={/https?:\/\//.test(text)} />
      ) : found.length === 0 ? (
        <div className="px-3 py-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-soft text-tint">
            <Icon name="search" size={26} />
          </span>
          <p className="mt-4 text-title3 font-semibold">Couldn't find it</p>
          <p className="mx-auto mt-1 max-w-[320px] text-subhead text-label-2">Try the hackathon's own link, or its exact name with the organizer.</p>
        </div>
      ) : (
        <div className="px-1 pt-1">
          {found.length > 1 && (
            <div role="radiogroup" aria-label="Which one?" className="mb-4">
              <span className="mx-3 mb-1.5 block text-footnote font-medium text-label-2 uppercase">Which one?</span>
              <div className="card overflow-hidden rounded-[18px]">
                {found.map((c, i) => (
                  <button
                    key={c.url}
                    type="button"
                    role="radio"
                    aria-checked={i === pick}
                    onClick={() => {
                      setPick(i);
                      setDraft(found[i]);
                    }}
                    className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", i > 0 && "border-t hairline", i === pick && "bg-soft")}
                  >
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", i === pick ? "bg-accent text-on-accent" : "shadow-[inset_0_0_0_1.5px_var(--label-3)]")}>
                      {i === pick && <Icon name="check" size={12} stroke={3} />}
                    </span>
                    <Thumbnail c={c} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-callout font-semibold">{c.title}</span>
                      <span className="block truncate text-footnote text-label-2">{hostOf(c.url)}</span>
                    </span>
                    {c.existing_id && <span className="shrink-0 text-caption font-semibold text-green">On the radar</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {draft && (
            <>
              <Art c={draft} />
              <div className="mt-4">{draft.existing_id ? <AlreadyThere c={draft} /> : <Form c={draft} onChange={setDraft} />}</div>
            </>
          )}
          {error && (
            <p role="alert" className="mx-3 mt-3 flex gap-1.5 text-subhead text-red">
              <Icon name="alert" size={17} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Hint({ icon, children }: { icon: "link" | "search" | "share"; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Icon name={icon} size={17} className="mt-0.5 shrink-0 text-tint" />
      <span>{children}</span>
    </li>
  );
}

/** What's happening while the server works: a search, reading pages, the AI. */
function Finding({ startedAt, hasLink }: { startedAt: number; hasLink: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const s = (now - startedAt) / 1000;
  const steps = hasLink ? ["Reading the link", "Searching the web if the page is hidden", "Picking out the details"] : ["Searching the web", "Reading what it found", "Picking out the details"];
  const at = s < 4 ? 0 : s < 11 ? 1 : 2;
  return (
    <div className="px-3 py-4" aria-live="polite">
      <ol className="space-y-3.5">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                i < at ? "bg-accent text-on-accent" : i === at ? "bg-soft text-tint" : "bg-fill text-label-3",
              )}
            >
              {i < at ? <Icon name="check" size={13} stroke={3} /> : i === at ? <Icon name="refresh" size={13} stroke={2.6} className="spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <span className={cn("text-callout", i <= at ? "font-semibold" : "text-label-2")}>{label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-footnote text-label-2 tabular">
        {Math.floor(s)} s{s > 25 ? " · still going. The server may have been asleep; this can take up to a minute." : ""}
      </p>
    </div>
  );
}

function AlreadyThere({ c }: { c: Candidate }) {
  return (
    <div className="card flex items-start gap-3 rounded-[18px] px-4 py-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-green-soft text-green">
        <Icon name="check" size={20} stroke={2.6} />
      </span>
      <div className="min-w-0">
        <p className="text-callout font-semibold">Already on the radar</p>
        <p className="mt-0.5 text-subhead text-label-2">
          {c.title} is listed already{c.organizer ? ` (${c.organizer})` : ""}. Open it to save it and track your progress.
        </p>
      </div>
    </div>
  );
}

/** The details the AI read, to check and correct. Anything it didn't find is empty, never guessed. */
function Form({ c, onChange, intro }: { c: Candidate; onChange: (c: Candidate) => void; intro?: string }) {
  const set = (patch: Partial<Candidate>) => onChange({ ...c, ...patch });
  const text = (key: keyof Candidate, label: string, opts: { type?: string; long?: boolean } = {}) => {
    const value = (c[key] as string | null) ?? "";
    return (
      <label className="flex items-start gap-3 border-b hairline px-4 py-2.5 last:border-0">
        <span className="w-[104px] shrink-0 pt-[3px] text-subhead text-label-2">{label}</span>
        {opts.long ? (
          <textarea
            value={value}
            onChange={(e) => set({ [key]: e.target.value || null })}
            rows={3}
            placeholder="Not found on the page"
            className="min-w-0 flex-1 resize-none bg-transparent text-callout outline-none placeholder:text-label-3"
          />
        ) : (
          <input
            type={opts.type ?? "text"}
            value={value}
            onChange={(e) => set({ [key]: e.target.value || null })}
            placeholder="Not found on the page"
            className="min-w-0 flex-1 bg-transparent text-callout outline-none placeholder:text-label-3"
          />
        )}
      </label>
    );
  };
  return (
    <>
      <p className="mx-3 mb-2 text-footnote text-label-2">{intro ?? "Check what the AI found. Empty fields weren't on the page; fill in what you know."}</p>
      <div className="card overflow-hidden rounded-[18px]">
        {text("title", "Name")}
        {text("url", "Link", { type: "url" })}
        {text("organizer", "Organizer")}
        {text("prize_text", "Prizes")}
        {text("registration_deadline", "Register by", { type: "date" })}
        {text("start_date", "Starts", { type: "date" })}
        {text("end_date", "Ends", { type: "date" })}
        {text("location_text", "Where")}
        {text("description", "About", { long: true })}
      </div>
      <span className="mx-3 mt-4 mb-1.5 block text-footnote font-medium text-label-2 uppercase">Format</span>
      <Segmented label="Format" value={c.format} onChange={(v) => set({ format: v })} options={FORMATS} />
    </>
  );
}

/** The pictures found on its page: the banner across, the logo on top. Nothing found: a plain tile. */
function Art({ c }: { c: Candidate }) {
  const [bannerOk, setBannerOk] = useState(true);
  const [logoOk, setLogoOk] = useState(true);
  useEffect(() => {
    setBannerOk(true);
    setLogoOk(true);
  }, [c.banner_url, c.logo_url]);
  const banner = bannerOk ? c.banner_url : null;
  const logo = logoOk ? c.logo_url : null;
  const art = fallbackArt({ categories: [], id: c.url });
  return (
    <div className="relative h-[150px] overflow-hidden rounded-[20px]" style={{ background: banner ? "#0e0e12" : art.gradient }}>
      {banner ? (
        <img src={banner} alt="" onError={() => setBannerOk(false)} className="absolute inset-0 h-full w-full object-cover" />
      ) : !logo ? (
        <div className="absolute inset-0 flex items-center justify-center text-white/90">
          <svg width="56" height="56" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
            <path d={art.glyph} />
          </svg>
        </div>
      ) : null}
      {logo && (
        <span className={cn("absolute flex items-center justify-center overflow-hidden rounded-[16px] bg-white shadow-[0_8px_20px_-6px_rgba(0,0,0,0.45)]", banner ? "bottom-3 left-3 h-14 w-14" : "top-1/2 left-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2")}>
          <img src={logo} alt="" onError={() => setLogoOk(false)} className="h-full w-full object-contain p-[14%]" />
        </span>
      )}
    </div>
  );
}

/** A candidate's small picture in the "Which one?" list. */
function Thumbnail({ c }: { c: Candidate }) {
  // The logo, else a crop of the banner (also when the logo won't load), else a plain tile.
  const [failed, setFailed] = useState<string[]>([]);
  const src = [c.logo_url, c.banner_url].find((u): u is string => !!u && !failed.includes(u)) ?? null;
  const isLogo = !!src && src === c.logo_url;
  const art = fallbackArt({ categories: [], id: c.url });
  return (
    <span className="thumb-line flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[11px] text-white" style={{ background: src ? (isLogo ? "#fff" : "#0e0e12") : art.gradient }}>
      {src ? (
        <img key={src} src={src} alt="" onError={() => setFailed((f) => [...f, src])} className={cn("h-full w-full", isLogo ? "object-contain p-[14%]" : "object-cover")} />
      ) : (
        <svg width="22" height="22" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
          <path d={art.glyph} />
        </svg>
      )}
    </span>
  );
}
