import { installPdfRuntime } from './compat/pdf-runtime.js';
let pending;
export function getPdfEngine() {
  installPdfRuntime();
  // The same upstream compatibility build supplies missing ECMAScript methods
  // in BOTH realms; no UA whitelist or catch-and-retry after rendering fails.
  return (pending ||= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('./compat/pdf.worker.js?worker&url'),
  ])
    .then(([engine, worker]) => {
      engine.GlobalWorkerOptions.workerSrc = worker.default;
      return engine;
    })
    .catch((error) => {
      pending = null;
      throw error;
    }));
}
