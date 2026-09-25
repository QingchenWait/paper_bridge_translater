// Shared by the selected-model worker and the generated service worker.
export const runtimeCachePrefix = (base) => `paper-bridge-runtime-v1-${encodeURIComponent(base)}-`;
export const runtimeCacheVersion = (manifest) => manifest.runtimes.map((file) => file.sha256).join('-');
export const runtimeCacheName = (base, manifest) => runtimeCachePrefix(base) + runtimeCacheVersion(manifest);

export async function cacheRuntimeAsset(path, blob, base, manifest) {
  if (!globalThis.caches) return;
  try {
    const cache = await caches.open(runtimeCacheName(base, manifest));
    const url = new URL(path, base).href;
    if (!(await cache.match(url)))
      await cache.put(
        url,
        new Response(blob, {
          headers: { 'Content-Type': path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' },
        }),
      );
  } catch {
    /* CacheStorage is optional in native WebViews; local assets still work. */
  }
}

export async function cacheBergamotModule(base, manifest) {
  if (!globalThis.caches) return;
  try {
    const cache = await caches.open(runtimeCacheName(base, manifest));
    const url = new URL('bergamot/bergamot-translator.mjs', base).href;
    if (await cache.match(url)) return;
    const response = await fetch(url);
    if (response.ok) await cache.put(url, response);
  } catch {
    /* The normal module import reports any actual loading failure. */
  }
}
