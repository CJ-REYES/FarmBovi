import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = {
    '/api': { target: env.API_PROXY_TARGET || 'http://localhost:5080', changeOrigin: true },
  }

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icons/*.png'],
        manifest: {
          id: '/',
          name: 'FarmBovi · Gestión ganadera',
          short_name: 'FarmBovi',
          description: 'Registro y consulta de tu ganado, también en el campo.',
          lang: 'es-MX',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          theme_color: '#245c45',
          background_color: '#f3f6f7',
          icons: [
            { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
          cleanupOutdatedCaches: true,
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/health(?:\/|$)/, /^\/swagger(?:\/|$)/],
          // API data is saved explicitly by the app; the worker caches only assets.
          runtimeCaching: [],
        },
        // Inspect the real PWA with build + preview, without development caches.
        devOptions: { enabled: false },
      }),
    ],
    server: { host: 'localhost', port: 5173, strictPort: true, proxy },
    preview: { host: 'localhost', port: 4173, strictPort: true, proxy },
  }
})
