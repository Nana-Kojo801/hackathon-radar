import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-teal/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:active:scale-100 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-teal text-white shadow-[0_1px_2px_rgba(1,124,145,0.25)] hover:bg-teal-600 hover:shadow-[0_6px_16px_-6px_rgba(1,124,145,0.6)]",
        soft: "bg-chip text-ink-2 hover:bg-[#cfe3fb]",
        sky: "border border-[#cdeef5] bg-[#e8f8fb] text-[#0079cb] hover:border-[#a9e1ec] hover:bg-[#dcf3f8]",
        outline: "border border-field-line bg-white text-ink-2 hover:border-[#c9d5e4] hover:bg-field",
        quiet: "border border-[#e8edf6] bg-[#f4f7fc] text-[#a4b3e5]",
        ghost: "text-slate hover:bg-field hover:text-ink",
      },
      size: {
        sm: "h-9 px-3 text-[14px]",
        md: "h-10 px-4 text-[15px]",
        lg: "h-12 px-5 text-[16px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
