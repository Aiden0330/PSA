import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 便于 FastAPI 静态托管 dist;dev 时把 /api 代理到后端
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
})
