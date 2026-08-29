import { rm } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { sites } from '@openai/sites-vite-plugin';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import vinext from 'vinext';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = '00000000-0000-4000-8000-000000000000';
const { d1, r2 } = hostingConfig;

/** Keep the locally cached neural model weights out of deploy artifacts. */
function excludeModelsFromBuild(): Plugin {
  return {
    name: 'aac:exclude-model-weights',
    apply: 'build',
    async closeBundle() {
      const paths = ['./dist/models', './dist/client/models'];
      await Promise.all(
        paths.map((path) =>
          rm(fileURLToPath(new URL(path, import.meta.url)), { recursive: true, force: true }),
        ),
      );
    },
  };
}

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2 ? [{ binding: r2, bucket_name: 'site-creator-r2' }] : [],
};

process.env.WRANGLER_WRITE_LOGS ??= 'false';
process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

const { cloudflare } = await import('@cloudflare/vite-plugin');

export default defineConfig({
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
      excludeModelsFromBuild(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        outDir: 'dist/client',
        manifest: {
          name: 'SpeakAhead',
          short_name: 'SpeakAhead',
          description: 'Context-aware communication with on-device speech recognition and synthesis.',
          theme_color: '#0b1120',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '.',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
          globIgnores: ['**/models/**', '**/*.onnx', '**/*.data'],
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
          navigateFallback: null,
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'aac-shell-v2',
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 8 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              urlPattern: ({ url }) =>
                url.pathname.includes('/models/') ||
                url.pathname.startsWith('/ort/') ||
                /\.(onnx|data|wasm|bin|fst|ort)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'aac-edge-models-v2',
                expiration: { maxEntries: 128, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
                rangeRequests: true,
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      headers: ISOLATION_HEADERS,
      proxy: {
        '/api': {
          target: process.env.VITE_DEV_API_PROXY ?? 'https://webmcpaac--vpx4900.us-east4.hosted.app',
          changeOrigin: true,
        },
      },
    },
    worker: { format: 'es' },
    build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200 },
    define: { __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME ?? 'development') },
});
