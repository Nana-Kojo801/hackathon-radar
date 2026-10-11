import { Search } from "lucide-react";
import type { ReactNode } from "react";

import { navigate } from "../lib/router";
import { cn } from "../lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 wide:h-9 wide:w-9", className)} aria-hidden="true">
      <circle cx="15" cy="17" r="12" fill="none" stroke="#0D869D" strokeWidth="2.6" />
      <circle cx="15" cy="17" r="6.5" fill="none" stroke="#0D869D" strokeWidth="2.6" />
      <path d="M15 17 L27 5" stroke="#F04A23" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M21.5 4.5 L27.5 4.5 L27.5 10.5" fill="none" stroke="#F04A23" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandLink() {
  return (
    <a
      href="/"
      onClick={(e) => {
        e.preventDefault();
        navigate("/");
      }}
      className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-teal/40"
      aria-label="Hackathon Radar, all hackathons"
    >
      <Logo />
      <span className="text-[19px] font-semibold wide:text-[21px] tracking-[-0.01em] text-ink">Hackathon Radar</span>
    </a>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  size = "md",
  autoFocus,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  autoFocus?: boolean;
  id?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-[12px] border border-field-line bg-field text-ink transition-[border-color,box-shadow,background-color] focus-within:border-teal/40 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(1,124,145,0.1)]",
        size === "lg" ? "h-[52px] px-5" : size === "md" ? "h-12 px-4" : "h-10 px-3.5",
        className,
      )}
    >
      <Search className={cn("shrink-0 text-[#7a8fc9]", size === "lg" ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]")} strokeWidth={2} />
      <span className="sr-only">Search hackathons</span>
      <input
        type="search"
        id={id}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#8a9bcf]",
          size === "lg" ? "text-[17px]" : size === "md" ? "text-[16px]" : "text-[14.5px]",
        )}
      />
    </label>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-[60px] items-center gap-6 border-b border-line px-5 wide:h-[74px] wide:px-7">
      <BrandLink />
      {children}
    </header>
  );
}
