import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";

import { cn } from "../../lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "group inline-flex h-10 items-center justify-between gap-3 rounded-[10px] border border-field-line bg-white px-3.5 text-[15px] font-medium text-ink-2 transition-colors outline-none hover:border-[#c9d5e4] focus-visible:ring-2 focus-visible:ring-teal/30 data-[state=open]:border-teal/50 [&>span]:truncate",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 text-ink-2 transition-transform duration-200 group-data-[state=open]:rotate-180" strokeWidth={2.2} />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      sideOffset={6}
      className={cn(
        "anim-pop relative z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-[12px] border border-line bg-white p-1 shadow-[0_12px_32px_-12px_rgba(10,16,51,0.25)]",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-[inherit] overflow-y-auto">{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex h-9 w-full items-center rounded-[8px] pr-8 pl-3 text-[14.5px] text-ink-2 outline-none select-none data-[highlighted]:bg-[#eef6fb] data-[state=checked]:font-semibold data-[state=checked]:text-teal",
      className,
    )}
    {...props}
  >
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    <SelectPrimitive.ItemIndicator className="absolute right-2.5">
      <Check className="h-4 w-4" strokeWidth={2.4} />
    </SelectPrimitive.ItemIndicator>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

/** A labelled select as laid out in the filter bar: small label above, field below. */
export function FieldSelect<T extends string>({
  label,
  value,
  onChange,
  options,
  className,
  triggerClassName,
  prefix,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  triggerClassName?: string;
  prefix?: ReactNode;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && <span className="text-[13.5px] font-medium text-[#4a5fb0]">{label}</span>}
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className={triggerClassName} aria-label={label}>
          <span className="flex items-center gap-2 truncate">
            {prefix}
            <SelectValue>{current?.label}</SelectValue>
          </span>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
