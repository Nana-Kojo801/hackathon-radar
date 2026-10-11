import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center whitespace-nowrap rounded-[8px] font-medium leading-none", {
  variants: {
    tone: {
      sky: "bg-pill-sky-bg text-pill-sky",
      blue: "bg-pill-blue-bg text-pill-blue",
      green: "bg-pill-green-bg text-pill-green",
      red: "bg-pill-red-bg text-pill-red",
      grey: "bg-pill-grey-bg text-pill-grey",
    },
    size: {
      sm: "h-[24px] px-2.5 text-[13px]",
      md: "h-[30px] px-3 text-[15px]",
    },
  },
  defaultVariants: { tone: "blue", size: "md" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
