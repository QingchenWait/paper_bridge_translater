// PDF.js legacy includes ECMAScript polyfills, but not this Web Streams method.
// Shared by the main window and the compatible PDF worker on every platform.
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
export function installPdfRuntime() {
  installPromiseResolvers();
  installAbortSignal();
  installArrayBufferTransfer();
  installStreamIterator();
}

// PDF.js 6 uses this resizable-buffer API while compiling font metadata.
// Older Safari lacks it; a fixed copy preserves the required result.
export function installArrayBufferTransfer(ArrayBufferClass = globalThis.ArrayBuffer) {
  if (!ArrayBufferClass?.prototype || typeof ArrayBufferClass.prototype.transferToFixedLength === 'function')
    return;
  Object.defineProperty(ArrayBufferClass.prototype, 'transferToFixedLength', {
    configurable: true,
    writable: true,
    value(newLength = this.byteLength) {
      const length = Math.max(0, Math.min(Number(newLength) || 0, this.byteLength));
      return this.slice(0, length);
    },
  });
}

// Safari before 17.4 has AbortController but not the static composition helpers.
// PDF.js and the app use both helpers, so install them before either module is imported.
export function installAbortSignal(AbortSignalClass = globalThis.AbortSignal) {
  if (!AbortSignalClass) return;
  if (typeof AbortSignalClass.timeout !== 'function')
    Object.defineProperty(AbortSignalClass, 'timeout', {
      configurable: true,
      writable: true,
      value(milliseconds) {
        const controller = new AbortController();
        const delay = Math.max(0, Number(milliseconds) || 0);
        setTimeout(() => {
          const reason = new DOMException('The operation timed out.', 'TimeoutError');
          controller.abort(reason);
        }, delay);
        return controller.signal;
      },
    });
  if (typeof AbortSignalClass.any === 'function') return;
  Object.defineProperty(AbortSignalClass, 'any', {
    configurable: true,
    writable: true,
    value(signals) {
      const controller = new AbortController();
      const sources = [...signals];
      const finish = (signal) => {
        sources.forEach((source) => source.removeEventListener('abort', onAbort));
        controller.abort(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
      };
      const onAbort = (event) => finish(event.target);
      for (const signal of sources) {
        if (signal.aborted) {
          finish(signal);
          break;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      return controller.signal;
    },
  });
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

// Execute before PDF.js is evaluated in the main window or a Worker realm.
installPdfRuntime();
