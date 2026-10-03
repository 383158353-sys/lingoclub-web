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
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: devHost ? [devHost] : [],
    hmr: devHost ? { protocol: 'wss', host: devHost, clientPort: 443 } : undefined,
  },
  }
});
