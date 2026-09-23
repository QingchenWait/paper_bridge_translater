import { installAppleRuntime } from './apple-streams.js';
import { WorkerMessageHandler } from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
installAppleRuntime();
export { WorkerMessageHandler };
