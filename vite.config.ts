import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production'

  return {
    plugins: [react()],
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
            'vendor-supabase': ['@supabase/supabase-js'],
          },
        },
      },
    },
  }
})
