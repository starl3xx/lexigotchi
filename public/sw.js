/*
 * Lexigotchi's service worker: browser push reminders, and nothing else.
 *
 * There is deliberately NO `fetch` handler. A worker that intercepts requests can serve stale game
 * code, break wallet popups, or misbehave inside a host webview; this one only shows notifications
 * and opens the game when one is tapped. Registered by `useWebPush` (src/components/game) on the
 * open web only, never inside a Farcaster or Base App host, which have their own notifications.
 *
 * Payload (src/lib/notify/webPush.ts → buildWebPushPayload): { title, body, url, tag }.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Lexigotchi";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      // Same tag = the newer message replaces the older one instead of stacking (a retried send).
      tag: data.tag || undefined,
      data: { url: sameOriginUrl(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/play";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).pathname.startsWith("/play") && "focus" in w) {
          await w.focus();
          if ("navigate" in w && w.url !== target) await w.navigate(target).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/** Only ever open our own pages from a notification, whatever the payload says. */
function sameOriginUrl(url) {
  try {
    const u = new URL(url || "/play", self.location.origin);
    return u.origin === self.location.origin ? u.href : new URL("/play", self.location.origin).href;
  } catch {
    return new URL("/play", self.location.origin).href;
  }
}
