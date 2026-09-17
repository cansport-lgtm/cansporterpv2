// Web Push event handling, loaded into the Workbox-generated service worker
// via `importScripts` (see vite.config.ts) so it runs in the same worker as
// the app's precaching — no separate SW registration needed.
//
// This is what makes a notification arrive even when the app/PWA is fully
// closed: the browser wakes this service worker on a push message and we
// show it via the Notifications API. See docs/SYSTEM_NOTIFICATIONS.md.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Cansport ERP", body: event.data ? event.data.text() : undefined };
  }

  const title = data.title || "Cansport ERP";
  const options = {
    body: data.body,
    icon: "/pwa-192x192-v3.png",
    badge: "/pwa-192x192-v3.png",
    tag: data.tag,
    data: { link: data.link },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(link);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    }),
  );
});
