import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { addDocument, get, database } from '../src/js/storage.js';
import { writeAnnotations, flushAnnotations } from '../src/js/annotation-writes.js';
import { createArchive, readArchive } from '../src/js/archive.js';
async function fixture(id) {
  const doc = await addDocument(new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'Notes.pdf', 1);
  return {
    id,
    documentId: doc.id,
    page: 1,
    type: 'note',
    text: 'Before',
    x: 0.1,
    y: 0.2,
    color: '#6370ee',
    fontSize: 12,
    createdAt: Date.now(),
    deleted: false,
  };
}
test('inline annotation writes capture values before async work and preserve last-input order', async () => {
  const row = await fixture('queued-note'),
    first = writeAnnotations([row]);
  row.text = 'First revision';
  const second = writeAnnotations([row]);
  row.text = 'Not queued';
  await Promise.all([first, second]);
  await flushAnnotations();
  assert.equal((await get('annotations', row.id)).text, 'First revision');
});
test('annotation groups roll back together and never revive an absent owner', async () => {
  const valid = await fixture('valid-note'),
    missing = await fixture('missing-note');
  await writeAnnotations([valid]);
  await (await database()).delete('documents', missing.documentId);
  await assert.rejects(writeAnnotations([{ ...valid, text: 'Must roll back' }, missing]), /已删除/);
  assert.equal((await get('annotations', valid.id)).text, 'Before');
  assert.equal(await get('annotations', missing.id), undefined);
  await writeAnnotations([{ ...valid, text: 'Queue recovered' }]);
  assert.equal((await get('annotations', valid.id)).text, 'Queue recovered');
  // Keep the synthetic archive fixture consistent after testing the orphan guard.
  await (await database()).delete('files', missing.documentId);
});
test('backup waits for active editing and retains manual width, geometry, border and multiline text', async () => {
  const row = {
    ...(await fixture('archive-text')),
    type: 'text',
    text: '中文\nSecond line',
    width: 0.7,
    boxWidth: 0.7,
    boxHeight: 0.13,
    border: true,
  };
  const saving = writeAnnotations([row]);
  const restored = await readArchive(await createArchive());
  await saving;
  const result = restored.annotations.find((a) => a.id === row.id);
  for (const key of ['text', 'width', 'boxWidth', 'boxHeight', 'border'])
    assert.deepEqual(result[key], row[key]);
});
