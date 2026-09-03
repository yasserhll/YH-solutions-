import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A stale service worker is worse than a mid-session reload here: this
      // app is edited constantly, and 'prompt' left a fix sitting inert on
      // an already-installed device until someone happened to notice and
      // click an update toast. 'autoUpdate' activates a new worker and
      // reloads automatically as soon as one is available.
      registerType: 'autoUpdate',
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
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        // Never serve a cached/stale response for the API's auth check —
        // otherwise a stale "logged in" state could survive a token
        // revocation while offline.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Identity must never be cached by the service worker either —
            // the backend sends Cache-Control: no-store on every /api/*
            // response (stops the *browser's* HTTP cache), but Workbox's
            // own Cache Storage ignores that header and would cache this
            // by URL regardless. Without this exclusion, one account's
            // identity could still be served to a *different* account from
            // the offline fallback after a login switch on the same
            // browser. Must be registered before the general GET rule below
            // (first match wins).
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname === '/api/me',
            handler: 'NetworkOnly',
          },
          {
            // Every GET goes to the network first — this app is edited
            // constantly (mark present/absent, add a leave, etc.) and a
            // refetch right after a mutation must show the new value, not a
            // stale cached one (StaleWhileRevalidate would return the old
            // snapshot immediately and only update the cache for *next*
            // time, which looked like "nothing happened until I refresh").
            // The cache is only a fallback for when the network genuinely
            // fails — i.e. actually offline — which is what this is for.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-get-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Writes made while offline (a declared purchase, a marked
            // absence, a new leave request...) are queued and replayed
            // automatically as soon as connectivity returns.
            urlPattern: ({ url, request }) => request.method !== 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'POST',
            options: {
              backgroundSync: {
                name: 'api-mutations-queue-post',
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
          {
            urlPattern: ({ url, request }) => request.method !== 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'PUT',
            options: {
              backgroundSync: {
                name: 'api-mutations-queue-put',
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
          {
            urlPattern: ({ url, request }) => request.method !== 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'PATCH',
            options: {
              backgroundSync: {
                name: 'api-mutations-queue-patch',
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
          {
            urlPattern: ({ url, request }) => request.method !== 'GET' && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
            method: 'DELETE',
            options: {
              backgroundSync: {
                name: 'api-mutations-queue-delete',
                options: { maxRetentionTime: 24 * 60 },
              },
            },
          },
        ],
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
