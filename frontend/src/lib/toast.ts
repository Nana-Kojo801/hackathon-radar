import { useSyncExternalStore } from "react";

/** One short confirmation at a time ("Link copied", "Saved"), shown at the top of the screen. */

export interface Toast {
  id: number;
  text: string;
  icon?: "check" | "bookmark" | "eye-off" | "bell" | "alert";
}

let current: Toast | null = null;
let timer: number | undefined;
let seq = 0;
const listeners = new Set<() => void>();

export function toast(text: string, icon: Toast["icon"] = "check"): void {
  current = { id: ++seq, text, icon };
  listeners.forEach((l) => l());
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    current = null;
    listeners.forEach((l) => l());
  }, 2200);
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or no clipboard permission: the textarea trick still works.
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}
