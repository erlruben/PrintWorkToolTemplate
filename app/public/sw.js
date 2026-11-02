// Minimal service worker — just enough to make the tracker installable as a
// PWA (home-screen icon, full-screen) and to receive push notifications. It
// intentionally does NOT cache the app, so an auto-deployed update is always
// served fresh (no stale versions).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Pass through to the network — no offline caching.
});

// A push arrived (sent by the push-send Edge Function). Show it.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'PrintFlow', body: event.data && event.data.text() };
  }
  const title = data.title || 'PrintFlow';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
    }),
  );
});

// Tapping a notification focuses an open tab, or opens the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          if ('navigate' in client && url !== '/') client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
