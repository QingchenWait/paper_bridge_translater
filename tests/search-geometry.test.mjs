import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexPageText, findPageMatches } from '../src/js/pdf-search.js';
import { translateAnnotation, hitShape, distanceToSegment } from '../src/js/shapes.js';
test('search returns every match with case/whole-word filters and literal metacharacters', () => {
  const index = indexPageText([{ str: 'Alpha alphabet ALPHA alpha. C++ [test]', hasEOL: true }]);
  assert.equal(findPageMatches(index, 'alpha').length, 4);
  assert.equal(findPageMatches(index, 'Alpha', { caseSensitive: true }).length, 1);
  assert.equal(findPageMatches(index, 'alpha', { wholeWord: true }).length, 3);
  assert.equal(findPageMatches(index, 'C++').length, 1);
  assert.equal(findPageMatches(index, '[test]').length, 1);
  const cross = indexPageText([{ str: 'Across', hasEOL: true }, { str: 'lines' }]);
  assert.equal(findPageMatches(cross, 'Across lines')[0].parts.length, 2);
});
test('drag clamps objects to their page without moving a note text anchor; eraser hits line segments', () => {
  const note = { type: 'note', x: 0.8, y: 0.8, rects: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.02 }] };
  const moved = translateAnnotation(note, 0.5, 0.5, { w: 0.15, h: 0.1 });
  assert.equal(moved.x, 0.85);
  assert.equal(moved.y, 0.9);
  assert.deepEqual(moved.rects, note.rects);
  const shape = { type: 'shape', shape: 'line', start: { x: 0.1, y: 0.1 }, end: { x: 0.9, y: 0.9 } };
  assert.equal(hitShape(shape, { x: 0.5, y: 0.5 }, 600, 800), true);
  assert.equal(hitShape(shape, { x: 0.1, y: 0.9 }, 600, 800), false);
  assert.equal(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 10 }), 0);
  const translated = translateAnnotation(shape, 1, 1);
  assert.equal(translated.end.x, 1);
  assert.equal(translated.end.y, 1);
});
