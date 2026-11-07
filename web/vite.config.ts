import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Keep the presentation source at repository root while including it in the web build.
  publicDir: '../public',
  plugins: [react()],
  server: { proxy: { '/api/simulation': 'http://127.0.0.1:8000' } },
})
