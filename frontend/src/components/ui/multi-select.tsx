import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "../../lib/utils";

interface Option {
  value: string;
  label: string;
  count?: number;
}

/**
 * A labelled multi-select for the filter bar, matching FieldSelect: a trigger
 * that reads "All categories", "AI & ML" or "AI & ML +2", and a checklist.
 */
export function FieldMultiSelect({
  label,
  allLabel,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  allLabel: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: Option[];
  className?: string;
}) {
  const chosen = options.filter((o) => value.includes(o.value));
  const summary = chosen.length === 0 ? allLabel : chosen.length === 1 ? chosen[0].label : `${chosen[0].label} +${chosen.length - 1}`;
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13.5px] font-medium text-[#4a5fb0]">{label}</span>
      <Popover.Root>
        <Popover.Trigger
          aria-label={`${label}: ${summary}`}
          className="group inline-flex h-10 w-full items-center justify-between gap-3 rounded-[10px] border border-field-line bg-white px-3.5 text-[15px] font-medium text-ink-2 transition-colors outline-none hover:border-[#c9d5e4] focus-visible:ring-2 focus-visible:ring-teal/30 data-[state=open]:border-teal/50"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-2 transition-transform duration-200 group-data-[state=open]:rotate-180" strokeWidth={2.2} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="anim-pop z-50 w-[260px] rounded-[12px] border border-line bg-white p-1 shadow-[0_12px_32px_-12px_rgba(10,16,51,0.25)] outline-none"
          >
            <button
              type="button"
              onClick={() => onChange([])}
              className={cn(
                "flex h-9 w-full items-center rounded-[8px] px-3 text-left text-[14.5px] text-ink-2 outline-none hover:bg-[#eef6fb] focus-visible:bg-[#eef6fb]",
                value.length === 0 && "font-semibold text-teal",
              )}
            >
              {allLabel}
            </button>
            <div className="my-1 h-px bg-line" />
            <div role="group" aria-label={label} className="max-h-[min(320px,var(--radix-popover-content-available-height))] overflow-y-auto">
              {options.map((o) => {
                const on = value.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(o.value)}
                    className="flex h-9 w-full items-center gap-2.5 rounded-[8px] px-3 text-left text-[14.5px] text-ink-2 outline-none hover:bg-[#eef6fb] focus-visible:bg-[#eef6fb]"
                  >
                    <span
                      className={cn(
                        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                        on ? "border-teal bg-teal text-white" : "border-[#c9d5e4] bg-white",
                      )}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <span className={cn("flex-1 truncate", on && "font-semibold text-ink")}>{o.label}</span>
                    {o.count !== undefined && <span className="text-[13px] text-slate">{o.count}</span>}
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

/** The same choice as chips, for the phone filter sheet. */
export function ChipMultiSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  options: Option[];
}) {
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-[13.5px] font-medium text-[#4a5fb0]">
        {label}
        {value.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-[13px] font-semibold text-teal-text">
            Clear
          </button>
        )}
      </span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(o.value)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors",
                on ? "border-teal bg-teal text-white" : "border-field-line bg-white text-ink-2 active:bg-field",
              )}
            >
              {on && <Check className="h-3.5 w-3.5" strokeWidth={2.6} />}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
