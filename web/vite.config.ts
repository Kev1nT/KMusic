import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  root: path.resolve('web'),
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve('web/src') },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: { '/api': 'http://127.0.0.1:8080' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
