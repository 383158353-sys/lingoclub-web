import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { localApiPlugin } from './server/localApiPlugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devHost = String(env.LINGOCLUB_DEV_HOST || '').trim()
  const productionAiApiTarget = mode === 'development' ? 'https://lingoclub.vercel.app' : ''
  return {
  plugins: [
    localApiPlugin(env, { productionAiApiTarget }),
    react(),
  ],
  resolve: { alias: { '@': '/src' } },
  build: {
    rollupOptions: {
      output: {
        // Split stable vendors out of the app chunk: parallel downloads on first visit and
        // long-lived cache across deploys (only the small app chunk changes).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor-react'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('@radix-ui') || id.includes('lucide-react')) return 'vendor-ui'
          if (id.includes('@tanstack')) return 'vendor-query'
          return undefined
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: devHost ? [devHost] : [],
    hmr: devHost ? { protocol: 'wss', host: devHost, clientPort: 443 } : undefined,
  },
  }
});
