import { apple, loadApplePdfEngine } from './compat/apple-webkit.js';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
let pending;
export function getPdfEngine() {
  // Keep PDF.js out of application startup. Only the selected engine is evaluated.
  return (pending ||= (
    apple.webkit
      ? loadApplePdfEngine()
      : import('pdfjs-dist').then((engine) => {
          engine.GlobalWorkerOptions.workerSrc = workerUrl;
          return engine;
        })
  ).catch((error) => {
    pending = null;
    throw error;
  }));
}
