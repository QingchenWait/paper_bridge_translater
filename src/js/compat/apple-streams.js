// PDF.js legacy includes ECMAScript polyfills, but not this Web Streams method.
// Install only in the Apple compatibility realm (window and its PDF worker).
export function installPromiseResolvers(PromiseClass = globalThis.Promise) {
  if (typeof PromiseClass.withResolvers === 'function') return;
  Object.defineProperty(PromiseClass, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve, reject;
      const promise = new this((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      return { promise, resolve, reject };
    },
  });
}
export function installAppleRuntime() {
  installPromiseResolvers();
  installStreamIterator();
}
export function installStreamIterator(Stream = globalThis.ReadableStream) {
  if (!Stream || typeof Stream.prototype[Symbol.asyncIterator] === 'function') return;
  function values({ preventCancel = false } = {}) {
    const reader = this.getReader();
    let finished = false,
      pending = Promise.resolve();
    const enqueue = (operation) => {
      const result = pending.then(operation, operation);
      pending = result.catch(() => {});
      return result;
    };
    const release = () => {
      finished = true;
      reader.releaseLock();
    };
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return enqueue(async () => {
          if (finished) return { value: undefined, done: true };
          try {
            const result = await reader.read();
            if (result.done) release();
            return result;
          } catch (error) {
            release();
            throw error;
          }
        });
      },
      return(value) {
        return enqueue(async () => {
          if (!finished) {
            try {
              if (!preventCancel) await reader.cancel(value);
            } finally {
              release();
            }
          }
          return { value, done: true };
        });
      },
    };
  }
  if (typeof Stream.prototype.values !== 'function')
    Object.defineProperty(Stream.prototype, 'values', { value: values, writable: true, configurable: true });
  Object.defineProperty(Stream.prototype, Symbol.asyncIterator, {
    value: Stream.prototype.values,
    writable: true,
    configurable: true,
  });
}
