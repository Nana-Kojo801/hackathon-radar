import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { AnimatePresence, motion } from "framer-motion";
import { createContext, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Hackathon } from "../lib/api";
import { dueTag, fallbackArt, iconOf } from "../lib/format";
import { bouncy, press, pressSmall, spring } from "../lib/motion";
import { slide } from "../lib/transition";
import { type Stage, stageLabel } from "../lib/personal";
import { linkTo } from "../lib/router";
import { useToast } from "../lib/toast";
import { cn } from "../lib/utils";
import { Icon, type IconName } from "./Icon";

// ---------------------------------------------------------------- buttons

/** A round glass button for navigation bars. */
export function GlassButton({
  label,
  icon,
  onClick,
  href,
  size = 44,
  tint,
  filled,
  className,
  children,
}: {
  label: string;
  icon?: IconName;
  onClick?: () => void;
  href?: string;
  size?: number;
  tint?: boolean;
  filled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const content = children ?? (icon && <Icon name={icon} size={size * 0.46} stroke={2.3} filled={filled} />);
  const cls = cn("glass flex shrink-0 items-center justify-center rounded-full outline-none", tint ? "text-tint" : "text-label", className);
  const style = { width: size, height: size };
  if (href)
    return (
      <motion.a href={href} onClick={linkTo(href)} aria-label={label} className={cls} style={style} whileTap={pressSmall} transition={bouncy}>
        {content}
      </motion.a>
    );
  return (
    <motion.button type="button" onClick={onClick} aria-label={label} className={cls} style={style} whileTap={pressSmall} transition={bouncy}>
      {content}
    </motion.button>
  );
}

/** The big rounded button: Register, Show results, Connect. */
export function PrimaryButton({
  children,
  onClick,
  href,
  external,
  disabled,
  className,
  tone = "accent",
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  disabled?: boolean;
  className?: string;
  tone?: "accent" | "fill";
}) {
  const cls = cn(
    "flex h-[52px] items-center justify-center gap-2 rounded-full px-6 text-body font-semibold outline-none select-none",
    tone === "accent" ? "bg-accent text-on-accent" : "bg-fill text-label",
    disabled && "pointer-events-none opacity-45",
    className,
  );
  if (href)
    return (
      <motion.a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        onClick={external ? onClick : linkTo(href)}
        className={cls}
        whileTap={press}
        transition={bouncy}
      >
        {children}
      </motion.a>
    );
  return (
    <motion.button type="button" onClick={onClick} disabled={disabled} className={cls} whileTap={press} transition={bouncy}>
      {children}
    </motion.button>
  );
}

// ---------------------------------------------------------------- headers

/**
 * True once the page (or the given scroll container) has scrolled past
 * `threshold`. It flips back a little lower than it flipped on, so a scroll
 * resting near the threshold (or iOS momentum) can't toggle it back and forth.
 */
export function useScrolled(threshold = 44, ref?: RefObject<HTMLElement | null>): boolean {
  const [scrolled, setScrolled] = useState(false);
  // Tabs stay mounted while hidden and share the window's scroll; a hidden tab
  // ignores it, so it comes back exactly as it was left (its scroll is restored).
  const active = useContext(TabActiveContext);
  const live = useRef(active);
  live.current = active;
  useEffect(() => {
    const el = ref?.current;
    const read = () => {
      if (!el && !live.current) return;
      const y = el ? el.scrollTop : window.scrollY;
      setScrolled((was) => (was ? y > threshold - 12 : y > threshold));
    };
    const target: HTMLElement | Window = el ?? window;
    target.addEventListener("scroll", read, { passive: true });
    read();
    return () => target.removeEventListener("scroll", read);
  }, [threshold, ref]);
  return scrolled;
}

/** Whether the tab a component lives in is the one showing (App provides it). */
export const TabActiveContext = createContext(true);

/** The backing of a bar that appears on scroll (styled in index.css: no blur, so Safari can't flicker it). */
export function BarBacking({ show }: { show: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="bar-backing absolute inset-0 border-b"
      data-show={show || undefined}
    />
  );
}

/** iOS large title, with an optional line above it and buttons to its right. */
export function LargeTitle({ eyebrow, title, subtitle, accessory }: { eyebrow?: ReactNode; title: string; subtitle?: ReactNode; accessory?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-3 px-5 pt-[calc(env(safe-area-inset-top)+18px)]">
      <div className="min-w-0">
        {eyebrow && <div className="text-footnote font-semibold tracking-[0.02em] text-label-2 uppercase">{eyebrow}</div>}
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="text-large font-bold tracking-[-0.028em]"
        >
          {title}
        </motion.h1>
        {subtitle && <div className="mt-0.5 text-footnote text-label-2">{subtitle}</div>}
      </div>
      {accessory && <div className="mb-0.5 flex shrink-0 gap-2.5">{accessory}</div>}
    </header>
  );
}

/** The slim bar that fades in once the large title scrolls away. */
export function CompactBar({ title, show, left, right }: { title: string; show: boolean; left?: ReactNode; right?: ReactNode }) {
  return (
    // While its tab slides, the tab (transformed) becomes what "fixed" is relative to; --tab-scroll keeps the bar at the top of the screen.
    <div aria-hidden={!show} className={cn("fixed inset-x-0 top-[var(--tab-scroll,0px)] z-30", !show && "pointer-events-none")}>
      <BarBacking show={show} />
      <div className="relative px-4 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-11 max-w-[720px] items-center justify-between gap-3">
          <div className="flex w-16 justify-start">{left}</div>
          <div className="bar-title min-w-0 truncate text-body font-semibold" data-show={show || undefined}>
            {title}
          </div>
          <div className="flex w-16 justify-end">{right}</div>
        </div>
      </div>
    </div>
  );
}

export function SectionHeader({ title, eyebrow, action, href, onAction }: { title: string; eyebrow?: ReactNode; action?: string; href?: string; onAction?: () => void }) {
  return (
    <div className="mx-5 mt-8 mb-2.5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow}
        <h2 className="text-title2 font-bold tracking-[-0.022em]">{title}</h2>
      </div>
      {action &&
        (href ? (
          <a href={href} onClick={linkTo(href)} className="mb-0.5 shrink-0 text-subhead font-medium text-tint">
            {action}
          </a>
        ) : (
          <button type="button" onClick={onAction} className="mb-0.5 shrink-0 text-subhead font-medium text-tint">
            {action}
          </button>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------- grouped lists

export function Group({ header, footer, children, className }: { header?: ReactNode; footer?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mx-4 mt-6", className)}>
      {header && <h3 className="mx-4 mb-1.5 text-footnote font-medium tracking-[0.01em] text-label-2 uppercase">{header}</h3>}
      <div className="card overflow-hidden rounded-[22px] [&>*:last-child_.row-line]:border-b-0">{children}</div>
      {footer && <p className="mx-4 mt-1.5 text-footnote text-label-2">{footer}</p>}
    </section>
  );
}

function RowIcon({ icon, bg }: { icon: IconName; bg?: string }) {
  if (!bg) return <Icon name={icon} size={21} className="shrink-0 text-tint" />;
  return (
    <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: bg }}>
      <Icon name={icon} size={18} stroke={2.1} />
    </span>
  );
}

export function RowLink({
  icon,
  iconBg,
  label,
  hint,
  value,
  onClick,
  href,
  external,
  destructive,
  tinted,
  chevron = true,
}: {
  icon?: IconName;
  iconBg?: string;
  label: ReactNode;
  hint?: ReactNode;
  value?: ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  destructive?: boolean;
  tinted?: boolean;
  chevron?: boolean;
}) {
  const inner = (
    <>
      {icon && <RowIcon icon={icon} bg={iconBg} />}
      <span className="row-line flex min-h-[50px] min-w-0 flex-1 items-center gap-2 border-b hairline py-2.5 pr-4">
        <span className="min-w-0 flex-1">
          <span className={cn("block text-body tracking-[-0.02em]", destructive ? "text-red" : tinted ? "text-tint" : "text-label")}>{label}</span>
          {hint && <span className="block text-footnote text-label-2">{hint}</span>}
        </span>
        {value !== undefined && <span className="shrink-0 text-body tracking-[-0.02em] text-label-2">{value}</span>}
        {chevron && <Icon name="chevron" size={14} stroke={2.8} className="shrink-0 text-label-3" />}
      </span>
    </>
  );
  const cls = "flex w-full items-center gap-3.5 pl-4 text-left outline-none transition-colors active:bg-fill";
  if (href)
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
        onClick={external ? onClick : linkTo(href)}
        className={cls}
      >
        {inner}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-accent" : "bg-track", disabled && "opacity-45")}
    >
      <motion.span
        initial={false}
        animate={{ x: checked ? 20 : 0 }}
        whileTap={{ scaleX: 1.15 }}
        transition={bouncy}
        className="absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.16)]"
      />
    </button>
  );
}

export function RowToggle({
  icon,
  iconBg,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  icon?: IconName;
  iconBg?: string;
  label: ReactNode;
  hint?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex w-full items-center gap-3.5 pl-4", disabled && "opacity-50")}>
      {icon && <RowIcon icon={icon} bg={iconBg} />}
      <span className="row-line flex min-h-[50px] min-w-0 flex-1 items-center gap-3 border-b hairline py-2.5 pr-3.5">
        <span className="min-w-0 flex-1">
          <span className="block text-body tracking-[-0.02em]">{label}</span>
          {hint && <span className="block text-footnote text-label-2">{hint}</span>}
        </span>
        <Toggle checked={checked} onChange={onChange} label={typeof label === "string" ? label : "Toggle"} disabled={disabled} />
      </span>
    </div>
  );
}

export function RowMenu<T extends string>({
  icon,
  iconBg,
  label,
  value,
  options,
  onChange,
}: {
  icon?: IconName;
  iconBg?: string;
  label: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <Menu
      value={value}
      items={options}
      onSelect={onChange}
      align="end"
      trigger={
        <button type="button" className="flex w-full items-center gap-3.5 pl-4 text-left outline-none transition-colors active:bg-fill">
          {icon && <RowIcon icon={icon} bg={iconBg} />}
          <span className="row-line flex min-h-[50px] min-w-0 flex-1 items-center gap-1.5 border-b hairline py-2.5 pr-4">
            <span className="min-w-0 flex-1 text-body tracking-[-0.02em]">{label}</span>
            <span className="shrink-0 text-body tracking-[-0.02em] text-label-2">{current}</span>
            <Icon name="updown" size={14} stroke={2.6} className="shrink-0 text-label-3" />
          </span>
        </button>
      }
    />
  );
}

// ---------------------------------------------------------------- segmented

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div role="radiogroup" aria-label={label} className={cn("relative flex h-[34px] rounded-[10px] bg-fill p-[2px]", className)}>
      {/* The thumb moves by position rather than shared layout, so it never holds up a closing sheet or page. */}
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ x: `${index * 100}%` }}
        transition={bouncy}
        className="absolute top-[2px] bottom-[2px] left-[2px] rounded-[8px] shadow-[0_3px_8px_rgba(0,0,0,0.12),0_0_0_0.5px_rgba(0,0,0,0.04)]"
        style={{ width: `calc((100% - 4px) / ${options.length})`, background: "var(--seg-on)" }}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn("relative flex flex-1 items-center justify-center rounded-[8px] px-1 text-[13.5px] tracking-[-0.01em] text-label transition-[font-weight]", on ? "font-semibold" : "font-medium")}
          >
            <span className="flex items-center gap-1 truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- menus

