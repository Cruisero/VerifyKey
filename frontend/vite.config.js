import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://backend:3002',
        changeOrigin: true,
        bypass(req) {
          if (req.url && (req.url === '/api-docs' || req.url.startsWith('/api-docs/'))) {
            return '/index.html';
          }
        },
      },
    },
  },
})
