import { installPdfRuntime } from './pdf-runtime.js';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
installPdfRuntime();
export { WorkerMessageHandler };
