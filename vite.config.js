import { defineConfig } from 'vite';
import { offlineServiceWorker } from './tools/offline-service-worker.mjs';
export default defineConfig({
  base: './',
  plugins: [offlineServiceWorker()],
  worker: { format: 'es' },
  optimizeDeps: {
    entries: ['index.html'],
    // PDF.js is intentionally loaded only when a document opens. Excluding it
    // and Worker-only hash modules prevents Vite from restarting the page when
    // a first PDF/model Worker is found.
    exclude: ['pdfjs-dist', '@noble/hashes/sha2.js', '@noble/hashes/legacy.js'],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: {
    host: '127.0.0.1',
    warmup: { clientFiles: ['./src/js/main.js', './src/js/ui/assistant.js', './src/js/pdf.js'] },
  },
});
