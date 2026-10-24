import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '')

  return {
    plugins: [react()],
    server: {
      // Web-session calls are same-origin (#292). In production a Vercel rewrite
      // forwards them; in dev this proxy does. The browser Origin is passed through.
      proxy: {
        '/api/auth/web-session': {
          target: env.VITE_API_BASE_URL || 'http://localhost:5298',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
      clearMocks: true,
      pool: 'forks',
      maxWorkers: 1,
      fileParallelism: false,
    },
  }
})
