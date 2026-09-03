import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
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
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        // Never serve a cached/stale response for the API's auth check —
        // otherwise a stale "logged in" state could survive a token
        // revocation while offline.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Reference data + lists: show the last-known answer instantly,
            // then quietly refresh from the network for next time.
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              url.pathname.startsWith('/api/') &&
              !url.pathname.startsWith('/api/dashboard'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-get-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // The dashboard is the "what's the current state of everything"
            // view — prefer a fresh network answer, but fall back to the
            // last cached one within a few seconds if offline/slow.
            urlPattern: ({ url, request }) => request.method === 'GET' && url.pathname.startsWith('/api/dashboard'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-dashboard-cache',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 14 },
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
