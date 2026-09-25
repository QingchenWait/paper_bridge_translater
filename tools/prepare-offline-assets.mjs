// Reproducible, pinned browser assets. No network is needed after preparation.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const lock = JSON.parse(await readFile(new URL('../public/offline/manifest.json', import.meta.url)));
const hash = (data) => createHash('sha256').update(data).digest('hex');
export async function prepareOfflineAssets() {
  for (const asset of [...lock.runtimes, ...lock.models.filter((m) => m.bundled).flatMap((m) => m.files)]) {
    const destinations = asset.parts || [asset.path];
    try {
      const current = Buffer.concat(
        await Promise.all(destinations.map((p) => readFile(`public/offline/${p}`))),
      );
      if (current.length === asset.bytes && hash(current) === asset.sha256) continue;
    } catch {
      /* Missing assets are restored from the pinned source below. */
    }
    console.log(`Preparing offline asset: ${asset.path}`);
    let data, lastError;
    for (const url of asset.githubBlob ? [asset.githubBlob] : [asset.url, ...(asset.fallbackUrls || [])]) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
        if (!response.ok) throw new Error(`${asset.path}: HTTP ${response.status}`);
        let candidate = asset.githubBlob
          ? Buffer.from((await response.json()).content, 'base64')
          : Buffer.from(await response.arrayBuffer());
        if (asset.compression === 'gzip') candidate = gunzipSync(candidate);
        if (candidate.length !== asset.bytes || hash(candidate) !== asset.sha256)
          throw new Error(`${asset.path}: size/SHA-256 mismatch; refusing unverified model assets`);
        data = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!data) throw lastError;
    for (const [index, path] of destinations.entries()) {
      await mkdir(dirname(`public/offline/${path}`), { recursive: true });
      await writeFile(
        `public/offline/${path}`,
        asset.parts ? data.subarray(index * lock.partBytes, (index + 1) * lock.partBytes) : data,
      );
    }
  }
  // Keep the official source verbatim. ESM is strict: fix its one sloppy-global export.
  const glue = await readFile('public/offline/bergamot/bergamot-translator.js', 'utf8');
  if (!glue.includes('var global_object = this;')) throw new Error('Bergamot ESM adapter needs review');
  await writeFile(
    'public/offline/bergamot/bergamot-translator.mjs',
    `// Adapted for module Workers: global_object uses globalThis instead of sloppy this.\n${glue.replace('var global_object = this;', 'var global_object = globalThis;')}\nexport default loadBergamot;\n`,
  );
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/prepare-offline-assets.mjs'))
  await prepareOfflineAssets();
