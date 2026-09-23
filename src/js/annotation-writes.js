import { database } from './storage.js';

let pending = Promise.resolve();
export function writeAnnotations(rows) {
  const snapshot = structuredClone(rows.map((row) => ({ ...row, updatedAt: Date.now() })));
  const write = pending
    .catch(() => {})
    .then(async () => {
      const tx = (await database()).transaction(['annotations', 'documents', 'deletions'], 'readwrite');
      try {
        for (const row of snapshot) {
          if (
            !(await tx.objectStore('documents').get(row.documentId)) ||
            (await tx.objectStore('deletions').get(`annotations-${row.id}`))
          )
            throw new Error('文档或批注已删除，已停止写入');
          await tx.objectStore('annotations').put(row);
        }
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
      }
    });
  pending = write;
  return write;
}
export function flushAnnotations() {
  return pending;
}
