import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runtimeCacheVersion } from '../src/js/offline/runtime-cache.js';

// Precache only deployment assets, never PDFs, API responses, credentials or backups.
export function offlineServiceWorker() {
  return {
    name: 'paper-bridge-offline-shell',
    async closeBundle() {
      const paths = [],
        runtimePaths = [];
      async function walk(dir, prefix = '') {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = `${prefix}${entry.name}`;
          if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${path}/`);
          else if (path.startsWith('offline/bergamot/') || path.startsWith('offline/onnx/'))
            runtimePaths.push(path);
          else if (path !== 'sw.js' && !path.startsWith('offline/lite/')) paths.push(path);
        }
      }
      await walk('dist');
      const hash = createHash('sha256');
      for (const path of paths.sort()) hash.update(path).update(await readFile(`dist/${path}`));
      const revision = hash.digest('hex').slice(0, 16);
      const manifest = JSON.parse(await readFile('dist/offline/manifest.json'));
      await writeFile(
        'dist/sw.js',
        `// Generated from the complete v0.4.0 deployment; weights are stored separately in IndexedDB.
const FILES = ${JSON.stringify(paths)};
const ROOT = new URL('./', self.location.href);
const PREFIX = 'paper-bridge-shell-' + encodeURIComponent(ROOT.pathname) + '-';
const CACHE = PREFIX + '${revision}';
const ALLOWED = new Set(FILES.map(path => new URL(path, ROOT).href));
const RUNTIMES = new Set(${JSON.stringify(runtimePaths)}.map(path => new URL(path, ROOT).href));
const RUNTIME_PREFIX = 'paper-bridge-runtime-v1-' + encodeURIComponent(new URL('offline/', ROOT).href) + '-';
const RUNTIME_CACHE = RUNTIME_PREFIX + '${runtimeCacheVersion(manifest)}';
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Keep downloads bounded on mobile devices. A failed installation leaves the previous cache intact.
  for (let i = 0; i < FILES.length; i += 6) await cache.addAll(FILES.slice(i, i + 6).map(path => new URL(path, ROOT).href));
  // Updates wait for old tabs to close before taking over their scripts.
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) {
    if ((key.startsWith(PREFIX) && key !== CACHE) || (key.startsWith(RUNTIME_PREFIX) && key !== RUNTIME_CACHE)) await caches.delete(key);
  }
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (RUNTIMES.has(url.href)) {
    // The selected-model worker populates this cache. Do not keep its cancelled
    // network requests alive with a separate background cache write.
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      return await cache.match(url.href) || fetch(event.request);
    })());
    return;
  }
  const isHome = event.request.mode === 'navigate' && url.origin === ROOT.origin &&
    (url.pathname === ROOT.pathname || url.pathname === ROOT.pathname + 'index.html');
  if (!isHome && !ALLOWED.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = isHome ? new URL('index.html', ROOT).href : url.href;
    return await cache.match(key) || fetch(event.request);
  })());
});
`,
      );
    },
  };
}
