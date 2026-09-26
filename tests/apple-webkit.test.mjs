import test from 'node:test';
import assert from 'node:assert/strict';
import { applePlatform } from '../src/js/compat/apple-webkit.js';
import {
  installAbortSignal,
  installArrayBufferTransfer,
  installStreamIterator,
  installPromiseResolvers,
} from '../src/js/compat/pdf-runtime.js';
test('Apple WebKit rules include iPad desktop mode and iOS browsers, but exclude macOS Chrome', () => {
  for (const navigator of [
    {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 Version/26.3 Mobile Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    },
    {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    },
    {
      userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/150 Mobile Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    },
  ])
    assert.deepEqual(applePlatform(navigator), { webkit: true, touch: true });
  assert.equal(
    applePlatform({
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.4 Safari/605.1.15',
      platform: 'MacIntel',
    }).webkit,
    true,
  );
  assert.equal(
    applePlatform({
      userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/149.0 Safari/537.36',
      platform: 'MacIntel',
    }).webkit,
    false,
  );
  assert.equal(
    applePlatform({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/149.0 Safari/537.36',
      platform: 'Win32',
    }).webkit,
    false,
  );
  assert.equal(
    applePlatform({
      userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/149 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    }).webkit,
    false,
  );
});
function LegacyStream() {
  class Legacy {
    constructor(source) {
      this.stream = new ReadableStream(source);
    }
    getReader() {
      return this.stream.getReader();
    }
  }
  installStreamIterator(Legacy);
  return Legacy;
}
test('Apple promise capability fallback preserves subclass semantics and existing native methods', async () => {
  class LegacyPromise extends Promise {}
  Object.defineProperty(LegacyPromise, 'withResolvers', { value: undefined, configurable: true });
  installPromiseResolvers(LegacyPromise);
  const capability = LegacyPromise.withResolvers();
  assert.ok(capability.promise instanceof LegacyPromise);
  capability.resolve('ready');
  assert.equal(await capability.promise, 'ready');
  const native = Promise.withResolvers;
  installPromiseResolvers();
  assert.equal(Promise.withResolvers, native);
});
test('Apple AbortSignal fallback composes cancellation and timeout without replacing native helpers', async () => {
  const NativeAny = AbortSignal.any,
    NativeTimeout = AbortSignal.timeout;
  Object.defineProperty(AbortSignal, 'any', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true });
  installAbortSignal();
  const controller = new AbortController(),
    combined = AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]);
  controller.abort('selected');
  assert.equal(combined.aborted, true);
  assert.equal(combined.reason, 'selected');
  const timed = AbortSignal.timeout(1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(timed.aborted, true);
  Object.defineProperty(AbortSignal, 'any', { value: NativeAny, configurable: true, writable: true });
  Object.defineProperty(AbortSignal, 'timeout', { value: NativeTimeout, configurable: true, writable: true });
});
test('Apple ArrayBuffer fallback keeps PDF.js fixed-length metadata copies usable', () => {
  class LegacyBuffer extends ArrayBuffer {}
  installArrayBufferTransfer(LegacyBuffer);
  const buffer = new LegacyBuffer(12);
  new Uint8Array(buffer).set([1, 2, 3, 4]);
  const copy = buffer.transferToFixedLength(4);
  assert.equal(copy.byteLength, 4);
  assert.deepEqual([...new Uint8Array(copy)], [1, 2, 3, 4]);
});
test('Apple stream iterator reads sequentially, releases locks and does not overwrite a native implementation', async () => {
  const Legacy = LegacyStream(),
    stream = new Legacy({
      start(c) {
        c.enqueue('first');
        c.enqueue('second');
        c.close();
      },
    });
  const iterator = stream[Symbol.asyncIterator]();
  assert.deepEqual(await Promise.all([iterator.next(), iterator.next(), iterator.next()]), [
    { value: 'first', done: false },
    { value: 'second', done: false },
    { value: undefined, done: true },
  ]);
  assert.equal(stream.stream.locked, false);
  const native = ReadableStream.prototype[Symbol.asyncIterator];
  installStreamIterator();
  assert.equal(ReadableStream.prototype[Symbol.asyncIterator], native);
});
test('Apple stream iterator cancels on early return, honors preventCancel and releases failed streams', async () => {
  const Legacy = LegacyStream();
  let reason;
  const stream = new Legacy({
    start(c) {
      c.enqueue('value');
    },
    cancel(value) {
      reason = value;
    },
  });
  const iterator = stream.values();
  await iterator.next();
  await iterator.return('stop');
  assert.equal(reason, 'stop');
  assert.equal(stream.stream.locked, false);
  reason = null;
  const kept = new Legacy({
    start(c) {
      c.enqueue('one');
      c.enqueue('two');
    },
    cancel() {
      reason = 'canceled';
    },
  });
  const preserving = kept.values({ preventCancel: true });
  await preserving.next();
  await preserving.return();
  assert.equal(reason, null);
  assert.equal(kept.stream.locked, false);
  const reader = kept.getReader();
  assert.equal((await reader.read()).value, 'two');
  reader.releaseLock();
  const broken = new Legacy({
    start(c) {
      c.error(new Error('failed'));
    },
  });
  await assert.rejects(broken.values().next(), /failed/);
  assert.equal(broken.stream.locked, false);
});
