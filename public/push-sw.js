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
    self.registration.showNotification(d.title || 'HandBase', {
      body: d.body || '',
      // Même sujet : la nouvelle remplace l'ancienne au lieu de s'empiler.
      tag: d.tag,
      renotify: !!d.tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || '/' },
    }),
  )
})

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
