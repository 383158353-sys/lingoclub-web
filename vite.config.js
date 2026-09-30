import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { localApiPlugin } from './server/localApiPlugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
  plugins: [
    localApiPlugin(env),
    react(),
  ],
  resolve: { alias: { '@': '/src' } },
  }
});
