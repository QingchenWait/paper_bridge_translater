import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePdfDestination, linkRects } from '../src/js/pdf-internal-links.js';
const page = {
  view: [10, 20, 610, 820],
  getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x, y) => [x - 10, 820 - y] }),
};
const pdf = {
  numPages: 3,
  getDestination: async () => [{ num: 8, gen: 0 }, { name: 'XYZ' }, 70, 620, 2],
  getPageIndex: async () => 1,
  getPage: async () => page,
};
test('internal destinations resolve references, zero-based pages and XYZ/Fit coordinates', async () => {
  assert.deepEqual(await resolvePdfDestination(pdf, 'ref'), { page: 2, rect: { x: 0.1, y: 0.25 } });
  assert.deepEqual(await resolvePdfDestination(pdf, [0, { name: 'FitH' }, 420]), {
    page: 1,
    rect: { x: 0, y: 0.5 },
  });
  assert.deepEqual(await resolvePdfDestination(pdf, [2, { name: 'FitR' }, 70, 200, 400, 620]), {
    page: 3,
    rect: { x: 0.1, y: 0.25 },
  });
  assert.deepEqual(await resolvePdfDestination(pdf, [1, { name: 'XYZ' }, null, null, null]), {
    page: 2,
    rect: { x: 0, y: 0 },
  });
  assert.equal(await resolvePdfDestination(pdf, [5, { name: 'Fit' }]), null);
  assert.equal(await resolvePdfDestination(pdf, {}), null);
});
test('link rectangles transform quad points, clip at page boundaries and ignore empty areas', () => {
  const viewport = {
    width: 600,
    height: 800,
    convertToViewportPoint: (x, y) => [x, 800 - y],
  };
  assert.deepEqual(linkRects({ rect: [-10, 680, 90, 710] }, viewport), [
    { x: 0, y: 90, right: 90, bottom: 120 },
  ]);
  assert.deepEqual(
    linkRects({ quadPoints: new Float32Array([10, 710, 90, 710, 10, 680, 90, 680]) }, viewport),
    [{ x: 10, y: 90, right: 90, bottom: 120 }],
  );
  assert.deepEqual(linkRects({ rect: [10, 20, 10, 20] }, viewport), []);
});
