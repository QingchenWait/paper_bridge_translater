import { installPdfRuntime } from './pdf-runtime.js';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
// pdf-runtime has a module-level install, so its dependency is evaluated first
// in the Worker realm; call again for bundler changes and clarity.
installPdfRuntime();
export { WorkerMessageHandler };
