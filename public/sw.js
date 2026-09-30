// NVBC push notifications — for staff (open the admin panel) and for customers about their booking
// (open My booking). Shows the notification, and opens its page when it's tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "NVBC", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "NVBC", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || undefined, // a newer notification about the same booking replaces the older one
      renotify: !!data.tag,
      data: { url: data.url || "/admin" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/admin", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Reuse an open NVBC tab of the same kind (admin panel, or My booking) if there is one.
      const target = new URL(url).pathname;
      const area = (p) => (p.startsWith("/admin") ? "/admin" : p);
      for (const w of wins) {
        if (area(new URL(w.url).pathname) === area(target) && "focus" in w) {
          await w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    })()
  );
});
