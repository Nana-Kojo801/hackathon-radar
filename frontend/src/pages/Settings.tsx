import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { AppIcon, Icon } from "../components/Icon";
import { CompactBar, Group, LargeTitle, Menu, RowLink, RowMenu, RowToggle, useScrolled } from "../components/kit";
import { StatsCard } from "../components/StatsTeasers";
import { ACCENTS, setAppearance, type StartTab, useAppearance } from "../lib/appearance";
import { compactMoney, countdown, nextRefresh, timeAgo } from "../lib/format";
import { bouncy, press, spring } from "../lib/motion";
import { connect, disconnect, KeyError, type Settings as ServerSettings, updateSettings, usePersonal } from "../lib/personal";
import { usePushStatus } from "../lib/push";
import { useData } from "../lib/store";
import { cn } from "../lib/utils";

const REMINDER_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "1", label: "1 day before" },
  { value: "2", label: "2 days before" },
  { value: "3", label: "3 days before" },
  { value: "7", label: "1 week before" },
];
const START_OPTIONS: { value: StartTab; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "explore", label: "Explore" },
  { value: "saved", label: "Saved" },
];

export function emailSummary(s: ServerSettings | null): string {
  if (!s) return "";
  if (!s.alerts_enabled) return "Off";
  const bits = [s.alert_min_prize ? `${compactMoney(s.alert_min_prize)}+` : "Any prize"];
  if (s.alert_formats.length === 1) bits.push(s.alert_formats[0] === "online" ? "online" : s.alert_formats[0] === "in_person" ? "in person" : "hybrid");
  return bits.join(", ");
}

export function SettingsTab() {
  const p = usePersonal();
  const d = useData();
  const look = useAppearance();
  const scrolled = useScrolled(52);
  const [push] = usePushStatus();
  const s = p.settings;
  const off = !p.key || !s;
  const set = (patch: Partial<ServerSettings>) => updateSettings(patch);
  const accentName = look.accent === "custom" ? "Custom" : (ACCENTS.find((a) => a.id === look.accent)?.name ?? "");
  const themeName = look.theme === "system" ? "Automatic" : look.theme === "dark" ? "Dark" : "Light";
  const failing = d.warning;

  return (
    <div className="pb-36">
      <CompactBar title="Settings" show={scrolled} />
      <LargeTitle title="Settings" />

      {p.key ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="card mx-4 mt-4 flex items-center gap-3.5 rounded-[22px] p-3.5">
          <AppIcon size={58} />
          <div className="min-w-0 flex-1">
            <div className="text-title3 font-semibold tracking-[-0.02em]">Hackathon Radar</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-subhead text-label-2">
              <span className={cn("h-[7px] w-[7px] rounded-full", p.error ? "bg-orange-fill" : "bg-green")} />
              {p.error === "key" ? "Key not accepted" : p.syncing ? "Syncing…" : p.lastSync ? `Connected · synced ${timeAgo(p.lastSync)}` : "Connected"}
            </div>
          </div>
        </motion.div>
      ) : (
        <ConnectCard />
      )}
      <StatsCard />

      <div className={cn(off && "pointer-events-none opacity-50")} aria-disabled={off}>
        <Group header="Alerts">
          <RowLink icon="bell" iconBg="#FF3B30" label="Notifications" value={push === "on" ? "On" : "Off"} href="/settings/notifications" />
          <RowLink icon="mail" iconBg="#007AFF" label="Email alerts" value={emailSummary(s)} href="/settings/email" />
          <RowMenu
            icon="clock"
            iconBg="#FF9500"
            label="Reminders"
            value={!s || !s.reminders_enabled ? "off" : String(s.reminder_days)}
            options={REMINDER_OPTIONS}
            onChange={(v) => set(v === "off" ? { reminders_enabled: false } : { reminders_enabled: true, reminder_days: Number(v) })}
          />
          <RowToggle icon="news" iconBg="#5856D6" label="Weekly digest email" checked={!!s?.digest_enabled} onChange={(v) => set({ digest_enabled: v })} />
        </Group>
      </div>

      <Group header="Make it yours">
        <RowLink icon="palette" iconBg="#FF2D55" label="Appearance" value={`${themeName}, ${accentName}`} href="/settings/appearance" />
        <RowMenu icon="home" iconBg="#34C759" label="Open the app on" value={look.startTab} options={START_OPTIONS} onChange={(v) => setAppearance({ startTab: v })} />
      </Group>

      <Group header="Data" footer="Listings refresh every 6 hours from Devpost, Devfolio, MLH, TAIKAI, ETHGlobal, Unstop and the web.">
        <RowLink icon="refresh" iconBg="#8E8E93" label="Last refresh" value={timeAgo(d.meta?.last_refresh)} chevron={false} />
        <NextRefresh last={d.meta?.last_refresh} />
        <RowLink icon={failing ? "alert" : "check"} iconBg={failing ? "#FF9500" : "#8E8E93"} label="Sources" hint={failing?.text} value={failing ? undefined : "All healthy"} chevron={false} />
      </Group>

      {p.key && (
        <div className="mx-4 mt-6">
          <Menu
            title="Your saved hackathons stay on the server and come back when you reconnect."
            items={[{ value: "disconnect", label: "Disconnect this device", destructive: true }]}
            onSelect={() => disconnect()}
            align="center"
            trigger={
              <button type="button" className="card h-[50px] w-full rounded-[22px] text-body text-red">
                Disconnect this device
              </button>
            }
          />
        </div>
      )}
    </div>
  );
}

function ConnectCard() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="card mx-4 mt-4 rounded-[22px] p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!key.trim()) return;
        setBusy(true);
        setProblem(null);
        try {
          await connect(key);
          setKey("");
        } catch (err) {
          setProblem(err instanceof KeyError ? "That key wasn't accepted. Check PERSONAL_KEY on Render." : "Couldn't reach the server. It may be waking up (up to a minute); try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex items-center gap-3.5">
        <AppIcon size={52} />
        <div>
          <div className="text-body font-semibold">Connect this device</div>
          <div className="text-footnote text-label-2">Sync saved hackathons and notes, and turn on notifications.</div>
        </div>
      </div>
      <label className="mt-3.5 flex h-11 items-center gap-2.5 rounded-[12px] bg-fill px-3">
        <Icon name="key" size={18} className="text-label-2" />
        <span className="sr-only">Personal key</span>
        <input
          type="password"
          autoComplete="current-password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Personal key"
          className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-label-2"
        />
      </label>
      {problem && <p className="mt-2 text-footnote text-red">{problem}</p>}
      <motion.button
        type="submit"
        whileTap={press}
        transition={bouncy}
        disabled={busy || !key.trim()}
        className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-accent text-subhead font-semibold text-on-accent disabled:opacity-45"
      >
        {busy ? "Checking…" : "Connect"}
      </motion.button>
      <p className="mt-2.5 text-footnote text-label-2">
        It's the <code className="rounded bg-fill px-1">PERSONAL_KEY</code> value on Render. This device remembers it.
      </p>
    </motion.form>
  );
}

/** A live countdown to the next scheduled refresh, so it's clear how fresh the list is. */
function NextRefresh({ last }: { last: string | null | undefined }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const next = nextRefresh(last, now);
  const at = new Date(next.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <RowLink
      icon="clock"
      iconBg="#007AFF"
      label="Next refresh"
      hint={next.due ? "Running now. GitHub sometimes starts it a little late." : `Around ${at}`}
      value={next.due ? "Any minute" : <span className="tabular">{countdown(next.at - now)}</span>}
      chevron={false}
    />
  );
}
