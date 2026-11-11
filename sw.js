/* Service worker volontairement sans cache : les résultats restent à jour. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch {}
  event.waitUntil(self.registration.showNotification(data.title || 'Secret Santa 🎁', {
    body: data.body || 'Le tirage est terminé ! Ouvre ton espace.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'secret-santa-tirage',
    renotify: true,
    data: {url: '/'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL('/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
