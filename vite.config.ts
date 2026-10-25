import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { SPORT_WORDS } from './src/sportWordmark.ts'

// Sur GitHub Pages l'app est servie sous /HandBase/ (défini par le workflow de déploiement),
// VITE_TRIAL=1 : version d'essai testée en local (bandeau, base locale séparée).
const trial = !!process.env.VITE_TRIAL
// VITE_DEMO=1 : démonstration en ligne (dépôt HandBase-demo, base de test, données fictives).
const demo = !!process.env.VITE_DEMO
// HB_HTTPS=1 : serveur local en https (certificat auto-signé de ~/.config/handbase-https, hors du dépôt), pour essayer
// depuis un téléphone sur le même Wi-Fi avec un contexte sécurisé (micro de la dictée, etc.).
const certDir = `${homedir()}/.config/handbase-https`
const https =
  process.env.HB_HTTPS && existsSync(`${certDir}/key.pem`)
    ? { key: readFileSync(`${certDir}/key.pem`), cert: readFileSync(`${certDir}/cert.pem`) }
    : undefined

/** Fichiers d'un dossier, chemins relatifs (sous-dossiers compris). */
const filesOf = (dir: string) => (readdirSync(dir, { recursive: true }) as string[]).filter((f) => statSync(join(dir, f)).isFile())

/**
 * Dossier public de la construction. public/ porte les fichiers du handball (sport par défaut) ; public-sport/<sport>/ ceux
 * qui changent pour un autre sport (icônes de l'appli : tools/icones-sport.py), aux MÊMES chemins. Pour ce sport, Vite sert
 * et copie un dossier fusionné (node_modules/.cache/public-sport/<sport>) : public/, puis ses fichiers par-dessus. Manifeste,
 * index.html, service worker (empreintes de la mise en cache) et notifications (public/push-sw.js : icon-192.png) gardent
 * leurs chemins et voient les fichiers du sport. Fichiers réécrits seulement s'ils changent (serveurs lancés en parallèle).
 */
function sportPublicDir(root: string, sport: string) {
  const pub = resolve(root, 'public')
  const over = resolve(root, 'public-sport', sport)
  if (!existsSync(over)) return pub
  const dir = resolve(root, 'node_modules/.cache/public-sport', sport)
  const want = new Map<string, string>()
  for (const f of filesOf(pub)) want.set(f, join(pub, f))
  for (const f of filesOf(over)) want.set(f, join(over, f))
  for (const [f, from] of want) {
    const to = join(dir, f)
    const data = readFileSync(from)
    if (existsSync(to) && readFileSync(to).equals(data)) continue
    mkdirSync(dirname(to), { recursive: true })
    writeFileSync(to, data)
  }
  if (existsSync(dir)) for (const f of filesOf(dir)) if (!want.has(f)) rmSync(join(dir, f))
  return dir
}

