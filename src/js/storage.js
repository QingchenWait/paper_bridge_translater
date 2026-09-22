import { openDB } from 'idb';
import { uid } from './utils.js';
export const STORES = [
  'documents',
  'files',
  'annotations',
  'conversations',
  'messages',
  'translations',
  'settings',
];
let pending;
export function database() {
  return (pending ??= openDB('paper-bridge', 1, {
    upgrade(db) {
      for (const store of STORES) db.createObjectStore(store, { keyPath: 'id' });
    },
    blocked() {
      globalThis.dispatchEvent?.(new Event('storage-blocked'));
    },
  }));
}
export async function all(store) {
  return (await database()).getAll(store);
}
export async function get(store, id) {
  return (await database()).get(store, id);
}
export async function put(store, value) {
  const row = structuredClone({ ...value, updatedAt: Date.now() });
  await (await database()).put(store, row);
  return row;
}
export async function patch(store, id, values) {
  const db = await database();
  const tx = db.transaction(store, 'readwrite');
  const previous = await tx.store.get(id);
  if (!previous) throw new Error('记录不存在，请重新打开文档');
  const row = { ...previous, ...structuredClone(values), updatedAt: Date.now() };
  await tx.store.put(row);
  await tx.done;
  return row;
}
export async function addDocument(blob, name, pages, rootId = null) {
  const id = uid();
  const now = Date.now();
  const row = {
    id,
    rootId: rootId || id,
    name,
    pages,
    size: blob.size,
    createdAt: now,
    updatedAt: now,
    page: 1,
    zoom: 'fit',
    archived: false,
  };
  const tx = (await database()).transaction(['documents', 'files'], 'readwrite');
  await tx.objectStore('documents').put(row);
  await tx.objectStore('files').put({ id, blob, updatedAt: now });
  await tx.done;
  return row;
}
export async function snapshot() {
  const tx = (await database()).transaction(STORES, 'readonly');
  const result = {};
  await Promise.all(
    STORES.map(async (store) => {
      result[store] = await tx.objectStore(store).getAll();
    }),
  );
  await tx.done;
  return result;
}
// One transaction: malformed archives and quota failures can never partially replace the library.
export async function mergeSnapshot(incoming, { restoreSettings = false } = {}) {
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    for (const store of STORES) {
      for (const row of incoming[store] || []) {
        if (store === 'settings' && !restoreSettings) continue;
        const old = await tx.objectStore(store).get(row.id);
        if (!old) {
          await tx.objectStore(store).put(row);
          continue;
        }
        if (store === 'settings' && restoreSettings) {
          if (row.id === 'app') {
            const providers = new Map((old.value?.chatProviders || []).map((p) => [p.id, p]));
            for (const provider of row.value?.chatProviders || [])
              providers.set(provider.id, {
                ...providers.get(provider.id),
                ...provider,
                apiKey: provider.apiKey || providers.get(provider.id)?.apiKey || '',
              });
            await tx.objectStore(store).put({
              ...old,
              value: {
                ...old.value,
                ...row.value,
                chatProviders: [...providers.values()],
                webdav: {
                  ...old.value?.webdav,
                  ...row.value?.webdav,
                  password: row.value?.webdav?.password || old.value?.webdav?.password || '',
                },
              },
              updatedAt: Date.now(),
            });
          } else await tx.objectStore(store).put(row);
          continue;
        }
        if (store === 'files') continue; // Original PDF bytes are immutable.
        if (
          ['messages', 'annotations', 'translations'].includes(store) &&
          JSON.stringify({ ...old, updatedAt: 0 }) !== JSON.stringify({ ...row, updatedAt: 0 })
        ) {
          // Keep divergent edits, including interrupted streaming replies, as a visible recovery copy.
          const newer = Number(row.updatedAt) > Number(old.updatedAt) ? row : old;
          const older = newer === row ? old : row;
          const copyId = `${row.id}-recovery-${older.updatedAt}`;
          if (!(await tx.objectStore(store).get(copyId))) {
            await tx.objectStore(store).put({ ...older, id: copyId, recovered: true });
          }
          await tx.objectStore(store).put(newer);
        } else if (Number(row.updatedAt) > Number(old.updatedAt)) await tx.objectStore(store).put(row);
      }
    }
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
export async function requestPersistence() {
  return (await navigator.storage?.persist?.()) || false;
}
