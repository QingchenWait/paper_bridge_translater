import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeCacheName, cacheRuntimeAsset, cacheBergamotModule } from '../src/js/offline/runtime-cache.js';

const manifest = { runtimes: [{ sha256: 'pinned-wasm' }, { sha256: 'pinned-module' }] };
// Node has no CacheStorage; each test supplies the browser API it needs.
function mockCaches(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, 'caches', descriptor);
    else delete globalThis.caches;
  });
}
test('runtime cache versions are independent of shell hashes and separated by static scope', () => {
  assert.notEqual(
    runtimeCacheName('https://app.test/a/offline/', manifest),
    runtimeCacheName('https://app.test/b/offline/', manifest),
  );
  assert.notEqual(
    runtimeCacheName('https://app.test/a/offline/', manifest),
    runtimeCacheName('https://app.test/a/offline/', { runtimes: [{ sha256: 'updated-wasm' }] }),
  );
});

test('selected runtime caching reuses verified blobs and stores module MIME without refetching', async (t) => {
  const values = new Map(),
    names = [];
  mockCaches(t, {
    async open(name) {
      names.push(name);
      return {
        async match(key) {
          return values.get(key);
        },
        async put(key, value) {
          values.set(key, value);
        },
      };
    },
  });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    return new Response('export default function() {}', { headers: { 'Content-Type': 'text/javascript' } });
  });
  const base = 'https://app.test/nested/offline/';
  await cacheRuntimeAsset('onnx/ort-wasm.wasm', new Blob(['wasm bytes']), base, manifest);
  await cacheRuntimeAsset('onnx/transformers.min.js', new Blob(['js bytes']), base, manifest);
  await cacheBergamotModule(base, manifest);
  await cacheBergamotModule(base, manifest);
  assert.equal(requests, 1);
  assert.equal(new Set(names).size, 1);
  assert.equal(values.get(`${base}onnx/ort-wasm.wasm`).headers.get('Content-Type'), 'application/wasm');
  assert.equal(values.get(`${base}onnx/transformers.min.js`).headers.get('Content-Type'), 'text/javascript');
  assert.equal(await values.get(`${base}onnx/ort-wasm.wasm`).text(), 'wasm bytes');
});

test('unavailable or blocked CacheStorage does not prevent local inference', async (t) => {
  mockCaches(t, undefined);
  await cacheRuntimeAsset('onnx/runtime.wasm', new Blob(['x']), 'https://app.test/offline/', manifest);
  await cacheBergamotModule('https://app.test/offline/', manifest);
  globalThis.caches = {
    async open() {
      throw new Error('blocked');
    },
  };
  await cacheRuntimeAsset('onnx/runtime.wasm', new Blob(['x']), 'https://app.test/offline/', manifest);
  await cacheBergamotModule('https://app.test/offline/', manifest);
});
