import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import {
  database,
  STORES,
  addDocument,
  all,
  get,
  put,
  patch,
  snapshot,
  mergeSnapshot,
  contextDocument,
} from '../src/js/storage.js';
import {
  createFolder,
  readLibrary,
  objectKey,
  moveSelection,
  planDeletion,
  deleteSelection,
  downloadPlan,
  buildLibraryZip,
  sortLibraryObjects,
} from '../src/js/library.js';
import { createArchive, readArchive, importArchive } from '../src/js/archive.js';
const key = (doc) => objectKey('document', doc.id),
  folderKey = (folder) => objectKey('folder', folder.id);
const pdf = (name) => new Blob([`%PDF-1.7\n${name}`], { type: 'application/pdf' });
beforeEach(async () => {
  const tx = (await database()).transaction(STORES, 'readwrite');
  for (const store of STORES) await tx.objectStore(store).clear();
  await tx.done;
});
async function pair(folderId = null) {
  const source = await addDocument(pdf('source'), 'Paper.pdf', 1, null, folderId),
    translated = await addDocument(pdf('translation'), 'Translated.pdf', 1, source.id, folderId, source.id);
  return { source, translated };
}
async function history(source, translated) {
  await put('conversations', { id: 'thread', rootId: source.rootId, title: 'Saved history', createdAt: 1 });
  await put('messages', {
    id: 'message',
    conversationId: 'thread',
    role: 'assistant',
    content: 'keep this history',
    createdAt: 2,
    status: 'complete',
  });
  for (const doc of [source, translated])
    await put('annotations', {
      id: `annotation-${doc.id}`,
      documentId: doc.id,
      page: 1,
      type: 'text',
      text: doc.name,
      x: 0.1,
      y: 0.1,
      color: '#123456',
      createdAt: 3,
    });
  await put('translations', {
    id: 'translation',
    rootId: source.rootId,
    documentId: source.id,
    generatedDocumentId: translated.id,
    content: 'Full translated text',
    createdAt: 4,
    status: 'complete',
  });
}
test('folders support nesting and moves follow original-to-translation without flattening children', async () => {
  const a = await createFolder('A'),
    b = await createFolder('B', a.id),
    destination = await createFolder('Destination');
  const { source, translated } = await pair(b.id);
  await moveSelection([key(translated)], null);
  assert.equal((await get('documents', source.id)).folderId, b.id);
  await moveSelection([folderKey(a), folderKey(b), key(source)], destination.id);
  assert.equal((await get('folders', a.id)).parentId, destination.id);
  assert.equal((await get('folders', b.id)).parentId, a.id);
  assert.equal((await get('documents', translated.id)).folderId, b.id);
  const before = await snapshot();
  await assert.rejects(moveSelection([folderKey(a)], b.id), /自身/);
  assert.deepEqual(await snapshot(), before);
  await moveSelection([key(source)], null);
  assert.equal((await get('documents', translated.id)).folderId, null);
});
test('new translations use the current source directory even after a source move', async () => {
  const a = await createFolder('A'),
    b = await createFolder('B');
  const source = await addDocument(pdf('a'), 'source.pdf', 1, null, a.id);
  await moveSelection([key(source)], b.id);
  const translated = await addDocument(pdf('b'), 'translated.pdf', 1, source.id, a.id, source.id);
  assert.equal(translated.folderId, b.id);
});
test('all sorts keep folders first and use the selected direction within each kind', () => {
  const rows = [
    { kind: 'document', id: 'd', name: 'A.pdf', createdAt: 1 },
    { kind: 'folder', id: 'b', name: 'B', createdAt: 3 },
    { kind: 'folder', id: 'a', name: 'A', createdAt: 2 },
  ];
  for (const sort of ['name', 'createdAt'])
    for (const direction of ['asc', 'desc']) {
      const ordered = sortLibraryObjects(rows, sort, direction);
      assert.deepEqual(
        ordered.map((x) => x.kind),
        ['folder', 'folder', 'document'],
      );
      assert.equal(ordered[0].id, direction === 'asc' ? 'a' : 'b');
    }
});
test('download scope never follows paired PDFs; ZIP retains selected folders, empty children and duplicate names', async () => {
  const a = await createFolder('Folder'),
    b = await createFolder('Child', a.id);
  await createFolder('Empty', b.id);
  const { source, translated } = await pair(a.id);
  const extra = await addDocument(pdf('other'), 'Paper.pdf', 1, null, b.id);
  const state = await readLibrary();
  const only = downloadPlan(state, [key(source)]);
  assert.deepEqual(
    only.files.map((f) => f.id),
    [source.id],
  );
  assert.equal(only.zip, false);
  assert.equal(downloadPlan(state, [key(source), key(translated)]).zip, false);
  assert.equal(downloadPlan(state, [key(source), key(translated), key(extra)]).zip, true);
  const plan = downloadPlan(state, [folderKey(a), folderKey(b), key(source)]);
  assert.equal(plan.files.length, 3);
  const entries = unzipSync(new Uint8Array(await (await buildLibraryZip(plan)).arrayBuffer()));
  assert.ok(entries['Folder/']);
  assert.ok(entries['Folder/Child/Empty/']);
  assert.ok(entries['Folder/Paper.pdf']);
  assert.ok(entries['Folder/Child/Paper.pdf']);
  const duplicate = await addDocument(pdf('duplicate'), 'Paper.pdf', 1, null, a.id);
  const names = downloadPlan(await readLibrary(), [folderKey(a)]).files.map((f) => f.path);
  assert.equal(new Set(names).size, 4);
  assert.ok(names.some((name) => name.includes('(2)')));
  assert.ok(duplicate.id);
});
test('deleting only the original keeps the translation, its annotations, shared history and archive integrity', async () => {
  const { source, translated } = await pair();
  await history(source, translated);
  const unrelated = await addDocument(pdf('unrelated'), 'Untouched.pdf', 1);
  const keep = await get('documents', unrelated.id);
  const plan = planDeletion(await readLibrary(), [key(source)]);
  await deleteSelection(plan);
  assert.equal(await get('documents', source.id), undefined);
  assert.equal(await get('files', source.id), undefined);
  assert.equal(await get('annotations', `annotation-${source.id}`), undefined);
  assert.ok(await get('documents', translated.id));
  assert.ok(await get('annotations', `annotation-${translated.id}`));
  assert.equal((await get('messages', 'message')).content, 'keep this history');
  assert.equal((await contextDocument(source.id)).id, translated.id);
  assert.equal((await get('translations', 'translation')).documentId, translated.id);
  assert.deepEqual(await get('documents', unrelated.id), keep);
  const backup = await readArchive(await createArchive());
  assert.equal(backup.documents.length, 2);
  assert.equal(backup.messages.length, 1);
});
test('deleting only the translation preserves the original; deleting the last member removes only that group history', async () => {
  const { source, translated } = await pair();
  await history(source, translated);
  const other = await addDocument(pdf('other'), 'Other.pdf', 1);
  await put('conversations', { id: 'other-thread', rootId: other.id, title: 'Other', createdAt: 1 });
  await put('messages', {
    id: 'other-message',
    conversationId: 'other-thread',
    role: 'user',
    content: 'unrelated',
    createdAt: 2,
  });
  await deleteSelection(planDeletion(await readLibrary(), [key(translated)]));
  assert.ok(await get('documents', source.id));
  assert.ok(await get('messages', 'message'));
  assert.equal((await get('translations', 'translation')).generatedDocumentId, null);
  await deleteSelection(planDeletion(await readLibrary(), [key(source)]));
  assert.equal(await get('messages', 'message'), undefined);
  assert.equal(await get('conversations', 'thread'), undefined);
  assert.equal(await get('translations', 'translation'), undefined);
  assert.equal((await get('messages', 'other-message')).content, 'unrelated');
  assert.ok(await get('documents', other.id));
});
test('reviewed folder deletion excludes newly added children and documents moved out during confirmation', async () => {
  const a = await createFolder('A'),
    child = await createFolder('Child', a.id),
    outside = await createFolder('Outside');
  const first = await addDocument(pdf('first'), 'First.pdf', 1, null, child.id),
    escaped = await addDocument(pdf('escaped'), 'Escaped.pdf', 1, null, a.id);
  const plan = planDeletion(await readLibrary(), [folderKey(a), folderKey(child), key(first)]);
  await moveSelection([key(escaped)], outside.id);
  const added = await addDocument(pdf('new'), 'New.pdf', 1, null, child.id);
  const result = await deleteSelection(plan);
  assert.deepEqual(result.documentIds, [first.id]);
  assert.ok(await get('documents', escaped.id));
  assert.ok(await get('documents', added.id));
  assert.ok(await get('folders', child.id));
  assert.ok(await get('folders', a.id));
  assert.equal(result.retainedFolders.length, 2);
});
test('empty, invalid and cyclic selections cannot delete unrelated data', async () => {
  const source = await addDocument(pdf('safe'), 'Safe.pdf', 1);
  const before = await snapshot();
  await deleteSelection(planDeletion(await readLibrary(), []));
  await deleteSelection(planDeletion(await readLibrary(), ['folder:', 'folder:missing', 'document:missing']));
  assert.deepEqual(await snapshot(), before);
  const a = await createFolder('Cycle');
  await patch('folders', a.id, { parentId: a.id });
  assert.throws(
    () => planDeletion({ folders: [{ ...a, parentId: a.id }], documents: [source] }, [folderKey(a)]),
    /循环/,
  );
  assert.ok(await get('files', source.id));
});
test('deletion rolls the entire transaction back if a tombstone write fails', async () => {
  const { source, translated } = await pair();
  const before = await snapshot(),
    original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'deletions') throw new DOMException('test quota', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try {
    await assert.rejects(
      deleteSelection(planDeletion(await readLibrary(), [key(source), key(translated)])),
      /quota/,
    );
  } finally {
    IDBObjectStore.prototype.put = original;
  }
  assert.deepEqual(await snapshot(), before);
});
test('old snapshots do not resurrect deleted files; newer local edits are not removed by stale remote tombstones', async () => {
  const { source, translated } = await pair();
  await history(source, translated);
  const old = await snapshot();
  await deleteSelection(planDeletion(await readLibrary(), [key(source)]));
  const deleted = await snapshot();
  await mergeSnapshot(old);
  assert.equal(await get('documents', source.id), undefined);
  assert.ok(await get('files', translated.id));
  const tx = (await database()).transaction(STORES, 'readwrite');
  for (const store of STORES) {
    await tx.objectStore(store).clear();
    for (const row of old[store]) await tx.objectStore(store).put(row);
  }
  await tx.done;
  const edited = await get('annotations', `annotation-${source.id}`);
  edited.updatedAt = Math.max(...deleted.deletions.map((d) => d.updatedAt)) + 1000;
  edited.text = 'new local edit';
  await (await database()).put('annotations', edited);
  await mergeSnapshot(deleted);
  assert.ok(await get('documents', source.id));
  assert.ok(await get('files', source.id));
  assert.equal((await get('annotations', edited.id)).text, 'new local edit');
  assert.equal(
    (await all('deletions')).some((t) => t.store === 'documents' && t.key === source.id),
    false,
  );
  assert.ok((await readArchive(await createArchive())).documents.some((d) => d.id === source.id));
});
test('legacy version-one archives import without folders and new archives preserve hierarchy', async () => {
  await addDocument(pdf('legacy'), 'Legacy.pdf', 1);
  const bytes = new Uint8Array(await (await createArchive()).arrayBuffer()),
    files = unzipSync(bytes),
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  manifest.version = 1;
  delete manifest.data.folders;
  delete manifest.data.deletions;
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const legacy = await readArchive(new Blob([zipSync(files)]));
  assert.deepEqual(legacy.folders, []);
  assert.deepEqual(legacy.deletions, []);
  const folder = await createFolder('Saved folder');
  await createFolder('Nested', folder.id);
  assert.equal((await readArchive(await createArchive())).folders.length, 2);
});
test('a new counterpart created after confirmation preserves the group and its history', async () => {
  const { source, translated } = await pair();
  await history(source, translated);
  const plan = planDeletion(await readLibrary(), [key(source), key(translated)]);
  const late = await addDocument(pdf('new translation'), 'Later.pdf', 1, source.id, null, source.id);
  await deleteSelection(plan);
  assert.ok(await get('files', late.id));
  assert.ok(await get('messages', 'message'));
  assert.equal((await contextDocument(source.id)).id, late.id);
  assert.equal((await get('translations', 'translation')).documentId, late.id);
});
test('concurrent valid folder moves that form a merge cycle are detached without deleting contents', async () => {
  const a = await createFolder('A'),
    b = await createFolder('B');
  const doc = await addDocument(pdf('keep'), 'Keep.pdf', 1, null, a.id);
  const base = await snapshot();
  await patch('folders', b.id, { parentId: a.id });
  const now = Date.now() + 100;
  const incoming = {
    ...base,
    folders: base.folders.map((f) => (f.id === a.id ? { ...f, parentId: b.id, updatedAt: now } : f)),
  };
  await mergeSnapshot(incoming);
  const state = await readLibrary();
  assert.doesNotThrow(() => planDeletion(state, []));
  assert.ok(await get('files', doc.id));
  assert.equal(state.folders.length, 2);
});
test('explicit local archive import can restore reviewed deletions while passive old sync snapshots cannot', async () => {
  const { source } = await pair();
  const archive = await createArchive(),
    old = await snapshot();
  await deleteSelection(planDeletion(await readLibrary(), [key(source)]));
  await mergeSnapshot(old);
  assert.equal(await get('documents', source.id), undefined);
  await importArchive(archive);
  assert.ok(await get('documents', source.id));
  assert.ok(await get('files', source.id));
  assert.equal(
    (await all('deletions')).some((t) => t.store === 'documents' && t.key === source.id),
    false,
  );
});
test('newer local folder changes preserve contained PDFs against an older remote folder deletion', async () => {
  const folder = await createFolder('A'),
    doc = await addDocument(pdf('keep'), 'Keep.pdf', 1, null, folder.id),
    old = await snapshot();
  await deleteSelection(planDeletion(await readLibrary(), [folderKey(folder)]));
  const remote = await snapshot();
  const tx = (await database()).transaction(STORES, 'readwrite');
  for (const store of STORES) {
    await tx.objectStore(store).clear();
    for (const row of old[store]) await tx.objectStore(store).put(row);
  }
  await tx.done;
  await (
    await database()
  ).put('folders', {
    ...folder,
    name: 'New local name',
    updatedAt: Math.max(...remote.deletions.map((t) => t.updatedAt)) + 100,
  });
  await mergeSnapshot(remote);
  assert.ok(await get('files', doc.id));
  assert.ok(await get('documents', doc.id));
  assert.equal((await get('folders', folder.id)).name, 'New local name');
});
