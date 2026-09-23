import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSelectionAction,
  selectionActionState,
  registerSelectionAction,
} from '../src/js/selection-actions.js';
const rect = { page: 1, x: 0.1, y: 0.2, w: 0.6, h: 0.02 };
const marked = (type) => ({ id: type, type, page: 1, color: '#ffe082', rects: [rect], deleted: false });
const context = { color: '#ffe082', inputText: async () => '批注内容' };
test('selection actions are no-ops without a range and extensible through one registry', async () => {
  assert.deepEqual(await planSelectionAction('highlight', [], null, context), []);
  registerSelectionAction('future-mark', async () => ({ value: 'extra' }));
  const changes = await planSelectionAction('future-mark', [], { text: 'selected', rects: [rect] }, context);
  assert.equal(changes[0].after.value, 'extra');
  assert.equal(changes[0].after.selectedText, 'selected');
});
test('multiple marks report independent pressed states and remove only selected text', async () => {
  const selection = { text: 'middle', rects: [{ ...rect, x: 0.3, w: 0.15 }] };
  const notes = [marked('highlight'), marked('underline')];
  assert.equal(selectionActionState(notes, selection).highlight, true);
  assert.equal(selectionActionState(notes, selection).underline, true);
  const changes = await planSelectionAction('highlight', notes, selection, context);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before.id, 'highlight');
  assert.equal(changes[0].after.rects.length, 2);
  assert.equal(changes[0].after.deleted, false);
  assert.ok(Math.abs(changes[0].after.rects[0].w - 0.2) < 0.00001);
  assert.ok(Math.abs(changes[0].after.rects[1].x - 0.45) < 0.00001);
  assert.equal(selectionActionState([changes[0].after], selection).highlight, false);
});
test('multi-page notes preserve anchors and start empty for inline input', async () => {
  const selection = { text: 'across pages', rects: [rect, { ...rect, page: 2 }] };
  const notes = await planSelectionAction('note', [], selection, context);
  assert.equal(notes.length, 2);
  assert.equal(notes[1].after.page, 2);
  assert.equal(notes[0].after.text, '');
  assert.equal(notes[0].after.selectedText, 'across pages');
  const cleared = await planSelectionAction(
    'note',
    notes.map((c) => c.after),
    selection,
    context,
  );
  assert.ok(cleared.every((c) => c.after.deleted));
});
