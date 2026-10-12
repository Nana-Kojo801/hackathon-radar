import { cn } from "../../lib/utils";

/** An on/off switch with its label and an optional hint; the whole row is the control. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-[10px] py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-teal/30 disabled:opacity-50"
    >
      <span className="min-w-0">
        <span className="block text-[15.5px] font-medium text-ink">{label}</span>
        {hint && <span className="block text-[13.5px] leading-snug text-slate">{hint}</span>}
      </span>
      <span
        aria-hidden="true"
        className={cn("relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-200", checked ? "bg-teal" : "bg-[#d5dde8]")}
      >
        <span
          className={cn(
            "absolute top-[3px] left-[3px] h-5 w-5 rounded-full bg-white shadow-[0_1px_2px_rgba(10,16,51,0.25)] transition-transform duration-200",
            checked && "translate-x-5",
          )}
        />
      </span>
    </button>
  );
}
