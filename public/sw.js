/* Service worker : reçoit les notifications push (Push API) et les affiche (Notifications API).
   Pas de cache hors ligne : l'appli reste toujours à jour. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Classe SIO', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: d.tag,
    lang: 'fr',
    data: { link: d.link || '' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = e.notification.data && e.notification.data.link || '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus();
        w.postMessage({ type: 'navigate', link });
        return;
      }
    }
    await self.clients.openWindow('/' + link);
  })());
});

// L'abonnement a expiré côté navigateur : on se réabonne et on prévient le serveur
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const r = await fetch('/api/push/key', { credentials: 'same-origin' });
    if (!r.ok) return;
    const { publicKey } = await r.json();
    const pad = '='.repeat((4 - publicKey.length % 4) % 4);
    const raw = atob((publicKey + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const key = Uint8Array.from(raw, c => c.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await fetch('/api/push/subscribe', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  })());
});
