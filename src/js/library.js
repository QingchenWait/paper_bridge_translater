import { zip } from 'fflate';
import { all, database, STORES } from './storage.js';
import { uid } from './utils.js';

export const objectKey = (kind, id) => `${kind}:${id}`;
export async function readLibrary() {
  const tx = (await database()).transaction(['documents', 'folders'], 'readonly');
  const [documents, folders] = await Promise.all([
    tx.objectStore('documents').getAll(),
    tx.objectStore('folders').getAll(),
  ]);
  await tx.done;
  return { documents, folders };
}
export function validateFolderTree(folders) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  for (const folder of folders) {
    let current = folder;
    const seen = new Set();
    while (current) {
      if (seen.has(current.id)) throw new Error('文件夹层级存在循环，操作已取消');
      seen.add(current.id);
      if (current.parentId && !byId.has(current.parentId)) throw new Error('文件夹上级不存在，操作已取消');
      current = byId.get(current.parentId);
    }
  }
}
export function expandSelection(state, keys) {
  validateFolderTree(state.folders);
  const chosen = new Set(keys),
    folderIds = new Set(),
    documentIds = new Set();
  for (const folder of state.folders)
    if (chosen.has(objectKey('folder', folder.id))) folderIds.add(folder.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of state.folders)
      if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) {
        folderIds.add(folder.id);
        changed = true;
      }
  }
  for (const doc of state.documents)
    if (chosen.has(objectKey('document', doc.id)) || folderIds.has(doc.folderId)) documentIds.add(doc.id);
  return { folderIds, documentIds };
}
export function sortLibraryObjects(objects, sort = 'createdAt', direction = 'desc') {
  const compare = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' }).compare,
    multiplier = direction === 'asc' ? 1 : -1;
  return [...objects].sort((a, b) =>
    a.kind !== b.kind
      ? a.kind === 'folder'
        ? -1
        : 1
      : multiplier * (sort === 'name' ? compare(a.name, b.name) : a.createdAt - b.createdAt) ||
        compare(a.name, b.name) ||
        a.id.localeCompare(b.id),
  );
}
export async function createFolder(name, parentId = null) {
  name = String(name || '').trim();
  if (!name || /^[. ]+$/.test(name) || /[\\/\u0000]/.test(name)) throw new Error('请输入有效的文件夹名称');
  const tx = (await database()).transaction('folders', 'readwrite');
  try {
    const folders = await tx.store.getAll();
    validateFolderTree(folders);
    if (parentId && !folders.some((f) => f.id === parentId)) throw new Error('上级文件夹已不存在');
    if (folders.some((f) => (f.parentId || null) === parentId && f.name === name))
      throw new Error('此目录下已有同名文件夹');
    const now = Date.now(),
      row = { id: uid(), name, parentId, createdAt: now, updatedAt: now };
    await tx.store.put(row);
    await tx.done;
    return row;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
export async function moveSelection(keys, destination = null) {
  const tx = (await database()).transaction(['folders', 'documents'], 'readwrite');
  try {
    const state = {
      folders: await tx.objectStore('folders').getAll(),
      documents: await tx.objectStore('documents').getAll(),
    };
    const selection = expandSelection(state, keys);
    if (destination && !state.folders.some((f) => f.id === destination)) throw new Error('目标文件夹不存在');
    if (selection.folderIds.has(destination)) throw new Error('不能把文件夹移动到自身或其子文件夹');
    const now = Date.now(),
      chosen = new Set(keys),
      moved = [];
    for (const folder of state.folders)
      if (chosen.has(objectKey('folder', folder.id)) && !selection.folderIds.has(folder.parentId))
        await tx.objectStore('folders').put({ ...folder, parentId: destination, updatedAt: now });
    const targetById = new Map();
    for (const doc of state.documents)
      if (chosen.has(objectKey('document', doc.id)) && !selection.folderIds.has(doc.folderId))
        targetById.set(doc.id, destination);
    for (const original of state.documents.filter(
      (d) => d.id === d.rootId && selection.documentIds.has(d.id),
    )) {
      const target = targetById.has(original.id) ? targetById.get(original.id) : original.folderId || null;
      for (const translated of state.documents.filter(
        (d) => d.rootId === original.id && d.id !== original.id,
      ))
        targetById.set(translated.id, target);
    }
    for (const doc of state.documents)
      if (targetById.has(doc.id)) {
        const row = { ...doc, folderId: targetById.get(doc.id), updatedAt: now };
        await tx.objectStore('documents').put(row);
        moved.push(row.id);
      }
    await tx.done;
    return moved;
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
export function planDeletion(state, keys) {
  const selected = expandSelection(state, keys);
  const path = (row) => {
    const names = [row.name],
      seen = new Set();
    let parent = row.folderId || row.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const folder = state.folders.find((f) => f.id === parent);
      if (!folder) break;
      names.unshift(folder.name);
      parent = folder.parentId;
    }
    return names.join(' / ');
  };
  return {
    keys: [...new Set(keys)],
    documentIds: [...selected.documentIds],
    folderIds: [...selected.folderIds],
    documents: state.documents
      .filter((d) => selected.documentIds.has(d.id))
      .map((row) => ({ ...row, displayPath: path(row) })),
    folders: state.folders
      .filter((f) => selected.folderIds.has(f.id))
      .map((row) => ({ ...row, displayPath: path(row) })),
  };
}
export async function deleteSelection(plan) {
  if (!plan?.documentIds?.length && !plan?.folderIds?.length)
    return { documentIds: [], folderIds: [], retainedFolders: [], deadRoots: [] };
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    const documents = await tx.objectStore('documents').getAll();
    let folders = await tx.objectStore('folders').getAll();
    // Intersect with the reviewed scope. Newly added children and items moved out
    // while confirmation was open are never swept into the deletion.
    const current = expandSelection({ documents, folders }, plan.keys || []);
    const ids = new Set((plan.documentIds || []).filter((id) => current.documentIds.has(id)));
    const folderIds = new Set((plan.folderIds || []).filter((id) => current.folderIds.has(id)));
    const removed = documents.filter((d) => ids.has(d.id)),
      remaining = documents.filter((d) => !ids.has(d.id));
    const affectedRoots = new Set(removed.map((d) => d.rootId).filter(Boolean)),
      deadRoots = new Set([...affectedRoots].filter((root) => !remaining.some((d) => d.rootId === root)));
    const now = Date.now(),
      erase = async (store, row, owner = {}) => {
        await tx.objectStore(store).delete(row.id);
        await tx
          .objectStore('deletions')
          .put({ id: `${store}-${row.id}`, store, key: row.id, updatedAt: now, ...owner });
      };
    for (const doc of removed) {
      await erase('documents', doc, { documentId: doc.id, rootId: doc.rootId });
      const file = await tx.objectStore('files').get(doc.id);
      if (file) await erase('files', file, { documentId: doc.id });
    }
    for (const row of await tx.objectStore('annotations').getAll())
      if (ids.has(row.documentId)) await erase('annotations', row, { documentId: row.documentId });
    const deletedConversations = new Set();
    for (const row of await tx.objectStore('conversations').getAll())
      if (deadRoots.has(row.rootId)) {
        deletedConversations.add(row.id);
        await erase('conversations', row, { rootId: row.rootId });
      }
    for (const row of await tx.objectStore('messages').getAll())
      if (deletedConversations.has(row.conversationId))
        await erase('messages', row, { conversationId: row.conversationId });
    for (const row of await tx.objectStore('translations').getAll()) {
      if (deadRoots.has(row.rootId)) {
        await erase('translations', row, { rootId: row.rootId });
        continue;
      }
      if (affectedRoots.has(row.rootId) && (ids.has(row.documentId) || ids.has(row.generatedDocumentId))) {
        const survivor = remaining.find((d) => d.rootId === row.rootId);
        if (survivor)
          await tx.objectStore('translations').put({
            ...row,
            documentId: ids.has(row.documentId) ? survivor.id : row.documentId,
            generatedDocumentId: ids.has(row.generatedDocumentId) ? null : row.generatedDocumentId,
            updatedAt: now,
          });
      }
    }
    const removedFolders = [];
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of [...folders])
        if (
          folderIds.has(folder.id) &&
          !remaining.some((d) => d.folderId === folder.id) &&
          !folders.some((f) => f.parentId === folder.id)
        ) {
          await erase('folders', folder);
          folders = folders.filter((f) => f.id !== folder.id);
          removedFolders.push(folder.id);
          changed = true;
        }
    }
    const workspace = await tx.objectStore('settings').get('workspace');
    if (workspace && ids.size) {
      const value = {
        ...workspace.value,
        openIds: (workspace.value.openIds || []).filter((id) => !ids.has(id)),
        currentThreads: (workspace.value.currentThreads || []).filter(([root]) => !deadRoots.has(root)),
      };
      if (ids.has(value.activeId)) value.activeId = value.openIds[0] || null;
      await tx.objectStore('settings').put({ ...workspace, value, updatedAt: now });
    }
    await tx.done;
    return {
      documentIds: [...ids],
      folderIds: removedFolders,
      retainedFolders: [...folderIds].filter((id) => !removedFolders.includes(id)),
      deadRoots: [...deadRoots],
    };
  } catch (error) {
    try {
      tx.abort();
    } catch {}
    await tx.done.catch(() => {});
    throw error;
  }
}
const safeName = (name) =>
  String(name)
    .replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '') || '未命名';
