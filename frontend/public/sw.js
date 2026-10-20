/*
 * Service worker: makes the installed app open instantly and work offline with
 * the data it last loaded.
 *
 * - Pages: network first (so a new deploy shows up right away), falling back
 *   to the cached app shell when offline.
 * - /assets/*: cache first. Their file names change with every build.
 * - The data snapshot on GitHub Pages: network first, cached copy when offline.
 * - Everything else (the API, personal data) goes straight to the network.
 *
 * It also shows push notifications sent by the server (backend/app/push.py)
 * and opens the right page when one is tapped.
 */
const VERSION = "v3";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL, ASSETS, DATA]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(fallbackKey ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(fallbackKey ?? request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    // Every page is the same app shell; keep one copy of it.
    event.respondWith(networkFirst(request, SHELL, "/"));
  } else if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request, ASSETS));
  } else if (url.hostname.endsWith("github.io") && url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request, DATA));
  } else if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, ASSETS));
  }
});

// ---------------------------------------------------------------- push

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Hackathon Radar", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Hackathon Radar";
  const options = {
    body: data.body || "",
    tag: data.tag || "radar",
    renotify: true,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/" },
  };
  const badge =
    typeof data.badge === "number" && "setAppBadge" in self.navigator
      ? (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => undefined)
      : Promise.resolve();
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  // Tells the app the open came from a notification (for the stats page).
  target.searchParams.set("from", "push");
  const url = target.href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        return open.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : undefined));
      }
      return self.clients.openWindow(url);
    }),
  );
});
