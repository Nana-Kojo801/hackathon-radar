import { motion } from "framer-motion";
import { useMemo } from "react";

import { HackRow } from "../components/HackRow";
import { Icon, RadarMark } from "../components/Icon";
import { RowToggle, Segmented, Thumb } from "../components/kit";
import { OverlayPage } from "../components/OverlayPage";
import {
  ACCENTS,
  accentHex,
  type Density,
  type IconStyle,
  isDark,
  mix,
  setAppearance,
  TEXT_SIZES,
  type ThemePref,
  useAppearance,
} from "../lib/appearance";
import { imageOf } from "../lib/format";
import { bouncy, press } from "../lib/motion";
import { useData } from "../lib/store";
import { cn } from "../lib/utils";

function Label({ children, right }: { children: string; right?: string }) {
  return (
    <div className="mx-8 mt-7 mb-1.5 flex justify-between text-footnote font-medium tracking-[0.01em] text-label-2 uppercase">
      <span>{children}</span>
      {right && <span className="font-semibold text-tint normal-case">{right}</span>}
    </div>
  );
}

export function AppearancePage() {
  const look = useAppearance();
  const d = useData();
  const dark = isDark(look);
  const preview = useMemo(() => d.items.filter((h) => imageOf(h)).sort((a, b) => (b.prize_usd ?? 0) - (a.prize_usd ?? 0)).slice(0, 2), [d.items]);
  const art = useMemo(() => d.items.filter((h) => imageOf(h)).slice(0, 12), [d.items]);
  const accent = accentHex(look.accent);

  return (
    <OverlayPage title="Appearance" backLabel="Settings" backTo="/settings">
      <div className="pb-24">
        <h1 className="mx-5 mt-1 text-large font-bold tracking-[-0.028em]">Appearance</h1>

        {preview.length > 0 && (
          <ul className="card mx-4 mt-4 overflow-hidden rounded-[22px]">
            {preview.map((h, i) => (
              <HackRow key={h.id} h={h} index={i} last={i === preview.length - 1} stage={i === 0 ? "registered" : null} density={look.density} swipe={false} />
            ))}
          </ul>
        )}

        <Label>Theme</Label>
        <section role="radiogroup" aria-label="Theme" className="card mx-4 grid grid-cols-3 rounded-[22px] px-2.5 pt-[18px] pb-4">
          {(
            [
              ["system", "Automatic"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as [ThemePref, string][]
          ).map(([v, label]) => {
            const on = look.theme === v;
            return (
              <motion.button key={v} type="button" role="radio" aria-checked={on} whileTap={press} transition={bouncy} onClick={() => setAppearance({ theme: v })} className="flex flex-col items-center gap-2.5">
                <motion.span
                  animate={{ scale: on ? 1 : 0.94 }}
                  transition={bouncy}
                  className="relative h-[112px] w-[72px] overflow-hidden rounded-[16px]"
                  style={{ boxShadow: on ? `0 0 0 3px var(--card), 0 0 0 5.5px var(--accent)` : "0 0 0 0.5px var(--sep)" }}
                >
                  <span className="absolute inset-y-0 left-0 bg-[#F2F2F7]" style={{ width: v === "dark" ? 0 : v === "light" ? "100%" : "50%" }} />
                  <span className="absolute inset-y-0 right-0 bg-black" style={{ width: v === "light" ? 0 : v === "dark" ? "100%" : "50%" }} />
                  <span className="absolute top-4 left-[9px] h-[7px] w-[30px] rounded-full" style={{ background: v === "dark" ? "#fff" : v === "light" ? "#000" : "#8E8E93" }} />
                  {[31, 64].map((top) => (
                    <span key={top} className="absolute right-[7px] left-[7px] h-7 rounded-[8px]" style={{ top, background: v === "dark" ? "#2C2C2E" : v === "light" ? "#fff" : "rgba(142,142,147,0.45)" }} />
                  ))}
                  <span className="absolute right-3.5 bottom-[7px] left-3.5 h-[9px] rounded-full bg-accent" />
                </motion.span>
                <span className="text-subhead font-medium">{label}</span>
                <span className={cn("flex h-[22px] w-[22px] items-center justify-center rounded-full text-on-accent", on ? "bg-accent" : "border-[1.5px] border-label-2")}>
                  {on && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={bouncy}>
                      <Icon name="check" size={13} stroke={3.4} />
                    </motion.span>
                  )}
                </span>
              </motion.button>
            );
          })}
        </section>

        <Label>Liquid Glass</Label>
        <section className="card mx-4 overflow-hidden rounded-[22px]">
          <div className="relative h-[150px] overflow-hidden">
            <div className="absolute -inset-2 grid grid-cols-6 gap-1.5 p-2">
              {(art.length ? art : []).map((h) => (
                <Thumb key={h.id} h={h} size={62} radius={12} />
              ))}
            </div>
            <div className="absolute inset-x-6 bottom-5 flex h-[54px] items-center justify-around rounded-full glass">
              {(["home", "compass", "bookmark", "gear"] as const).map((n, i) => (
                <span key={n} className={cn("flex h-11 w-[68px] items-center justify-center rounded-full", i === 0 ? "bg-soft text-tint" : "text-label")}>
                  <Icon name={n} size={22} stroke={1.9} filled={i === 0} />
                </span>
              ))}
            </div>
          </div>
          <div className="[&_.row-line]:border-b-0">
            <RowToggle
              label="Liquid Glass"
              hint={look.liquidGlass ? "Clear glass that bends the light behind the tab bar, buttons and menus." : "Off: a calmer, frosted look that's easier to read over busy images."}
              checked={look.liquidGlass}
              onChange={(v) => setAppearance({ liquidGlass: v })}
            />
          </div>
        </section>

        <Label right={look.accent === "custom" ? `Custom ${look.customAccent.toUpperCase()}` : ACCENTS.find((a) => a.id === look.accent)?.name}>Accent colour</Label>
        <section role="radiogroup" aria-label="Accent colour" className="card mx-4 grid grid-cols-7 gap-0.5 rounded-[22px] px-2 pt-[18px] pb-4">
          {ACCENTS.map((a) => {
            const on = a.id === look.accent;
            const color = dark ? mix(a.hex, 255, 0.25) : a.hex;
            return (
              <motion.button key={a.id} type="button" role="radio" aria-checked={on} aria-label={a.name} whileTap={{ scale: 0.85 }} transition={bouncy} onClick={() => setAppearance({ accent: a.id })} className="flex flex-col items-center gap-2">
                <motion.span
                  animate={{ boxShadow: on ? `0 0 0 3px var(--card), 0 0 0 5.5px ${color}` : `0 0 0 0px var(--card), 0 0 0 0px ${color}` }}
                  transition={bouncy}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white"
                  style={{ background: color }}
                >
                  {on && (
                    <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={bouncy}>
                      <Icon name="check" size={17} stroke={3.2} />
                    </motion.span>
                  )}
                </motion.span>
                <span className="text-[11.5px] font-medium text-label-2">{a.name}</span>
              </motion.button>
            );
          })}
          <CustomSwatch />
        </section>

        <Label right={TEXT_SIZES[look.textSize]?.name}>Text size</Label>
        <section className="card mx-4 flex items-center gap-3.5 rounded-[22px] px-4 py-2">
          <span aria-hidden="true" className="text-[14px] font-medium">
            A
          </span>
          <div role="radiogroup" aria-label="Text size" className="relative flex h-11 flex-1 items-center justify-between">
            <span className="absolute inset-x-[13px] top-5 h-1 rounded-full bg-track" />
            <motion.span
              className="absolute top-5 left-[13px] h-1 rounded-full bg-accent"
              initial={false}
              animate={{ width: `calc(${look.textSize / 4} * (100% - 26px))` }}
              transition={bouncy}
            />
            {TEXT_SIZES.map((t, i) => {
              const on = i === look.textSize;
              return (
                <button key={t.name} type="button" role="radio" aria-checked={on} aria-label={t.name} onClick={() => setAppearance({ textSize: i })} className="relative flex h-11 w-[26px] items-center justify-center">
                  <motion.span
                    initial={false}
                    animate={{ width: on ? 26 : 8, height: on ? 26 : 8 }}
                    transition={bouncy}
                    className={cn("rounded-full", on ? "bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.04)]" : i < look.textSize ? "bg-accent" : "bg-track")}
                  />
                </button>
              );
            })}
          </div>
          <span aria-hidden="true" className="text-[22px] font-medium">
            A
          </span>
        </section>

        <Label>List density</Label>
        <Segmented<Density>
          label="List density"
          className="mx-4"
          value={look.density}
          onChange={(v) => setAppearance({ density: v })}
          options={[
            { value: "compact", label: "Compact" },
            { value: "comfortable", label: "Comfortable" },
          ]}
        />

        <Label>App icon</Label>
        <section role="radiogroup" aria-label="App icon" className="card mx-4 grid grid-cols-3 rounded-[22px] px-2.5 pt-[18px] pb-4">
          {(
            [
              ["classic", "Classic"],
              ["light", "Light"],
              ["dark", "Dark"],
            ] as [IconStyle, string][]
          ).map(([v, label]) => {
            const on = look.icon === v;
            const bg = v === "classic" ? `linear-gradient(160deg, ${mix(accent, 255, 0.3)} 0%, ${accent} 100%)` : v === "light" ? "#fff" : "#000";
            const fg = v === "light" ? accent : "#fff";
            const wave = v === "dark" ? mix(accent, 255, 0.35) : fg;
            return (
              <motion.button key={v} type="button" role="radio" aria-checked={on} whileTap={press} transition={bouncy} onClick={() => setAppearance({ icon: v })} className="flex flex-col items-center gap-2.5">
                <motion.span
                  animate={{ scale: on ? 1 : 0.92 }}
                  transition={bouncy}
                  className="flex h-[62px] w-[62px] items-center justify-center rounded-[15px]"
                  style={{ background: bg, boxShadow: on ? `0 0 0 3px var(--card), 0 0 0 5.5px var(--accent)` : "0 0 0 0.5px var(--sep)" }}
                >
                  <RadarMark size={40} color={fg} wave={wave} />
                </motion.span>
                <span className={cn("text-subhead", on ? "font-semibold" : "font-medium")}>{label}</span>
              </motion.button>
            );
          })}
        </section>
        <p className="mx-8 mt-1.5 text-footnote text-label-2">The new icon appears after you remove the app from your Home Screen and add it again.</p>
      </div>
    </OverlayPage>
  );
}

/** Any colour: the swatch opens the system colour picker; the pick becomes the accent right away. */
function CustomSwatch() {
  const look = useAppearance();
  const on = look.accent === "custom";
  const dark = isDark(look);
  const color = dark ? mix(look.customAccent, 255, 0.25) : look.customAccent;
  return (
    <label className="relative flex cursor-pointer flex-col items-center gap-2" onClick={() => !on && setAppearance({ accent: "custom" })}>
      <input
        type="color"
        value={look.customAccent}
        onChange={(e) => setAppearance({ accent: "custom", customAccent: e.target.value })}
        aria-label="Custom accent colour"
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <motion.span
        animate={{ boxShadow: on ? `0 0 0 3px var(--card), 0 0 0 5.5px ${color}` : "0 0 0 0px var(--card), 0 0 0 0px transparent" }}
        transition={bouncy}
        whileTap={{ scale: 0.85 }}
        className="pointer-events-none flex h-9 w-9 items-center justify-center rounded-full"
        style={{ background: on ? color : "conic-gradient(from 180deg, #ff3b30, #ff9500, #ffcc00, #34c759, #00c7be, #007aff, #5856d6, #af52de, #ff2d55, #ff3b30)" }}
      >
        {on ? (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={bouncy} style={{ color: "var(--on-accent)" }}>
            <Icon name="pencil" size={15} stroke={2.6} />
          </motion.span>
        ) : (
          <span className="h-3.5 w-3.5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3)]" />
        )}
      </motion.span>
      <span className="pointer-events-none text-[11.5px] font-medium text-label-2">Custom</span>
    </label>
  );
}
