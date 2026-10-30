import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (command === 'build' && !env.VITE_SITE_URL) {
    console.warn('VITE_SITE_URL is not set: link previews will have no image. See .env.example.')
  }
  // index.html uses %VITE_SITE_URL% for Open Graph URLs; unset, Vite would leave the placeholder in the page
  process.env.VITE_SITE_URL = env.VITE_SITE_URL ?? ''

  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
  }
})
