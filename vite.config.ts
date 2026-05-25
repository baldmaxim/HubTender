import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode.startsWith('production')
  const env = loadEnv(mode, process.cwd(), '')
  // process.env побеждает .env-файлы: scripts/build-prod.mjs пробрасывает свежий
  // VITE_SENTRY_RELEASE из git SHA, и он должен перебить значение из .env.production.yandex.
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN
  const sentryRelease = process.env.VITE_SENTRY_RELEASE || env.VITE_SENTRY_RELEASE
  // Source-map upload ON только когда явно проставлены и токен, и release-имя.
  // Локальный `npm run build` (mode=production, .env без VITE_SENTRY_RELEASE)
  // не льёт ничего; `npm run build:prod` (mode=production.yandex, .env.production.yandex с VITE_SENTRY_RELEASE) — льёт.
  const enableSentryUpload = isProd && Boolean(sentryAuthToken) && Boolean(sentryRelease)

  return {
    plugins: [
      react(),
      ...(enableSentryUpload
        ? [
            sentryVitePlugin({
              org: 'odintsovorg',
              project: 'hubtender-web',
              authToken: sentryAuthToken,
              release: sentryRelease ? { name: sentryRelease } : undefined,
            }),
          ]
        : []),
    ],
    server: {
      port: 5185,
      open: true
    },
    esbuild: isProd
      ? { drop: ['debugger'], pure: ['console.log', 'console.debug', 'console.info'] }
      : undefined,
    build: {
      outDir: 'dist',
      sourcemap: isProd ? 'hidden' : true,
      target: 'es2020',
      cssCodeSplit: true,
      chunkSizeWarningLimit: 800,
      rollupOptions: {
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
