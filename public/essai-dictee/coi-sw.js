// Service worker de la page d'essai de dictée, limité à /essai-dictee/ (portée « ./ »).
// Il ajoute aux réponses du site les en-têtes d'isolation (COOP / COEP) que GitHub Pages ne sait pas
// envoyer, pour que la page soit « crossOriginIsolated » et que Whisper puisse calculer sur plusieurs cœurs.
// Même principe que coi-serviceworker (MIT), réécrit au plus court. Il ne met rien en cache et ne touche
// pas aux requêtes vers d'autres sites (CDN, Hugging Face) : elles passent en CORS, admises sous COEP.
// Le service worker de l'application (portée racine) n'est pas concerné : pour les pages de
// /essai-dictee/, le navigateur retient celui dont la portée est la plus précise, celui-ci.

const coep = new URL(self.location.href).searchParams.get('coep') === 'require-corp' ? 'require-corp' : 'credentialless'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (new URL(req.url).origin !== self.location.origin) return
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return
  event.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0) return res
      const headers = new Headers(res.headers)
      headers.set('Cross-Origin-Embedder-Policy', coep)
      headers.set('Cross-Origin-Opener-Policy', 'same-origin')
      headers.set('Cross-Origin-Resource-Policy', 'same-origin')
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
    }),
  )
})
