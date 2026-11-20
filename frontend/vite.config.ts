import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// The service worker's imported scripts are fetched through the browser's
// HTTP cache (updateViaCache 'imports' is the default): a changed
// offline-sw.js / push-sw.js at the same URL could be served stale for a
// day. A content hash in the URL makes every change a new file.
const versioned = (file: string) =>
  `/${file}?v=${createHash('sha256').update(readFileSync(new URL(`./public/${file}`, import.meta.url))).digest('hex').slice(0, 10)}`

// One id per build. The running app knows its own (`__BUILD_ID__`) and the
// server publishes the deployed one in /version.json (served `no-cache` by
// nginx, never precached, never touched by the service worker): PwaStatus
// compares the two every few seconds and shows RECHARGER the moment a new
// build is on the server — without waiting for the browser's own (slower)
// service-worker update check.
const BUILD_ID = `${Date.now().toString(36)}-${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 6)}`

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [
    {
      name: 'build-version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' is required for the RECHARGER banner (PwaStatus.tsx) to
      // work at all: vite-plugin-pwa's register script only invokes
      // onNeedRefresh — the callback the banner is driven by — when
      // registerType is 'prompt'. Under 'autoUpdate' the plugin applies the
      // update and reloads on its own without ever calling onNeedRefresh, so
      // the banner would never appear no matter what PwaStatus.tsx does.
      // This was switched from 'autoUpdate' back to 'prompt' together with
      // the PwaStatus.tsx change (see its docblock) — the two must move
      // together, not just one.
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['favicon.jpg', 'icons/apple-touch-icon.png'],
      devOptions: {
        // Lets the service worker (and offline behaviour) be exercised with
        // `npm run dev`, not only in a production build.
        enabled: true,
        type: 'module',
      },
      manifest: {
        id: '/',
        name: 'Solution Administrative',
        short_name: 'Solution Admin',
        description: "Gestion RH et administrative multi-sites — pointage, congés, sanctions, caisse, personnel.",
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'fr',
        icons: [
          { src: '/icons/pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: '/icons/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Device notifications (Web Push): `push` / `notificationclick`
        // handlers live in public/push-sw.js (see usePushNotifications).
        // Offline API layer (cache + write queue): public/offline-sw.js.
        importScripts: [versioned('push-sw.js'), versioned('offline-sw.js')],
        // Images and fonts too, not only js/css/html (the default): the logo
        // was missing when the app was opened offline.
        globPatterns: ['**/*.{js,css,html,ico,png,jpg,jpeg,svg,webp,woff,woff2}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        // Never serve a cached/stale response for the API's auth check —
        // otherwise a stale "logged in" state could survive a token
        // revocation while offline.
        navigateFallbackDenylist: [/^\/api\//],
        // Every /api/* call (network-first reads with an offline copy, writes
        // queued when there is no network and replayed exactly once) is
        // handled by public/offline-sw.js — no Workbox runtimeCaching rule
        // may match /api/ any more, or both would answer the same request.
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/sanctum': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/sanctum': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
