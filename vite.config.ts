import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Sur GitHub Pages l'app est servie sous /HandBase/ (défini par le workflow de déploiement),
// VITE_TRIAL=1 : version d'essai testée en local (bandeau, base locale séparée).
const trial = !!process.env.VITE_TRIAL

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Mise à jour : nouvelle version mise en attente, appliquée par src/pwa.ts quand aucune saisie n'est en cours.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        // Identifiant d’app stable (même forme que l’adresse de démarrage).
        id: '/HandBase/',
        name: trial ? 'HandBase — ESSAI' : 'HandBase — Collecte & suivi',
        short_name: trial ? 'HB essai' : 'HandBase',
        description: 'Données physiques et évaluations des joueurs de handball',
        lang: 'fr',
        theme_color: '#1e1e2e',
        background_color: '#1e1e2e',
        display: 'standalone',
        start_url: './',
        scope: './',
        // Chrome Android exige des icônes PNG 192 et 512 pour installer l'app.
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        // Première installation : la page ouverte passe tout de suite sous le service worker (hors ligne).
        clientsClaim: true,
        // Réception des notifications (public/push-sw.js).
        importScripts: ['push-sw.js'],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
        ],
      },
    }),
  ],
  server: { host: true },
})
