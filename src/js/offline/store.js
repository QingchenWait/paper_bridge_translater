import { openDB } from 'idb';
import { sha256 } from '@noble/hashes/sha2.js';
import { gunzipSync } from 'fflate';

const db = () =>
  openDB('paper-bridge-offline', 1, {
    upgrade(database) {
      database.createObjectStore('assets');
      database.createObjectStore('installed');
    },
  });
let database;
const storage = () => (database ||= db());
export const assetKey = (file) => file.sha256;
export const getAsset = async (file) => (await storage()).get('assets', assetKey(file));
export const putAsset = async (file, blob) => (await storage()).put('assets', blob, assetKey(file));
export async function validateAsset(blob, file) {
  if (blob.size !== file.bytes) throw new Error(`${file.path} 文件大小不匹配，请重新下载或导入。`);
  const digest = sha256.create();
  // Hash in bounded slices: never duplicate a 475 MB ONNX file merely to verify it.
  for (let offset = 0; offset < blob.size; offset += 4 * 1024 * 1024)
    digest.update(new Uint8Array(await blob.slice(offset, offset + 4 * 1024 * 1024).arrayBuffer()));
  const hash = Array.from(digest.digest(), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hash !== file.sha256) throw new Error(`${file.path} SHA-256 校验失败，未安装。`);
  return blob;
}
export async function unpackFile(blob, file) {
  const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (magic[0] === 31 && magic[1] === 139) {
    if (typeof DecompressionStream === 'function')
      blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob();
    else blob = new Blob([gunzipSync(new Uint8Array(await blob.arrayBuffer()))]);
  }
  return validateAsset(blob, file);
}
async function fetchBlob(url, onProgress) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(600000),
  });
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），可改用本地文件导入。`);
  const reader = response.body?.getReader();
  if (!reader) return response.blob();
  let bytes = 0,
    lastProgress = 0;
  // Response.blob can spool the stream without retaining every large network chunk in JS.
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            onProgress?.(bytes);
            controller.close();
            reader.releaseLock();
            return;
          }
          bytes += value.length;
          if (performance.now() - lastProgress > 120) {
            lastProgress = performance.now();
            onProgress?.(bytes);
          }
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          reader.releaseLock();
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    }),
  ).blob();
}
async function fetchRemoteAsset(file, onProgress) {
  const urls = [file.url, ...(file.fallbackUrls || [])].filter(Boolean);
  let lastError;
  for (const url of urls) {
    try {
      return await unpackFile(await fetchBlob(url, onProgress), file);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`${file.path} 没有可用下载源。`);
}
export async function loadAsset(file, base, { remote = false, required = false, onProgress } = {}) {
  const cached = await getAsset(file).catch((error) => {
    if (remote || required) throw error;
    return undefined;
  });
  if (cached?.size === file.bytes) return cached;
  let blob;
  if (remote) blob = await fetchRemoteAsset(file, onProgress);
  else {
    const parts = [];
    let completed = 0;
    for (const path of file.parts || [file.path]) {
      const part = await fetchBlob(new URL(path, base), (bytes) => onProgress?.(completed + bytes));
      parts.push(part);
      completed += part.size;
    }
    blob = new Blob(parts);
  }
  if (!remote) blob = await unpackFile(blob, file);
  try {
    await putAsset(file, blob);
  } catch (error) {
    // Bundled files can run from local static assets even on storage-restricted WebViews.
    if (remote || required) throw error;
  }
  return blob;
}
export async function installedModels(manifest) {
  const database = await storage(),
    result = [];
  for (const model of manifest.models) {
    const marker = await database.get('installed', model.id);
    if (marker?.revision !== model.revision) continue;
    let complete = true;
    for (const file of model.files) {
      const blob = await getAsset(file);
      if (blob?.size !== file.bytes) {
        complete = false;
        break;
      }
    }
    if (complete) result.push(model.id);
    else await database.delete('installed', model.id);
  }
  return result;
}
export async function installModel(model, manifest, base, files, progress) {
  const database = await storage();
  const total = model.files.reduce((n, f) => n + f.bytes, 0);
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => null);
  let missingBytes = 0;
  for (const file of model.files) if ((await getAsset(file))?.size !== file.bytes) missingBytes += file.bytes;
  if (estimate?.quota && estimate.quota - estimate.usage < missingBytes * 1.1)
    throw new Error('可用存储空间不足，请释放空间后重试。已有文档不会被清理。');
  let completed = 0;
  for (const asset of manifest.runtimes.filter((a) => a.engine === model.engine))
    await loadAsset(asset, base);
  for (const file of model.files) {
    progress({ phase: 'download', bytes: completed, total });
    const cached = await getAsset(file);
    if (cached?.size !== file.bytes) {
      if (files) {
        const matches = files.filter(
          (f) =>
            (f.webkitRelativePath || f.name).replace(/\.gz$/i, '').split('/').at(-1) ===
            file.path.split('/').at(-1),
        );
        if (matches.length !== 1) throw new Error(`请选择完整模型文件；缺少或重名：${file.path}`);
        await putAsset(file, await unpackFile(matches[0], file));
      } else
        await loadAsset(file, base, {
          remote: !model.bundled,
          required: true,
          onProgress: (bytes) =>
            progress({ phase: 'download', bytes: completed + Math.min(bytes, file.bytes), total }),
        });
    }
    completed += file.bytes;
  }
  // Availability is committed only after every file passes validation.
  await database.put('installed', { revision: model.revision }, model.id);
  // A browser permission prompt must not hold a completed installation open.
  globalThis.navigator?.storage?.persist?.().catch(() => false);
  progress({ phase: 'installed', bytes: total, total });
}
export async function clearModelCache(model, manifest) {
  if (model.bundled) throw new Error('预置 Lite 模型不可删除。');
  const database = await storage();
  const tx = database.transaction(['installed', 'assets'], 'readwrite');
  await tx.objectStore('installed').delete(model.id);
  for (const file of model.files) {
    if (
      !manifest.models.some(
        (other) => other.id !== model.id && other.files.some((f) => f.sha256 === file.sha256),
      )
    )
      await tx.objectStore('assets').delete(assetKey(file));
  }
  await tx.done;
}
export const removeModel = clearModelCache;
