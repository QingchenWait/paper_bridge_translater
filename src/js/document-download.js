import { database } from './storage.js';
import { flushAnnotations } from './annotation-writes.js';

// Export a consistent snapshot without flattening or changing the editable source.
export async function editedDocumentBlob(documentId) {
  await flushAnnotations();
  const tx = (await database()).transaction(['documents', 'files', 'annotations'], 'readonly');
  const [doc, file, rows] = await Promise.all([
    tx.objectStore('documents').get(documentId),
    tx.objectStore('files').get(documentId),
    tx.objectStore('annotations').getAll(),
  ]);
  await tx.done;
  if (!doc || !file) throw new Error('所选 PDF 已不存在，未下载');
  const annotations = rows.filter((a) => a.documentId === documentId && !a.deleted);
  if (!annotations.length) return file.blob;
  const [{ loadPdf }, { exportAnnotatedPdf }] = await Promise.all([
    import('./pdf.js'),
    import('./pdf-export.js'),
  ]);
  const source = await loadPdf(file.blob);
  try {
    return await exportAnnotatedPdf(file.blob, annotations, source);
  } finally {
    await source.destroy();
  }
}
