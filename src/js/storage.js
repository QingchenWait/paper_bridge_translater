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
  'folders',
  'deletions',
];
let pending;
export function database() {
  return (pending ??= openDB('paper-bridge', 2, {
    upgrade(db) {
      for (const store of STORES)
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
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
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    if (await tx.objectStore('deletions').get(`${store}-${row.id}`))
      throw new Error('该记录已删除，已停止写入');
    if (
      ['annotations', 'translations'].includes(store) &&
      !(await tx.objectStore('documents').get(row.documentId))
    )
      throw new Error('文档已删除，未写入新内容');
    if (store === 'messages' && !(await tx.objectStore('conversations').get(row.conversationId)))
      throw new Error('对话已删除，未写入新消息');
    if (
      store === 'conversations' &&
      !(await tx.objectStore('documents').getAll()).some((d) => d.rootId === row.rootId)
    )
      throw new Error('文档组已删除，未创建对话');
    await tx.objectStore(store).put(row);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
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
export async function addDocument(blob, name, pages, rootId = null, folderId = null, sourceId = null) {
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
    folderId,
  };
  const tx = (await database()).transaction(['documents', 'files', 'folders'], 'readwrite');
  if (sourceId) {
    const source = await tx.objectStore('documents').get(sourceId);
    if (!source) {
      tx.abort();
      await tx.done.catch(() => {});
      throw new Error('来源文档已删除，未创建译文 PDF');
    }
    const original = await tx.objectStore('documents').get(source.rootId);
    row.rootId = source.rootId;
    row.folderId = (original || source).folderId || null;
  }
  if (row.folderId && !(await tx.objectStore('folders').get(row.folderId))) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('目标文件夹不存在，未导入文件');
  }
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
export async function mergeSnapshot(incoming, { restoreSettings = false, restoreDeleted = false } = {}) {
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    for (const deletion of incoming.deletions || []) {
      const old = await tx.objectStore('deletions').get(deletion.id);
      if (!old || deletion.updatedAt > old.updatedAt) await tx.objectStore('deletions').put(deletion);
    }
    if (restoreDeleted)
      for (const store of STORES.filter((name) => !['deletions', 'settings'].includes(name)))
        for (const row of incoming[store] || []) {
          const id = `${store}-${row.id}`,
            tomb = await tx.objectStore('deletions').get(id);
          if (tomb) {
            await tx.objectStore('deletions').delete(id);
            row.updatedAt = Math.max(Date.now(), tomb.updatedAt + 1);
          }
        }
    for (const store of STORES) {
      if (store === 'deletions') continue;
      for (const row of incoming[store] || []) {
        if (await tx.objectStore('deletions').get(`${store}-${row.id}`)) continue;
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
    await applyExactDeletions(tx);
    await tx.done;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
export async function contextDocument(rootId, preferredId = rootId) {
  const docs = await all('documents');
  return (
    docs.find((d) => d.id === rootId) ||
    docs.find((d) => d.id === preferredId && d.rootId === rootId) ||
    docs.find((d) => d.rootId === rootId) ||
    null
  );
}
async function applyExactDeletions(tx) {
  const tombstones = await tx.objectStore('deletions').getAll();
  const annotations = await tx.objectStore('annotations').getAll(),
    conversations = await tx.objectStore('conversations').getAll(),
    messages = await tx.objectStore('messages').getAll(),
    translations = await tx.objectStore('translations').getAll();
  const folderState = new Map(
    (await tx.objectStore('folders').getAll()).map((folder) => [folder.id, folder]),
  );
  for (const tomb of tombstones.filter((t) => t.store === 'documents')) {
    const row = await tx.objectStore('documents').get(tomb.key);
    if (!row) continue;
    const threads = new Set(conversations.filter((c) => c.rootId === row.rootId).map((c) => c.id));
    let folder = folderState.get(row.folderId),
      folderChanged = false;
    const visited = new Set();
    while (folder && !visited.has(folder.id)) {
      visited.add(folder.id);
      if (folder.updatedAt > tomb.updatedAt) folderChanged = true;
      folder = folderState.get(folder.parentId);
    }
    const newer =
      folderChanged ||
      conversations.some((c) => c.rootId === row.rootId && c.updatedAt > tomb.updatedAt) ||
      annotations.some((a) => a.documentId === row.id && a.updatedAt > tomb.updatedAt) ||
      messages.some((m) => threads.has(m.conversationId) && m.updatedAt > tomb.updatedAt) ||
      translations.some((t) => t.rootId === row.rootId && t.updatedAt > tomb.updatedAt);
    if (row.updatedAt <= tomb.updatedAt && !newer) await tx.objectStore('documents').delete(tomb.key);
  }
  const documents = await tx.objectStore('documents').getAll(),
    liveIds = new Set(documents.map((d) => d.id)),
    roots = new Set(documents.map((d) => d.rootId));
  for (const store of ['files', 'annotations', 'translations', 'conversations', 'messages'])
    for (const tomb of tombstones.filter((t) => t.store === store)) {
      const row = await tx.objectStore(store).get(tomb.key);
      if (!row) continue;
      if (store === 'files' && tomb.key === tomb.documentId && !liveIds.has(tomb.documentId))
        await tx.objectStore(store).delete(tomb.key);
      if (store === 'annotations' && row.documentId === tomb.documentId && !liveIds.has(tomb.documentId))
        await tx.objectStore(store).delete(tomb.key);
      if (
        ['translations', 'conversations'].includes(store) &&
        row.rootId === tomb.rootId &&
        !roots.has(tomb.rootId)
      )
        await tx.objectStore(store).delete(tomb.key);
      if (
        store === 'messages' &&
        row.conversationId === tomb.conversationId &&
        !(await tx.objectStore('conversations').get(row.conversationId))
      )
        await tx.objectStore(store).delete(tomb.key);
    }
  let folders = await tx.objectStore('folders').getAll();
  let changed = true;
  while (changed) {
    changed = false;
    for (const tomb of tombstones.filter((t) => t.store === 'folders')) {
      const row = folders.find((f) => f.id === tomb.key);
      if (
        row &&
        row.updatedAt <= tomb.updatedAt &&
        !folders.some((f) => f.parentId === row.id) &&
        !documents.some((d) => d.folderId === row.id)
      ) {
        await tx.objectStore('folders').delete(row.id);
        folders = folders.filter((f) => f.id !== row.id);
        changed = true;
      }
    }
  }
  const folderIds = new Set(folders.map((f) => f.id));
  for (const row of folders)
    if (row.parentId && !folderIds.has(row.parentId))
      await tx.objectStore('folders').put({ ...row, parentId: null });
  const tree = new Map((await tx.objectStore('folders').getAll()).map((folder) => [folder.id, folder]));
  for (const folder of tree.values()) {
    const seen = new Set();
    let current = folder;
    while (current?.parentId) {
      seen.add(current.id);
      if (seen.has(current.parentId)) {
        const detached = { ...current, parentId: null, updatedAt: Date.now() };
        tree.set(detached.id, detached);
        await tx.objectStore('folders').put(detached);
        break;
      }
      current = tree.get(current.parentId);
    }
  }
  for (const row of documents)
    if (row.folderId && !folderIds.has(row.folderId))
      await tx.objectStore('documents').put({ ...row, folderId: null });
  for (const row of await tx.objectStore('translations').getAll()) {
    const source = documents.find((d) => d.rootId === row.rootId);
    if (!source) continue;
    if (!liveIds.has(row.documentId) || (row.generatedDocumentId && !liveIds.has(row.generatedDocumentId)))
      await tx.objectStore('translations').put({
        ...row,
        documentId: liveIds.has(row.documentId) ? row.documentId : source.id,
        generatedDocumentId: liveIds.has(row.generatedDocumentId) ? row.generatedDocumentId : null,
      });
  }
  // A newer edit or surviving member can intentionally retain a record. Retire
  // that rejected deletion marker so a later backup can restore the kept data.
  for (const tomb of tombstones)
    if (
      ['documents', 'files', 'annotations', 'translations', 'conversations', 'messages', 'folders'].includes(
        tomb.store,
      ) &&
      (await tx.objectStore(tomb.store).get(tomb.key))
    )
      await tx.objectStore('deletions').delete(tomb.id);
}
export async function requestPersistence() {
  return (await navigator.storage?.persist?.()) || false;
}
