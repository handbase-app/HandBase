import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

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

export default defineConfig(({ mode }) => {
  // VITE_APP_NAME : nom de l'appli installée (icône, écran de démarrage, titre de l'onglet), figé à la construction.
  // Défaut « Nextar ». Lu dans l'environnement ou les fichiers .env (voir .env.example). Le nom affiché dans
  // l'interface reste réglable à part (src/appBrand.ts).
  const appName = (process.env.VITE_APP_NAME || loadEnv(mode, process.cwd(), 'VITE_').VITE_APP_NAME || '').trim() || 'Nextar'
  // VITE_SPORT=volley : installation de volley par défaut (src/sportConfig.ts) ; ici, la description de l'appli seulement.
  const sport = (process.env.VITE_SPORT || loadEnv(mode, process.cwd(), 'VITE_').VITE_SPORT || '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  const sportWord = sport === 'volley' || sport === 'volleyball' ? 'volley' : 'handball'
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  return {
    base: process.env.BASE_PATH || '/',
    // Date de construction de la version (Réglages → « Version de l'appli »).
    define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
    plugins: [
      react(),
      tailwindcss(),
      // Nom de l'appli dans index.html (<title>, apple-mobile-web-app-title, application-name) : %APP_NAME%.
      {
        name: 'app-name-html',
        transformIndexHtml: { order: 'pre', handler: (html: string) => html.replace(/%APP_NAME%/g, escapeHtml(appName)).replace(/%SPORT%/g, sportWord) },
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
          short_name: demo ? `${appName} démo` : trial ? `${appName} essai` : appName,
          description: `${appName} : données physiques et évaluations des jeunes joueurs de ${sportWord}`,
          lang: 'fr',
          // Bleu nuit du logo (début de son dégradé) : barre de titre et écran de démarrage Android.
          theme_color: '#0A182D',
          background_color: '#0A182D',
          display: 'standalone',
          start_url: './',
          scope: './',
          // Chrome Android exige des icônes PNG 192 et 512 pour installer l'app. Icônes tirées de public/brand/nextar-pictogramme.svg (X + étoile filante) ;
          // « maskable » : plein cadre bleu nuit, logo dans la zone sûre (cercle de 80 %).
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
