import { rm } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Keep model weights out of the build output.
 *
 * `public/models` is where the models live for local development, so the dev
 * server can serve them same-origin. Vite copies all of `public/` into `dist/`,
 * which would put ~400 MB of weights into the container image — the exact cost
 * that serving them from a CDN exists to avoid. In production they are fetched
 * from VITE_SHERPA_*_BASE, so the copy is pure waste.
 */
function excludeModelsFromBuild(): Plugin {
  return {
    name: 'aac:exclude-models',
    apply: 'build',
    async closeBundle() {
      await rm(fileURLToPath(new URL('./dist/models', import.meta.url)), {
        recursive: true,
        force: true,
      });
    },
  };
}

/**
 * Cross-Origin Isolation.
 *
 * `require-corp` is the value mandated by the specification and is the default.
 * Teams that serve Sherpa model weights from a third-party CDN can set
 * COEP_MODE=credentialless, which still yields `crossOriginIsolated === true`
 * (and therefore SharedArrayBuffer) while allowing no-cors cross-origin loads.
 */
const COEP_MODE = process.env.COEP_MODE ?? 'require-corp';

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': COEP_MODE,
  'Cross-Origin-Resource-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [
    react(),
    excludeModelsFromBuild(),
    VitePWA({
      // 'prompt' keeps vite-plugin-pwa from reloading the page under the user.
      // The actual update behaviour comes from skipWaiting + clientsClaim
      // below: the new worker takes over at once, and the running page keeps
      // the bundle it already loaded until the next navigation.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        name: 'Context-Aware Augmentative & Alternative Communication',
        short_name: 'AAC',
        description:
          'Offline-first augmentative and alternative communication with edge speech recognition and synthesis.',
        theme_color: '#0b1120',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The application shell must boot with the network severed.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
        // Model weights are runtime-cached, never precached: they are far too
        // large for an install-time waterfall and are versioned independently.
        globIgnores: ['**/models/**', '**/*.onnx', '**/*.data'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        /**
         * No precache-driven navigation.
         *
         * Serving the shell from the precache means a browser keeps running the
         * previous build until a *second* visit after each deploy. That trap
         * cost hours in this project: fixes looked broken because the page was
         * still executing the bundle from the deploy before, and the same thing
         * happened to the person testing it. Navigations go to the network
         * first instead (see runtimeCaching), so an online device always runs
         * the current build and an offline one still boots from cache.
         */
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        /**
         * Without this a new service worker waits for every tab to close before
         * activating, and the old precache keeps serving the old application
         * shell — indefinitely, on a device people leave open. A deployed fix
         * would simply never arrive. That is unacceptable here, and it is not
         * hypothetical: it is exactly what happened, and it made a fixed build
         * look broken because the browser was still running the previous one.
         *
         * Paired with `registerType: 'prompt'` so the page is never reloaded
         * mid-sentence: the new worker activates immediately and the next
         * navigation picks up the new shell.
         */
        skipWaiting: true,
        runtimeCaching: [
          {
            // The application shell. Network first, so a deploy is live on the
            // next load rather than the one after it; the cached copy is what
            // makes an offline boot work, which is the actual requirement.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'aac-shell-v1',
              // Long enough for a slow connection, short enough that a dead one
              // does not leave someone staring at a blank page.
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 8 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Sherpa WASM binaries + ONNX weights: immutable, cache-first,
            // range-request capable so partial model reads resolve offline.
            urlPattern: ({ url }) =>
              url.pathname.includes('/models/') ||
              url.pathname.startsWith('/ort/') ||
              /\.(onnx|data|wasm|bin|fst|ort)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'aac-edge-models-v1',
              expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/workers/') || url.pathname.startsWith('/worklets/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'aac-audio-threads-v1' },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],

  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },

  server: {
    headers: ISOLATION_HEADERS,
    port: 5173,
    strictPort: false,
    // The dev server has no call backend of its own (signalling and TURN
    // credentials live in server.js), so /api is proxied to the deployed app
    // by default. Point VITE_DEV_API_PROXY at http://localhost:8080 to test
    // against a local `npm start` instead.
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API_PROXY ?? 'https://webmcpaac--vpx4900.us-east4.hosted.app',
        changeOrigin: true,
      },
    },
  },
  preview: { headers: ISOLATION_HEADERS, port: 4173 },

  worker: { format: 'es' },

  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },

  define: {
    __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME ?? 'development'),
  },
});
