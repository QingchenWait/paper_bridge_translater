import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import 'fake-indexeddb/auto';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { md5Blob } from '../src/js/utils.js';
import {
  database,
  STORES,
  addDocument,
  get,
  patch,
  put,
  findDocumentsByMd5,
  mergeSnapshot,
} from '../src/js/storage.js';
import { createArchive, readArchive } from '../src/js/archive.js';
globalThis.document = new EventTarget();
const original = () => new Blob(['%PDF-1.7\n原始文件'], { type: 'application/pdf' });
beforeEach(async () => {
  const tx = (await database()).transaction(STORES, 'readwrite');
  for (const name of STORES) await tx.objectStore(name).clear();
  await tx.done;
});
test('chunked MD5 matches Node crypto for binary data and reuses the immutable Blob calculation', async () => {
  const bytes = Uint8Array.from({ length: 5 * 1024 * 1024 + 257 }, (_, i) => i % 251);
  const blob = new Blob([bytes]);
  assert.equal(md5Blob(blob), md5Blob(blob));
  assert.equal(await md5Blob(blob), createHash('md5').update(bytes).digest('hex'));
  assert.equal(await md5Blob(new Blob([])), 'd41d8cd98f00b204e9800998ecf8427e');
});
test('fingerprints use original bytes, survive edits and keep identical uploads as separate document groups', async () => {
  const blob = original(),
    first = await addDocument(blob, 'Paper.pdf', 1),
    copy = await addDocument(blob, 'Paper副本.pdf', 1),
    translated = await addDocument(blob, 'Translated.pdf', 1, first.rootId, null, first.id);
  await put('annotations', {
    id: 'note',
    documentId: first.id,
    page: 1,
    type: 'text',
    text: '编辑文字',
    x: 0.1,
    y: 0.1,
    color: '#334455',
    createdAt: 1,
    deleted: false,
  });
  await put('conversations', { id: 'thread', rootId: first.rootId, title: '只属于原文', createdAt: 1 });
  await patch('documents', first.id, { name: 'Renamed.pdf', zoom: 1.5 });
  assert.equal((await get('documents', first.id)).initialMd5, await md5Blob(blob));
  assert.equal(copy.initialMd5, first.initialMd5);
  assert.notEqual(copy.rootId, first.rootId);
  assert.equal(copy.rootId, copy.id);
  assert.equal(translated.initialMd5, first.initialMd5);
  assert.equal(translated.rootId, first.rootId);
  assert.equal((await findDocumentsByMd5(first.initialMd5)).length, 3);
  assert.equal((await get('files', first.id)).blob.size, blob.size);
});
test('legacy fingerprint backfill preserves metadata and its user-change timestamp', async () => {
  const row = await addDocument(original(), 'Legacy.pdf', 1);
  const { initialMd5, ...legacy } = row;
  legacy.name = '保留文件名.pdf';
  legacy.page = 7;
  legacy.zoom = 0.75;
  await (await database()).put('documents', legacy);
  const [found] = await findDocumentsByMd5(initialMd5);
  assert.deepEqual(found, { ...legacy, initialMd5 });
  assert.deepEqual(await findDocumentsByMd5('00000000000000000000000000000000'), []);
});
test('deleting a legacy document while hashing cannot recreate its metadata or files', async () => {
  const db = await database(),
    row = await addDocument(original(), 'Removed.pdf', 1);
  const { initialMd5, ...legacy } = row;
  await db.put('documents', legacy);
  const read = Blob.prototype.arrayBuffer;
  let started, resume;
  const ready = new Promise((resolve) => {
      started = resolve;
    }),
    held = new Promise((resolve) => {
      resume = resolve;
    });
  Blob.prototype.arrayBuffer = async function () {
    started();
    await held;
    return read.call(this);
  };
  try {
    const finding = findDocumentsByMd5(initialMd5);
    await ready;
    const tx = db.transaction(['documents', 'files'], 'readwrite');
    await tx.objectStore('documents').delete(row.id);
    await tx.objectStore('files').delete(row.id);
    await tx.done;
    resume();
    assert.deepEqual(await finding, []);
    assert.equal(await db.get('documents', row.id), undefined);
    assert.equal(await db.get('files', row.id), undefined);
  } finally {
    resume();
    Blob.prototype.arrayBuffer = read;
  }
});
test('archives preserve fingerprints, accept legacy absence and reject malformed fingerprints before import', async () => {
  const row = await addDocument(original(), 'Archive.pdf', 1);
  const blob = await createArchive(),
    data = await readArchive(blob);
  assert.equal(data.documents[0].initialMd5, row.initialMd5);
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  delete manifest.data.documents[0].initialMd5;
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  const legacy = await readArchive(new Blob([zipSync(files)]));
  const tx = (await database()).transaction(STORES, 'readwrite');
  for (const name of STORES) await tx.objectStore(name).clear();
  await tx.done;
  await mergeSnapshot(legacy);
  assert.equal((await findDocumentsByMd5(row.initialMd5))[0].initialMd5, row.initialMd5);
  manifest.data.documents[0].initialMd5 = 'broken';
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  await assert.rejects(readArchive(new Blob([zipSync(files)])), /文档引用不完整/);
  assert.equal((await get('documents', row.id)).initialMd5, row.initialMd5);
});
