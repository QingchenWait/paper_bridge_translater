import { isOfflineModel, setOfflineInstalled, validateDirection } from './offline/catalog.js';
import { getSettings, saveBasicTranslation } from './settings.js';

const base = () => new URL('offline/', new URL(import.meta.env.BASE_URL, document.baseURI)).href;
let sequence = 0,
  inference,
  management,
  loadedId,
  idleTimer;
const jobs = new Map();
const downloads = new Map();
const subscribers = new Set();
const publish = () => subscribers.forEach((fn) => fn());
export const offlineJob = (id) => jobs.get(id);
export function subscribeOffline(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
class WorkerClient {
  constructor() {
    this.pending = new Map();
    this.worker = new Worker(new URL('./offline/translation.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id);
      if (!request) return;
      if (data.type === 'progress') {
        request.progress?.(data);
        return;
      }
      this.pending.delete(data.id);
      request.cleanup();
      if (data.error) {
        const error = new Error(data.error);
        request.reject(error);
        if (request.type === 'load' || request.type === 'translate') this.close(error);
      } else request.resolve(data.result);
    };
    this.worker.onerror = () => this.close(new Error('离线翻译 Worker 启动失败，请检查浏览器及本地资源。'));
  }
  call(type, modelId, options = {}) {
    const { signal, progress, ...payload } = options;
    if (this.closed) return Promise.reject(new Error('离线翻译 Worker 已关闭，请重试。'));
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const id = ++sequence;
      const abort = () => this.close(signal.reason || new DOMException('已取消', 'AbortError'));
      const timer = setTimeout(
        () => this.close(new Error('离线模型操作超时，请重试或改用 Lite。')),
        ['install', 'import'].includes(type) ? 1800000 : 180000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      this.pending.set(id, { type, resolve, reject, progress, cleanup });
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ id, type, modelId, base: base(), ...payload });
    });
  }
  close(error = new DOMException('离线任务已取消', 'AbortError')) {
    this.worker.terminate();
    this.closed = true;
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
  }
}
function inferenceFor(id) {
  clearTimeout(idleTimer);
  if (loadedId !== id || inference?.closed) {
    inference?.close();
    inference = null;
  }
  loadedId = id;
  return (inference ||= new WorkerClient());
}
function releaseLater() {
  idleTimer = setTimeout(() => {
    if (!inference?.pending.size) {
      inference?.close();
      inference = null;
    }
  }, 90000);
}
function manager() {
  if (management?.closed) management = null;
  return (management ||= new WorkerClient());
}
export async function refreshOfflineModels({ preserveDefault = false } = {}) {
  const ids = await manager().call('list');
  setOfflineInstalled(ids);
  const settings = await getSettings();
  if (
    !preserveDefault &&
    settings.basicTranslation.defaultProvider !== 'offline-lite' &&
    isOfflineModel(settings.basicTranslation.defaultProvider) &&
    !ids.includes(settings.basicTranslation.defaultProvider)
  )
    await saveBasicTranslation((current) => ({
      ...current,
      defaultProvider:
        current.defaultProvider === settings.basicTranslation.defaultProvider
          ? 'offline-lite'
          : current.defaultProvider,
    }));
  publish();
  document.dispatchEvent(new Event('offline-models-changed'));
  return ids;
}
export async function manageOfflineModel(id, action, files) {
  if (!isOfflineModel(id) || jobs.has(id)) return;
  jobs.set(id, { phase: action === 'delete' ? 'deleting' : 'download', bytes: 0 });
  publish();
  const client = new WorkerClient();
  downloads.set(id, client);
  try {
    if (action === 'delete' && loadedId === id) {
      inference?.close();
      inference = null;
    }
    await client.call(action, id, {
      files,
      progress: (p) => {
        jobs.set(id, p);
        publish();
      },
    });
    await refreshOfflineModels();
  } finally {
    client.close();
    downloads.delete(id);
    if (jobs.get(id)?.phase !== 'cancelling') jobs.delete(id);
    publish();
  }
}
export async function cancelOfflineModel(id) {
  if (!downloads.has(id) || jobs.get(id)?.phase !== 'download') return;
  jobs.set(id, { phase: 'cancelling' });
  publish();
  downloads.get(id)?.close();
  // Discard incomplete files for this model only; never touch the application database.
  try {
    await manager().call('delete', id);
    await refreshOfflineModels({ preserveDefault: true });
  } finally {
    jobs.delete(id);
    publish();
  }
}
export async function offlineTranslate(text, { provider, source, target, signal, onProgress }) {
  validateDirection(provider, source, target);
  onProgress?.('loading');
  try {
    return await inferenceFor(provider).call('translate', provider, {
      text,
      source,
      target,
      signal,
      progress: ({ phase }) => onProgress?.(phase),
    });
  } finally {
    releaseLater();
  }
}
export function startOfflineTranslation() {
  const start = () => {
    refreshOfflineModels().catch(() => {});
    if (!inference) {
      const client = inferenceFor('offline-lite');
      client
        .call('load', 'offline-lite')
        .catch(() => {
          client.close();
          if (inference === client) inference = null;
        })
        .finally(releaseLater);
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 500);
  if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext)
    navigator.serviceWorker
      .register(new URL('sw.js', new URL(import.meta.env.BASE_URL, document.baseURI)))
      .catch(() => {});
}
