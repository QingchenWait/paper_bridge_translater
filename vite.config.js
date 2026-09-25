import { defineConfig } from 'vite';
import { offlineServiceWorker } from './tools/offline-service-worker.mjs';
export default defineConfig({
  base: './',
  plugins: [offlineServiceWorker()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { host: '127.0.0.1' },
});
