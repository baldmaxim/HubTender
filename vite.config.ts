import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(async ({ mode }) => {
  const isProd = mode.startsWith('production')
  const env = loadEnv(mode, process.cwd(), '')
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN
  const sentryRelease = process.env.VITE_SENTRY_RELEASE || env.VITE_SENTRY_RELEASE
  const noSourcemap = process.env.BUILD_NO_SOURCEMAP === '1'
  const enableSentryUpload =
    isProd && !noSourcemap && Boolean(sentryAuthToken) && Boolean(sentryRelease)

  const plugins: PluginOption[] = [react()]

  try {
    const { VitePWA } = await import('vite-plugin-pwa')
    plugins.push(
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.svg'],
        manifest: {
          name: 'TenderHUB - Портал управления тендерами',
          short_name: 'TenderHUB',
          description:
            'Система управления строительными тендерами, сметами и номенклатурами СУ-10.',
          lang: 'ru',
          theme_color: '#10b981',
          background_color: '#0a0a0a',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
            { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
              handler: 'NetworkOnly',
            },
          ],
          cleanupOutdatedCaches: true,
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        },
        devOptions: { enabled: false },
      }),
    )
  } catch {
    console.warn('[vite] vite-plugin-pwa is not installed; PWA support is disabled.')
  }

  if (enableSentryUpload) {
    try {
      const { sentryVitePlugin } = await import('@sentry/vite-plugin')
      plugins.push(
        sentryVitePlugin({
          org: 'odintsovorg',
          project: 'hubtender-web',
          authToken: sentryAuthToken,
          release: sentryRelease ? { name: sentryRelease } : undefined,
        }),
      )
    } catch {
      console.warn('[vite] @sentry/vite-plugin is not installed; skipping sourcemap upload.')
    }
  }

  return {
    plugins,
    server: {
      port: 5185,
      open: true,
    },
    esbuild: isProd
      ? { drop: ['debugger'], pure: ['console.log', 'console.debug', 'console.info'] }
      : undefined,
    build: {
      outDir: 'dist',
      sourcemap: noSourcemap ? false : isProd ? 'hidden' : true,
      target: 'es2020',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        maxParallelFileOps: 4,
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-antd': ['antd', '@ant-design/icons', '@ant-design/charts'],
            'vendor-charts': ['chart.js', 'react-chartjs-2', 'chartjs-plugin-datalabels'],
            'vendor-xlsx': ['xlsx', 'xlsx-js-style'],
          },
        },
      },
    },
  }
})
