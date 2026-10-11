import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-fade fixed inset-0 z-50 bg-[#0a1033]/35 backdrop-blur-[1px]" />
        <DialogPrimitive.Content className="anim-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-[20px] bg-white shadow-[0_-12px_40px_-12px_rgba(10,16,51,0.3)] outline-none">
          <div className="flex justify-center pt-2.5">
            <span className="h-1.5 w-10 rounded-full bg-[#d8e0eb]" />
          </div>
          <div className="flex items-center justify-between px-5 pt-2 pb-3">
            <DialogPrimitive.Title className="text-[20px] font-bold text-ink">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="flex h-9 w-9 items-center justify-center rounded-full text-slate hover:bg-field" aria-label="Close">
              <X className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">Narrow down the list of hackathons.</DialogPrimitive.Description>
          <div className="overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
