self.addEventListener("push", (e) => {
  const d = (() => {
    try {
      return e.data.json();
    } catch (_) {
      return {};
    }
  })();
  e.waitUntil(
    self.registration.showNotification(d.title || "OpenLen", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: d.url || "/inbox" },
      tag: d.url || "openlen",
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    (async () => {
      const url = e.notification.data?.url || "/inbox";
      const all = await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const hit = all.find((c) => c.url.includes("/inbox"));
      if (hit) return hit.focus();
      return clients.openWindow(url);
    })(),
  );
});
