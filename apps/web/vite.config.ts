import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost', changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, '/api') },
      '/ws':  { target: 'ws://localhost',  ws: true,            rewrite: (p) => p.replace(/^\/ws/, '/ws') },
      '/ingest': { target: 'http://localhost', changeOrigin: true, rewrite: (p) => p.replace(/^\/ingest/, '/ingest') },
    },
  },
  build: { outDir: 'dist' },
});
