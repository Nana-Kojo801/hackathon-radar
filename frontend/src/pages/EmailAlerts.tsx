import { motion } from "framer-motion";

import { Icon } from "../components/Icon";
import { Group, RowMenu, RowToggle } from "../components/kit";
import { OverlayPage } from "../components/OverlayPage";
import { categoryLabel, money } from "../lib/format";
import { bouncy, press } from "../lib/motion";
import { type Settings, updateSettings, usePersonal } from "../lib/personal";
import { useData } from "../lib/store";
import { cn } from "../lib/utils";

const PRIZES = [0, 1000, 5000, 10000, 25000, 50000, 100000].map((n) => ({ value: String(n), label: n ? `${money(n)}+` : "Any prize" }));
const FORMATS = [
  { value: "online", label: "Online" },
  { value: "in_person", label: "In person" },
  { value: "hybrid", label: "Hybrid" },
];

/** The rules for new-hackathon alerts (email and push both use them), plus the other emails. */
export function EmailAlertsPage() {
  const p = usePersonal();
  const d = useData();
  const s = p.settings;
  const set = (patch: Partial<Settings>) => updateSettings(patch);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const prizes = s && !PRIZES.some((o) => o.value === String(s.alert_min_prize)) ? [...PRIZES, { value: String(s.alert_min_prize), label: `${money(s.alert_min_prize)}+` }] : PRIZES;

  return (
    <OverlayPage title="Email alerts" backLabel="Settings" backTo="/settings">
      <div className="pb-24">
        <h1 className="mx-5 mt-1 text-large font-bold tracking-[-0.028em]">Email alerts</h1>
        <p className="mx-5 mt-1 text-subhead text-label-2">Checked after every refresh, every 6 hours. These rules also decide which new hackathons get a notification.</p>

        <Group>
          <RowToggle label="Email me about new hackathons" checked={!!s?.alerts_enabled} onChange={(v) => set({ alerts_enabled: v })} />
        </Group>

        <div className={cn("transition-opacity", !s?.alerts_enabled && "opacity-50")}>
          <Group header="Match">
            <RowMenu label="Minimum prize" value={String(s?.alert_min_prize ?? 0)} options={prizes} onChange={(v) => set({ alert_min_prize: Number(v) })} />
            <RowToggle label="Only ones open worldwide" checked={!!s?.alert_international_only} onChange={(v) => set({ alert_international_only: v })} />
            <RowToggle label="Skip student-only" checked={!!s?.alert_skip_student_only} onChange={(v) => set({ alert_skip_student_only: v })} />
          </Group>

          <Cloud
            label="Categories"
            hint="None selected means any category."
            options={(d.meta?.categories ?? d.categories).map((c) => ({ value: c.category, label: categoryLabel(c.category) }))}
            value={s?.alert_categories ?? []}
            onToggle={(v) => set({ alert_categories: toggle(s?.alert_categories ?? [], v) })}
          />
          <Cloud label="Format" hint="None selected means any format." options={FORMATS} value={s?.alert_formats ?? []} onToggle={(v) => set({ alert_formats: toggle(s?.alert_formats ?? [], v) })} />
        </div>

        <Group header="Other emails" footer="Emails go to the NOTIFY_EMAIL address set in GitHub secrets, sent with Resend.">
          <RowToggle label="Deadline reminders" hint={`${s?.reminder_days ?? 2} days before registration closes`} checked={!!s?.reminders_enabled} onChange={(v) => set({ reminders_enabled: v })} />
          <RowToggle label="Weekly digest" hint="Monday mornings" checked={!!s?.digest_enabled} onChange={(v) => set({ digest_enabled: v })} />
        </Group>
      </div>
    </OverlayPage>
  );
}

function Cloud({ label, hint, options, value, onToggle }: { label: string; hint: string; options: { value: string; label: string }[]; value: string[]; onToggle: (v: string) => void }) {
  return (
    <section className="mx-4 mt-6">
      <h3 className="mx-4 mb-1.5 text-footnote font-medium tracking-[0.01em] text-label-2 uppercase">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <motion.button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              whileTap={press}
              transition={bouncy}
              onClick={() => onToggle(o.value)}
              className={cn("flex h-[34px] items-center gap-1.5 rounded-full px-3.5 text-[14.5px] font-semibold transition-colors", on ? "bg-accent text-white" : "card text-label")}
            >
              {on && <Icon name="check" size={14} stroke={3} />}
              {o.label}
            </motion.button>
          );
        })}
      </div>
      <p className="mx-4 mt-1.5 text-footnote text-label-2">{hint}</p>
    </section>
  );
}
