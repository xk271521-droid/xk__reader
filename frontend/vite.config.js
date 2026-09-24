import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // EmbedPDF loads its worker entry dynamically; pre-bundling the engine
    // breaks that URL in both the web build and Electron's local server.
    exclude: ['@embedpdf/engines'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('pdfjs-dist')) return 'vendor-pdf'
          if (id.includes('@embedpdf')) return 'vendor-embedpdf'
          if (id.includes('html2canvas')) return 'vendor-html2canvas'
          if (id.includes('jspdf')) return 'vendor-jspdf'
          if (id.includes('zrender')) return 'vendor-zrender'
          if (id.includes('echarts')) return 'vendor-echarts'
          if (id.includes('recharts')) return 'vendor-recharts'
          if (
            id.includes('@radix-ui') ||
            id.includes('radix-ui') ||
            id.includes('vaul') ||
            id.includes('lucide-react')
          ) {
            return 'vendor-ui'
          }
          if (
            id.includes('react') ||
            id.includes('scheduler') ||
            id.includes('next-themes')
          ) {
            return 'vendor-react'
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Keep one predictable web entrypoint. strictPort prevents Vite from
    // silently creating a second frontend on 5174/5175 when 5173 is busy.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['30c07cd5.r40.cpolar.top'],
    proxy: {
      '/api': apiProxyTarget,
      '/uploads': apiProxyTarget,
    },
  },
})
