// HandBase : réception des notifications (ajouté au service worker de l'appli, vite.config.ts).
// Message envoyé par la fonction Supabase « notify » : { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    Promise.all([bumpBadge(), self.registration.showNotification(d.title || 'HandBase', {
      body: d.body || '',
      // Même sujet : la nouvelle remplace l'ancienne au lieu de s'empiler.
      tag: d.tag,
      renotify: !!d.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || '/' },
    })]),
  )
})

// Pastille sur l'icône : +1 par notification, à partir du dernier chiffre posé par l'appli (src/push.ts,
// cache « hb-badge »). L'appli remet le chiffre exact à sa prochaine ouverture.
async function bumpBadge() {
  if (!self.navigator.setAppBadge) return
  try {
    const key = new URL('badge-count', self.registration.scope).href
    const c = await caches.open('hb-badge')
    const r = await c.match(key)
    const n = (r ? Number(await r.text()) || 0 : 0) + 1
    await c.put(key, new Response(String(n)))
    await self.navigator.setAppBadge(n)
  } catch {
    /* non pris en charge */
  }
}

// Appui sur la notification : ouvrir (ou ramener au premier plan) l'appli sur la bonne page.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = String((event.notification.data && event.notification.data.url) || '/').replace(/^\//, '')
  const url = new URL(path, self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.startsWith(self.registration.scope) && 'focus' in w) {
          if ('navigate' in w) w.navigate(url)
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