export interface MenuItem<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  destructive?: boolean;
}

/**
 * A popover menu that springs out of its button, iOS context-menu style. The
 * animation is CSS (index.css, .menu): Radix starts it only once the menu is
 * in place, so it never flashes at the wrong spot, and it runs on the
 * compositor.
 */
export function Menu<T extends string>({
  trigger,
  items,
  value,
  onSelect,
  align = "start",
  title,
}: {
  trigger: ReactNode;
  items: MenuItem<T>[];
  value?: T;
  onSelect: (v: T) => void;
  align?: "start" | "end" | "center";
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={8} collisionPadding={12} className="menu glass z-[70] min-w-[230px] overflow-hidden rounded-[18px] py-1.5 outline-none">
          {title && <div className="px-4 pt-1.5 pb-1 text-footnote text-label-2">{title}</div>}
          {items.map((it) => (
            <button
              key={it.value}
              type="button"
              onClick={() => {
                onSelect(it.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-[11px] text-left text-body tracking-[-0.02em] outline-none active:bg-fill",
                it.destructive ? "text-red" : "text-label",
              )}
            >
              <span className="flex w-4 shrink-0 justify-center">{value === it.value && <Icon name="check" size={16} stroke={2.6} />}</span>
              <span className="flex-1">{it.label}</span>
              {it.icon && <Icon name={it.icon} size={19} className="shrink-0" />}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ---------------------------------------------------------------- sheet

/**
 * A bottom sheet that springs up, and closes when dragged down or flicked.
 * Opening and closing are CSS animations on Radix's open/closed state
 * (index.css, .sheet); dragging moves an inner layer, which is reset every
 * time the sheet opens so it always comes up fully.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  left,
  right,
  children,
  footer,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  description?: string;
}) {
  const inner = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (open && inner.current) {
      inner.current.getAnimations().forEach((a) => a.cancel());
      inner.current.style.transform = "";
    }
  }, [open]);

  const onHandle = (e: ReactPointerEvent<HTMLDivElement>) => {
    const node = inner.current;
    if (!node || (e.pointerType === "mouse" && e.button !== 0)) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const start = e.clientY;
    let y = 0;
    let last = e.clientY;
    let lastT = performance.now();
    let velocity = 0;
    const move = (ev: PointerEvent) => {
      const now = performance.now();
      velocity = (ev.clientY - last) / Math.max(1, now - lastT);
      last = ev.clientY;
      lastT = now;
      const d = ev.clientY - start;
      y = d >= 0 ? d : d * 0.08; // a little give upwards
      node.style.transform = `translate3d(0,${y}px,0)`;
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (y > 120 || velocity > 0.7) onOpenChange(false);
      else slide(node, "y", y, 0, "sheet");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim fixed inset-0 z-[60]" style={{ background: "var(--scrim)" }} />
        <DialogPrimitive.Content aria-describedby={undefined} className="sheet fixed inset-x-2 bottom-2 z-[61] mx-auto max-w-[560px] outline-none">
          <div ref={inner} className="flex max-h-[calc(100dvh-60px)] flex-col overflow-hidden rounded-[38px] page-bg shadow-[0_-8px_40px_rgba(0,0,0,0.25)]">
            <div className="shrink-0 cursor-grab touch-none pt-1.5 active:cursor-grabbing" onPointerDown={onHandle}>
              <div className="mx-auto h-[5px] w-9 rounded-full bg-label-3" />
              <div className="flex h-12 items-center justify-between gap-3 px-3.5">
                <div className="flex min-w-[44px]">{left}</div>
                <DialogPrimitive.Title className="truncate text-body font-semibold">{title}</DialogPrimitive.Title>
                <div className="flex min-w-[44px] justify-end">{right}</div>
              </div>
            </div>
            {description && <DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">{children}</div>
            {footer && <div className="shrink-0 px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))]">{footer}</div>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------- toast

const TOAST_ICON: Record<string, IconName> = { check: "check", bookmark: "bookmark", "eye-off": "eyeOff", bell: "bell", alert: "alert" };

export function ToastView() {
  const t = useToast();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+10px)] z-[90] flex justify-center px-4">
      <AnimatePresence>
        {t && (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -16, scale: 0.95, transition: { duration: 0.18 } }}
            transition={bouncy}
            role="status"
            className="glass flex h-11 items-center gap-2 rounded-full pr-5 pl-4 text-subhead font-semibold"
          >
            <Icon name={TOAST_ICON[t.icon ?? "check"]} size={17} stroke={2.5} filled={t.icon === "bookmark"} className="text-tint" />
            {t.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- hackathon bits

const TONE: Record<string, string> = {
  red: "bg-red-soft text-red",
  orange: "bg-orange-soft text-orange",
  neutral: "bg-neutral-soft text-label-2",
};

export function DueTag({ h, className }: { h: Hackathon; className?: string }) {
  const d = dueTag(h);
  return (
    <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-[6px] px-[7px] text-caption font-semibold whitespace-nowrap", TONE[d.tone], className)}>
      <Icon name="clock" size={11} stroke={2.8} />
      {d.text}
    </span>
  );
}

export function StageTag({ status, className }: { status: Stage; className?: string }) {
  const tone = status === "registered" || status === "won" ? "bg-green-soft text-green" : status === "hidden" ? "bg-neutral-soft text-label-2" : "bg-soft text-ink";
  return <span className={cn("inline-flex h-5 shrink-0 items-center rounded-[6px] px-[7px] text-caption font-semibold whitespace-nowrap", tone, className)}>{stageLabel(status)}</span>;
}

/** The listing's own art, else the organizer's logo on a white tile, else a gradient tile with a glyph. */
export function Thumb({ h, size, radius, className, contain }: { h: Hackathon; size: number; radius?: number; className?: string; contain?: boolean }) {
  const art = iconOf(h);
  const [failed, setFailed] = useState(false);
  const glyph = fallbackArt(h);
  const r = radius ?? Math.round(size * 0.24);
  const src = failed ? null : (art?.src ?? null);
  const isLogo = !!art?.logo;
  return (
    <span
      className={cn("thumb-line relative flex shrink-0 items-center justify-center overflow-hidden text-white", className)}
      style={{ width: size, height: size, borderRadius: r, background: src ? (isLogo ? "#fff" : "var(--card)") : glyph.gradient }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn("h-full w-full", isLogo ? "object-contain p-[16%]" : contain ? "object-contain" : "object-cover")}
        />
      ) : (
        <svg width={size * 0.46} height={size * 0.46} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={glyph.glyph} />
        </svg>
      )}
    </span>
  );
}

export function Chip({ children, active, onClick, removable, className }: { children: ReactNode; active?: boolean; onClick: () => void; removable?: boolean; className?: string }) {
  return (
    <motion.button
      type="button"
      layout
      onClick={onClick}
      aria-pressed={active}
      whileTap={press}
      transition={bouncy}
      className={cn(
        "flex h-[34px] shrink-0 items-center gap-1 rounded-full text-[14.5px] font-semibold whitespace-nowrap",
        active ? "bg-soft pr-2.5 pl-3 text-ink" : "card px-3 text-label",
        className,
      )}
    >
      {children}
      {removable && <Icon name="close" size={15} stroke={2.6} aria-label="Remove" role="img" aria-hidden={false} />}
    </motion.button>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring} className="flex flex-col items-center px-8 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-soft text-tint">
        <Icon name={icon} size={26} />
      </span>
      <p className="mt-4 text-title3 font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-[320px] text-subhead text-label-2">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function Banner({ icon = "alert", children, onDismiss, tone = "orange" }: { icon?: IconName; children: ReactNode; onDismiss?: () => void; tone?: "orange" | "accent" }) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
      className="overflow-hidden"
    >
      <div role="status" className={cn("mx-4 mt-4 flex items-start gap-3 rounded-[18px] px-4 py-3", tone === "orange" ? "bg-orange-soft" : "bg-soft")}>
        <Icon name={icon} size={18} className={cn("mt-0.5 shrink-0", tone === "orange" ? "text-orange" : "text-tint")} />
        <div className="flex-1 text-subhead text-label">{children}</div>
        {onDismiss && (
          <button type="button" aria-label="Dismiss" onClick={onDismiss} className="-m-1 rounded-full p-1 text-label-2">
            <Icon name="close" size={16} stroke={2.4} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
