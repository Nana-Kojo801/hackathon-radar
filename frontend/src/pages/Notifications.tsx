import { AnimatePresence, motion } from "framer-motion";
import { type ReactNode, useMemo, useState } from "react";

import { Icon, RadarMark } from "../components/Icon";
import { Group, RowMenu, RowToggle, Segmented, Toggle } from "../components/kit";
import { OverlayPage } from "../components/OverlayPage";
import { setAppearance, useAppearance } from "../lib/appearance";
import { compactMoney, imageOf, prizeShort } from "../lib/format";
import { bouncy, spring } from "../lib/motion";
import { type Settings, updateSettings, usePersonal } from "../lib/personal";
import { disablePush, enablePush, type PushStatus, testPush, usePushStatus } from "../lib/push";
import { explainError } from "../lib/errors";
import { linkTo } from "../lib/router";
import { useData } from "../lib/store";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));
const BIG = [50_000, 100_000, 250_000, 500_000].map((n) => ({ value: String(n), label: `Over ${compactMoney(n)}` }));
const TIMING = [
  { value: "1", label: "1 day" },
  { value: "2", label: "2 days" },
  { value: "3", label: "3 days" },
  { value: "7", label: "1 week" },
];

export function NotificationsPage() {
  const p = usePersonal();
  const d = useData();
  const look = useAppearance();
  const [status, setStatus, refresh] = usePushStatus();
  const [busy, setBusy] = useState(false);
  // Why the last attempt failed, kept on screen (a toast vanishes before it can be read).
  const [problem, setProblem] = useState<string | null>(null);
  const s = p.settings;
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const on = status === "on";

  const sample = useMemo(() => {
    const tracked = Object.values(p.items).find((t) => (t.status === "saved" || t.status === "registered") && t.hackathon?.registration_deadline);
    const big = [...d.items].sort((a, b) => (b.prize_usd ?? 0) - (a.prize_usd ?? 0)).slice(0, 2);
    return {
      closing: tracked?.hackathon?.title ?? big[0]?.title ?? "Your saved hackathon",
      matches: big.map((h) => `${h.title} (${prizeShort(h)})`).join(" and "),
      wallpaper: d.items.find((h) => imageOf(h))?.image_url ?? null,
    };
  }, [p.items, d.items]);

  const toggle = async (want: boolean) => {
    setBusy(true);
    try {
      setProblem(null);
      const next = want ? await enablePush() : await disablePush();
      setStatus(next);
      if (next === "on") toast("Notifications on", "bell");
      else if (next === "server-off") toast("Push isn't set up on the server yet", "alert");
    } catch (e) {
      setProblem(explainError(e, "notifications").text);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayPage title="Notifications" backLabel="Settings" backTo="/settings">
      <div className="pb-24">
        <h1 className="mx-5 mt-1 text-large font-bold tracking-[-0.028em]">Notifications</h1>

        <LockScreen wallpaper={sample.wallpaper}>
          <Banner title="Closes in 2 days" when="now" body={`${sample.closing}. Registration closes Friday.`} delay={0.15} />
          <Banner title="2 new matches" when="6h ago" body={sample.matches ? `${sample.matches}.` : "Two new hackathons match your rules."} delay={0.3} />
        </LockScreen>

        <section className="card mx-4 mt-5 rounded-[22px]">
          <div className="flex min-h-[60px] items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">Allow notifications</span>
              {problem ? <span className="block text-footnote leading-snug text-red">{problem}</span> : <StatusLine status={status} devices={s?.push_devices ?? 0} />}
            </span>
            {busy ? (
              <span className="spin h-6 w-6 rounded-full border-[2.5px] border-track border-t-accent" />
            ) : (
              <Toggle checked={on} onChange={toggle} label="Allow notifications" disabled={!(status === "on" || status === "off" || status === "server-off")} />
            )}
          </div>
          <Help status={status} />
          <AnimatePresence initial={false}>
            {on && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() =>
                    testPush()
                      .then(() => toast("Test sent", "bell"))
                      .catch(() => toast("The server couldn't send it", "alert"))
                  }
                  className="flex min-h-[48px] w-full items-center gap-2.5 border-t hairline px-4 text-left text-body text-tint active:bg-fill"
                >
                  <Icon name="bell" size={19} />
                  Send a test notification
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className={cn("transition-opacity", !on && "opacity-50")}>
          <Group header="Notify me about">
            <RowToggle label="New matches" hint="Hackathons that fit your email alert rules" checked={!!s?.push_new_matches} onChange={(v) => set({ push_new_matches: v })} />
            <RowToggle label="Closing soon" hint="Saved hackathons, before registration ends" checked={!!s?.push_closing_soon} onChange={(v) => set({ push_closing_soon: v })} />
            <RowToggle label="Big new prizes" hint="Whatever your rules say" checked={!!s?.push_big_prizes} onChange={(v) => set({ push_big_prizes: v })} />
            {s?.push_big_prizes && <RowMenu label="Counts as big" value={String(s.big_prize_min)} options={BIG} onChange={(v) => set({ big_prize_min: Number(v) })} />}
            <RowToggle label="Weekly summary" hint="Monday morning" checked={!!s?.push_digest} onChange={(v) => set({ push_digest: v })} />
          </Group>

          <div className="mx-8 mt-7 mb-1.5 text-footnote font-medium tracking-[0.01em] text-label-2 uppercase">Remind me before a deadline</div>
          <Segmented label="Reminder timing" className="mx-4" value={String(s?.reminder_days ?? 2)} onChange={(v) => set({ reminder_days: Number(v), reminders_enabled: true })} options={TIMING} />

          <Group footer="Notifications that come during quiet hours wait until the next check after they end.">
            <RowToggle label="Quiet hours" checked={!!s?.quiet_hours_enabled} onChange={(v) => set({ quiet_hours_enabled: v })} />
            {s?.quiet_hours_enabled && (
              <>
                <RowMenu label="From" value={String(s.quiet_start)} options={HOURS} onChange={(v) => set({ quiet_start: Number(v) })} />
                <RowMenu label="Until" value={String(s.quiet_end)} options={HOURS} onChange={(v) => set({ quiet_end: Number(v) })} />
              </>
            )}
          </Group>
        </div>

        <Group footer="Counts saved hackathons that close this week. Notifications need the app on your Home Screen; emails keep coming either way.">
          <RowToggle label="Badge on app icon" checked={look.badge} onChange={(v) => setAppearance({ badge: v })} />
        </Group>
      </div>
    </OverlayPage>
  );
}

function StatusLine({ status, devices }: { status: PushStatus; devices: number }) {
  const text: Record<PushStatus, string> = {
    checking: "Checking…",
    on: devices > 1 ? `On for this device and ${devices - 1} other${devices > 2 ? "s" : ""}` : "On for this device",
    off: "Off",
    install: "Add the app to your Home Screen first",
    unsupported: "This browser can't show notifications",
    "no-key": "Connect this device in Settings first",
    denied: "Blocked in your phone's settings",
    "server-off": "Not set up on the server yet",
  };
  return (
    <span className={cn("flex items-center gap-1.5 text-footnote", status === "on" ? "text-green" : "text-label-2")}>
      {status === "on" && <Icon name="check" size={12} stroke={3.2} />}
      {text[status]}
    </span>
  );
}

function Help({ status }: { status: PushStatus }) {
  let body: ReactNode = null;
  if (status === "install")
    body = (
      <>
        In Safari, tap <Icon name="share" size={15} className="inline -translate-y-0.5" /> Share, then <b>Add to Home Screen</b>. Open Hackathon Radar from there and come back here.
      </>
    );
  else if (status === "denied") body = <>Turn them back on in Settings › Notifications › Hack Radar on your phone, then return here.</>;
  else if (status === "no-key")
    body = (
      <>
        Notifications go to connected devices.{" "}
        <a href="/settings" onClick={linkTo("/settings")} className="font-semibold text-tint">
          Connect in Settings
        </a>
        .
      </>
    );
  else if (status === "server-off") body = <>Add VAPID_PRIVATE_KEY on Render and in GitHub secrets (see the README), then turn this on.</>;
  if (!body) return null;
  return <p className="border-t hairline px-4 py-3 text-footnote leading-snug text-label-2">{body}</p>;
}

function LockScreen({ wallpaper, children }: { wallpaper: string | null; children: ReactNode }) {
  return (
    <section aria-label="Preview" className="relative mx-4 mt-4 h-[264px] overflow-hidden rounded-[28px] bg-[linear-gradient(160deg,#3a7bd5,#00d2ff)]">
      {wallpaper && <img src={wallpaper} alt="" className="absolute -inset-12 h-[calc(100%+96px)] w-[calc(100%+96px)] scale-110 object-cover blur-2xl brightness-90 saturate-150" />}
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-x-0 top-4 text-center text-white">
        <div className="text-footnote font-semibold opacity-85">{new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).replace(",", "")}</div>
        <div className="text-[54px] leading-[58px] font-bold tracking-[-0.02em] tabular">{new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(new Date())}</div>
      </div>
      <div className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Banner({ title, when, body, delay }: { title: string; when: string; body: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ...bouncy, delay }}
      className="flex gap-2.5 rounded-[22px] bg-[rgba(245,245,247,0.78)] px-3 py-[11px] text-black backdrop-blur-2xl backdrop-saturate-200 dark:bg-[rgba(44,44,48,0.72)] dark:text-white"
    >
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[9px]" style={{ background: "linear-gradient(160deg, var(--accent-hi) 0%, var(--accent) 100%)" }}>
        <RadarMark size={24} color="#fff" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between gap-2 text-[14.5px] leading-[19px]">
          <span className="truncate font-semibold">{title}</span>
          <span className="shrink-0 text-[13px] opacity-50">{when}</span>
        </div>
        <div className="line-clamp-2 text-[14.5px] leading-[19px] opacity-85">{body}</div>
      </div>
    </motion.div>
  );
}
