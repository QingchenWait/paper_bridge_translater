import test from 'node:test';
import assert from 'node:assert/strict';
import { hitEraserSweep } from '../src/js/shapes.js';

test('eraser sweeps detect crossing strokes between distant pointer events', () => {
  const pen = {
    type: 'pen',
    points: [
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.8 },
    ],
  };
  assert.equal(hitEraserSweep(pen, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, 600, 800), true);
  assert.equal(hitEraserSweep(pen, { x: 0.1, y: 0.05 }, { x: 0.9, y: 0.05 }, 600, 800), false);
  assert.equal(
    hitEraserSweep(
      { type: 'pen', points: [{ x: 0.5, y: 0.5 }] },
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
      600,
      800,
    ),
    true,
  );
});
test('eraser sweeps retain filled shape hit regions, arrow segments and point clicks', () => {
  for (const shape of ['rectangle', 'circle', 'line', 'arrow']) {
    const row = { type: 'shape', shape, start: { x: 0.4, y: 0.35 }, end: { x: 0.6, y: 0.65 } };
    assert.equal(hitEraserSweep(row, { x: 0.1, y: 0.4 }, { x: 0.9, y: 0.4 }, 600, 800), true, shape);
    assert.equal(hitEraserSweep(row, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, 600, 800), false, shape);
    assert.equal(hitEraserSweep(row, row.start, row.start, 600, 800), shape !== 'circle', shape);
  }
  assert.equal(hitEraserSweep({ type: 'note' }, { x: 0, y: 0 }, { x: 1, y: 1 }, 600, 800), false);
});
test('eraser tolerance follows page scale and never extends a segment into an infinite line', () => {
  const line = { type: 'shape', shape: 'line', start: { x: 0.4, y: 0.4 }, end: { x: 0.6, y: 0.4 } };
  assert.equal(hitEraserSweep(line, { x: 0.1, y: 0.4 }, { x: 0.2, y: 0.4 }, 600, 800), false);
  assert.equal(hitEraserSweep(line, { x: 0.5, y: 0.43 }, { x: 0.5, y: 0.43 }, 600, 800, 18), false);
  assert.equal(hitEraserSweep(line, { x: 0.5, y: 0.43 }, { x: 0.5, y: 0.43 }, 600, 800, 36), true);
});
