import { Check, KeyRound, Loader2, LogOut } from "lucide-react";
import { type ReactNode, useState } from "react";

import { TopBar } from "../components/Brand";
import { Button } from "../components/ui/button";
import { ChipMultiSelect } from "../components/ui/multi-select";
import { FieldSelect } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { categoryLabel, money, timeAgo } from "../lib/format";
import { connect, disconnect, KeyError, type Settings, updateSettings, usePersonal } from "../lib/personal";
import { cn } from "../lib/utils";

const PRIZES = [0, 1000, 5000, 10000, 25000, 50000, 100000].map((n) => ({ value: String(n), label: n ? `${money(n)}+` : "Any prize" }));
const DAYS = [1, 2, 3, 5, 7].map((n) => ({ value: String(n), label: n === 1 ? "1 day before" : `${n} days before` }));
const FORMATS = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];

function Card({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-[14px] border border-line px-4 py-4 wide:px-6 wide:py-5", className)}>
      <h2 className="mb-2 text-[19px] font-bold tracking-[-0.01em] text-ink wide:text-[21px]">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsPage({ categories }: { categories: string[] }) {
  const p = usePersonal();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const s = p.settings;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>);
  const off = !p.key || !s;

  return (
    <div>
      <TopBar />
      <section className="px-5 pt-5 pb-4 wide:px-7 wide:pt-7 wide:pb-5">
        <h1 className="text-[27px] leading-tight font-bold tracking-[-0.02em] text-ink wide:text-[42px]">Settings</h1>
      </section>

      <div className="grid gap-4 px-5 pb-10 wide:grid-cols-2 wide:gap-5 wide:px-7">
        <Card title="This device" className="wide:col-span-2">
          {p.key ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[15.5px] text-ink-2">
                <Check className="h-[18px] w-[18px] text-pill-green" strokeWidth={2.4} />
                Connected. {p.syncing ? "Syncing…" : p.lastSync ? `Synced ${timeAgo(p.lastSync)}.` : ""}
                {p.error === "key" && <span className="text-pill-red">The server no longer accepts this key.</span>}
              </p>
              <Button variant="outline" className="h-10 rounded-[10px] px-3.5 text-[14.5px] text-ink-2" onClick={disconnect}>
                <LogOut className="h-4 w-4" strokeWidth={2.2} /> Disconnect
              </Button>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!key.trim()) return;
                setBusy(true);
                setProblem(null);
                try {
                  await connect(key);
                  setKey("");
                } catch (err) {
                  setProblem(
                    err instanceof KeyError
                      ? "That key wasn't accepted. Check PERSONAL_KEY on Render."
                      : "Couldn't reach the server. It may be waking up (up to a minute); try again.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="text-[15px] leading-snug text-ink-2">
                Paste your personal key to save hackathons, track stages, keep notes and set up emails. It's the <code className="rounded bg-field px-1">PERSONAL_KEY</code> value on Render, and this device remembers it.
              </p>
              <div className="mt-3 flex flex-col gap-2.5 wide:flex-row">
                <label className="flex h-11 flex-1 items-center gap-2.5 rounded-[10px] border border-field-line bg-field px-3.5 focus-within:border-teal/40 focus-within:bg-white">
                  <KeyRound className="h-[18px] w-[18px] shrink-0 text-[#7a8fc9]" strokeWidth={2} />
                  <span className="sr-only">Personal key</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="Personal key"
                    className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#8a9bcf]"
                  />
                </label>
                <Button type="submit" variant="primary" disabled={busy || !key.trim()} className="h-11 rounded-[10px] px-5 text-[15px]">
                  {busy && <Loader2 className="spin h-4 w-4" strokeWidth={2.2} />}
                  {busy ? "Checking…" : "Connect"}
                </Button>
              </div>
              {problem && <p className="mt-2 text-[14px] text-pill-red">{problem}</p>}
            </form>
          )}
        </Card>

        <Card title="New hackathon alerts">
          <div className={cn(off && "pointer-events-none opacity-50")} aria-disabled={off}>
            <Switch
              checked={!!s?.alerts_enabled}
              onChange={(v) => set("alerts_enabled", v)}
              label="Email me about new hackathons"
              hint="Checked after every refresh (every 6 hours). One email per refresh, only when something new matches."
            />
            <div className={cn("mt-3 space-y-4", !s?.alerts_enabled && "opacity-50")}>
              <FieldSelect
                label="Minimum prize"
                value={String(s?.alert_min_prize ?? 0)}
                onChange={(v) => set("alert_min_prize", Number(v))}
                options={PRIZES.some((o) => o.value === String(s?.alert_min_prize ?? 0)) ? PRIZES : [...PRIZES, { value: String(s?.alert_min_prize), label: `${money(s?.alert_min_prize ?? 0)}+` }]}
                triggerClassName="h-11 w-full"
              />
              <ChipMultiSelect
                label="Categories (any of these; none = all)"
                value={s?.alert_categories ?? []}
                onChange={(v) => set("alert_categories", v)}
                options={categories.map((c) => ({ value: c, label: categoryLabel(c) }))}
              />
              <ChipMultiSelect label="Format (none = any)" value={s?.alert_formats ?? []} onChange={(v) => set("alert_formats", v)} options={FORMATS} />
              <div className="divide-y divide-line">
                <Switch checked={!!s?.alert_international_only} onChange={(v) => set("alert_international_only", v)} label="Only ones open internationally" />
                <Switch checked={!!s?.alert_skip_student_only} onChange={(v) => set("alert_skip_student_only", v)} label="Skip student-only hackathons" />
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4 wide:space-y-5">
          <Card title="Deadline reminders">
            <div className={cn(off && "pointer-events-none opacity-50")} aria-disabled={off}>
              <Switch
                checked={!!s?.reminders_enabled}
                onChange={(v) => set("reminders_enabled", v)}
                label="Remind me before registration closes"
                hint="For hackathons you've marked Interested or Registered."
              />
              <FieldSelect
                label="When"
                value={String(s?.reminder_days ?? 2)}
                onChange={(v) => set("reminder_days", Number(v))}
                options={DAYS}
                className={cn("mt-3", !s?.reminders_enabled && "opacity-50")}
                triggerClassName="h-11 w-full"
              />
            </div>
          </Card>
          <Card title="Weekly digest">
            <div className={cn(off && "pointer-events-none opacity-50")} aria-disabled={off}>
              <Switch
                checked={!!s?.digest_enabled}
                onChange={(v) => set("digest_enabled", v)}
                label="Monday morning summary"
                hint="The week's best new hackathons for your alert rules, plus deadlines coming up on your saved ones."
              />
            </div>
          </Card>
          <p className="px-1 text-[13.5px] leading-snug text-slate">
            Emails go to the address in the <code className="rounded bg-field px-1">NOTIFY_EMAIL</code> GitHub secret, sent with Resend after each refresh.
          </p>
        </div>
      </div>
    </div>
  );
}
