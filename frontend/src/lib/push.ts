import { useCallback, useEffect, useState } from "react";

import { fetchJSON } from "./api";
import { call, personalState, sync, updateSettings } from "./personal";

/**
 * Push notifications for the installed app. The browser subscribes with the
 * server's public key, the subscription goes to /me/push, and app.notify sends
 * to it after each refresh. On iPhone, Web Push only works once the app is on
 * the Home Screen (iOS 16.4+).
 */

export type PushStatus =
  | "checking"
  | "unsupported" // this browser can't do Web Push
  | "install" // iPhone/iPad in Safari: add to Home Screen first
  | "no-key" // the device isn't connected (personal key)
  | "denied" // notifications blocked in system settings
  | "server-off" // VAPID_PRIVATE_KEY isn't set on the server
  | "off"
  | "on";

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

function keyBytes(base64url: string): Uint8Array {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushStatus(): Promise<PushStatus> {
  if (isIOS() && !isStandalone()) return "install";
  if (!supported()) return "unsupported";
  if (!personalState().key) return "no-key";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

/** Ask for permission and subscribe. Call it straight from a tap: browsers require that. */
export async function enablePush(): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const { key } = await fetchJSON<{ key: string | null }>("/push/key");
  if (!key) return "server-off";
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // A subscription made with an older key can't be reused.
    const current = sub.options.applicationServerKey;
    const same = current && btoa(String.fromCharCode(...new Uint8Array(current))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === key;
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource });
  const json = sub.toJSON();
  await call("/me/push", { method: "POST", body: { endpoint: json.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 300) } });
  // Quiet hours are kept in this phone's timezone.
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && personalState().settings?.timezone !== tz) updateSettings({ timezone: tz });
  else void sync();
  return "on";
}

export async function disablePush(): Promise<PushStatus> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await call("/me/push", { method: "DELETE", body: { endpoint } }).catch(() => undefined);
    void sync();
  }
  return "off";
}

export async function testPush(): Promise<void> {
  await call("/me/push/test", { method: "POST" });
}

export function usePushStatus(): [PushStatus, (s: PushStatus) => void, () => void] {
  const [status, setStatus] = useState<PushStatus>("checking");
  const refresh = useCallback(() => {
    pushStatus()
      .then(setStatus)
      .catch(() => setStatus("unsupported"));
  }, []);
  useEffect(() => {
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [refresh]);
  return [status, setStatus, refresh];
}

/** The number on the app icon: saved hackathons whose registration closes within a week. */
export function setBadge(n: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch {
    /* not supported */
  }
}