export default defineConfig(({ mode }) => {
  // VITE_SPORT=volley : installation de volley par défaut (src/sportConfig.ts) ; ici, les icônes et le nom de l'appli
  // installée, l'écran d'ouverture et la description.
  const sport = (process.env.VITE_SPORT || loadEnv(mode, process.cwd(), 'VITE_').VITE_SPORT || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const sportWord = sport === 'volley' || sport === 'volleyball' ? 'volley' : 'handball'
  // VITE_APP_NAME : nom de l'appli installée (sous l'icône, écran de démarrage, titre de l'onglet), figé à la construction.
  // Défaut selon le sport : « Nextar Hand », « Nextar Volley » (12-13 lettres : tient sous une icône Android). Lu dans
  // l'environnement ou les fichiers .env (voir .env.example). Le nom affiché DANS l'appli reste « Nextar » (src/appBrand.ts :
  // le mot dessiné de la capsule « Demander », suivi du sport).
  const appName = (process.env.VITE_APP_NAME || loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_NAME || '').trim() || (sportWord === 'volley' ? 'Nextar Volley' : 'Nextar Hand')
  // Nom sous l'icône : « démo » / « essai » ajouté seulement s'il tient (12 caractères) ; sinon le nom seul (« Nextar Hand
  // démo » serait coupé) : le nom complet (« … — Démo ») et le bandeau de l'appli disent que c'est la démonstration.
  const shortName = (suffix: string) => (`${appName} ${suffix}`.length <= 12 ? `${appName} ${suffix}` : appName)
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // Écran d'ouverture (index.html) : le nom du sport dessiné sous le mot « Nextar » (src/sportWordmark.ts), et le viewBox
  // du mot agrandi vers le bas pour le contenir (« 50 60 870 215 » : le mot seul).
  const word = SPORT_WORDS[sportWord]
  const wordBox = `50 60 870 ${Math.ceil(word.bottom + 10 - 60)}`

  return {
    base: process.env.BASE_PATH || '/',
    // Fichiers publics du sport (icônes de l'appli) : voir sportPublicDir.
    publicDir: sportPublicDir(process.cwd(), sportWord),
    // Date de construction de la version (Réglages → « Version de l'appli »).
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
    plugins: [
      react(),
      tailwindcss(),
      // Nom de l'appli dans index.html (<title>, apple-mobile-web-app-title, application-name) : %APP_NAME% ; sport :
      // %SPORT% ; nom du sport de l'écran d'ouverture : %SPORT_WORD_BOX% (viewBox), %SPORT_WORD_PATH% (tracé).
      {
        name: 'app-name-html',
        transformIndexHtml: {
          order: 'pre',
          handler: (html: string) =>
            html
              .replace(/%APP_NAME%/g, escapeHtml(appName))
              .replace(/%SPORT_WORD_BOX%/g, wordBox)
              .replace(/%SPORT_WORD_PATH%/g, word.d)
              .replace(/%SPORT%/g, sportWord),
        },
      },
      VitePWA({
        // Mise à jour : nouvelle version mise en attente, appliquée par src/pwa.ts quand aucune saisie n'est en cours.
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'favicon-32.png', 'favicon-16.png', 'apple-touch-icon.png'],
        manifest: {
          // Identifiant d’app stable (même forme que l’adresse de démarrage). NE PAS CHANGER, même en renommant l'appli
          // (HandBase → Nextar) : Android et Chrome reconnaissent l'appli installée à cet id ; un autre id (ou un autre
          // start_url / scope) en ferait une nouvelle appli, installée à côté de l'ancienne. Nom et icônes se mettent à
          // jour seuls sur la même appli.
          id: process.env.BASE_PATH || '/HandBase/',
          name: demo ? `${appName} — Démo` : trial ? `${appName} — ESSAI` : appName,
          short_name: demo ? shortName('démo') : trial ? shortName('essai') : appName,
          description: `${appName} : données physiques et évaluations des jeunes joueurs de ${sportWord}`,
          lang: 'fr',
          // Bleu nuit du logo (début de son dégradé) : barre de titre et écran de démarrage Android.
          theme_color: '#0A182D',
          background_color: '#0A182D',
          display: 'standalone',
          start_url: './',
          scope: './',
          // Chrome Android exige des icônes PNG 192 et 512 pour installer l'app. Icônes du sport (tools/icones-sport.py) : le
          // logo Nextar (public/brand/nextar.svg) et le nom du sport dessous ; « maskable » : plein cadre bleu nuit, dessin
          // dans la zone sûre (cercle de 80 %). Handball : public/ ; autre sport : public-sport/<sport>/ (sportPublicDir).
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          navigateFallback: 'index.html',
          // Page d'essai autonome (public/essai-dictee/) : jamais remplacée par l'app, jamais installée d'avance.
          navigateFallbackDenylist: [/\/essai-dictee(\/|$)/],
          // Première installation : la page ouverte passe tout de suite sous le service worker (hors ligne).
          clientsClaim: true,
          // Réception des notifications (public/push-sw.js).
          importScripts: ['push-sw.js'],
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          // Lecteur de PDF (feuille de match, ~1,8 Mo avec son worker) : pas installé d'avance pour tout le monde,
          // gardé en cache au premier import (ensuite disponible hors ligne).
          globIgnores: ['**/assets/pdf-*.js', '**/assets/pdf.worker*', '**/essai-dictee/**'],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => /\/assets\/pdf(\.worker\.min)?-[\w-]+\.m?js$/.test(url.pathname),
              handler: 'CacheFirst',
              options: { cacheName: 'pdfjs', expiration: { maxEntries: 6 } },
            },
            // SQLite WASM (mode avancé de « Poser une question », ~650 Ko) : jamais installé d'avance, gardé en cache au
            // premier usage (les questions enregistrées se relancent ensuite hors ligne).
            {
              urlPattern: ({ url }) => /\/assets\/sql-wasm[\w.-]*\.wasm$/.test(url.pathname),
              handler: 'CacheFirst',
              options: { cacheName: 'sqlite-wasm', expiration: { maxEntries: 2 } },
            },
            {
              urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
              handler: 'CacheFirst',
              // Polices des styles de l'installation (src/uiStyle.ts) en plus de JetBrains Mono : de la place pour leurs fichiers.
              options: { cacheName: 'google-fonts', expiration: { maxEntries: 60, maxAgeSeconds: 31536000 } },
            },
          ],
        },
      }),
    ],
    server: { host: true, https },
  }
})
