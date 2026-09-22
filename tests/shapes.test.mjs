import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeGeometry } from '../src/js/shapes.js';
import { planSelectionAction, selectionActionState } from '../src/js/selection-actions.js';
test('shape geometry uses PDF points, supports reverse drag and gives arrows two heads', () => {
  const record = { start: { x: 0.8, y: 0.7 }, end: { x: 0.2, y: 0.2 }, strokeWidth: 3 };
  const rectangle = shapeGeometry({ ...record, shape: 'rectangle' }, 600, 800);
  assert.equal(rectangle.x, 120);
  assert.equal(rectangle.y, 160);
  assert.equal(rectangle.width, 360);
  assert.equal(rectangle.height, 400);
  const circle = shapeGeometry({ ...record, shape: 'circle' }, 600, 800);
  assert.equal(circle.radius, 180);
  assert.equal(circle.x, 300);
  assert.equal(circle.y, 380);
  const arrow = shapeGeometry({ ...record, shape: 'arrow' }, 600, 800);
  assert.equal(arrow.segments.length, 3);
  assert.deepEqual(arrow.segments[1][0], arrow.segments[0][1]);
});
test('strikethrough reuses independent selection toggling and notes preserve requested font size', async () => {
  const selection = { text: 'two words', rects: [{ page: 1, x: 0.1, y: 0.2, w: 0.4, h: 0.03 }] };
  const changes = await planSelectionAction('strike', [], selection, { color: '#6370ee' });
  assert.equal(changes.length, 1);
  assert.equal(
    selectionActionState(
      changes.map((c) => c.after),
      selection,
    ).strike,
    true,
  );
  const removed = await planSelectionAction(
    'strike',
    changes.map((c) => c.after),
    selection,
    { color: '#6370ee' },
  );
  assert.equal(removed[0].after.deleted, true);
  const note = await planSelectionAction('note', [], selection, {
    color: '#123456',
    fontSize: 24,
    inputText: async () => 'Note',
  });
  assert.equal(note[0].after.fontSize, 24);
});