export function downloadPlan(state, keys) {
  const selected = expandSelection(state, keys);
  const documents = state.documents.filter((d) => selected.documentIds.has(d.id));
  const folders = state.folders.filter((f) => selected.folderIds.has(f.id));
  const byId = new Map(state.folders.map((f) => [f.id, f])),
    assigned = new Map(),
    used = new Set();
  const unique = (parent, name, isFolder) => {
    const clean = safeName(name),
      dot = !isFolder ? clean.lastIndexOf('.') : -1,
      stem = dot > 0 ? clean.slice(0, dot) : clean,
      ext = dot > 0 ? clean.slice(dot) : '';
    let candidate = `${parent}${clean}`,
      n = 2;
    while (used.has(candidate.toLocaleLowerCase())) candidate = `${parent}${stem} (${n++})${ext}`;
    used.add(candidate.toLocaleLowerCase());
    return candidate;
  };
  const folderPath = (id) => {
    if (assigned.has(id)) return assigned.get(id);
    const f = byId.get(id);
    if (!f || !selected.folderIds.has(id)) return '';
    const parent = selected.folderIds.has(f.parentId) ? folderPath(f.parentId) : '';
    const path = unique(parent, f.name, true) + '/';
    assigned.set(id, path);
    return path;
  };
  for (const f of folders) folderPath(f.id);
  const files = documents.map((doc) => ({
    id: doc.id,
    name: doc.name,
    path: unique(folderPath(doc.folderId), doc.name, false),
  }));
  return { files, folders: [...assigned.values()], zip: folders.length > 0 || files.length > 2 };
}
export async function buildLibraryZip(plan) {
  const { editedDocumentBlob } = await import('./document-download.js');
  const entries = Object.create(null);
  for (const path of plan.folders) entries[path] = new Uint8Array();
  for (const file of plan.files) {
    const blob = await editedDocumentBlob(file.id);
    entries[file.path] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  const bytes = await new Promise((resolve, reject) =>
    zip(entries, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data))),
  );
  return new Blob([bytes], { type: 'application/zip' });
}
