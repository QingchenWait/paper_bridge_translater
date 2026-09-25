import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { openDB } from 'idb';
import { offlineOptions, setOfflineInstalled, validateDirection } from '../src/js/offline/catalog.js';
import { normalizeBasicTranslation } from '../src/js/basic-translation.js';
import {
  unpackFile,
  putAsset,
  getAsset,
  installModel,
  installedModels,
  removeModel,
  clearModelCache,
  loadAsset,
} from '../src/js/offline/store.js';

const data = Buffer.from('verified model fixture');
const file = {
  path: 'model.onnx',
  bytes: data.length,
  sha256: createHash('sha256').update(data).digest('hex'),
};
const model = { id: 'fixture', revision: 'pinned', files: [file], engine: 'onnx' };
const manifest = { models: [model], runtimes: [] };

test('offline choices include only installed models without resetting saved offline defaults on startup', () => {
  setOfflineInstalled([]);
  assert.deepEqual(
    offlineOptions().map(([id]) => id),
    ['offline-lite'],
  );
  assert.equal(
    normalizeBasicTranslation({ defaultProvider: 'offline-plus' }).defaultProvider,
    'offline-plus',
  );
  setOfflineInstalled(['offline-plus', 'unknown']);
  assert.deepEqual(
    offlineOptions().map(([id]) => id),
    ['offline-lite', 'offline-plus'],
  );
  setOfflineInstalled([]);
});

test('model directions reject unsupported pairs rather than silently translating into the wrong language', () => {
  assert.doesNotThrow(() => validateDirection('offline-lite', 'en', 'zh-CN'));
  assert.throws(() => validateDirection('offline-plus', 'zh-CN', 'en'), /仅支持/);
  assert.throws(() => validateDirection('offline-lite', 'en', 'zh-TW'), /仅支持/);
  assert.doesNotThrow(() => validateDirection('offline-pro', 'fr', 'zh-CN'));
  assert.throws(() => validateDirection('offline-pro', 'auto', 'zh-CN'), /不支持自动/);
});

test('gzip imports become ready binary assets and corrupt or wrong files never pass validation', async () => {
  assert.equal(await (await unpackFile(new Blob([gzipSync(data)]), file)).text(), data.toString());
  await assert.rejects(unpackFile(new Blob(['bad']), file), /大小不匹配/);
  await assert.rejects(unpackFile(new Blob([Buffer.alloc(data.length)]), file), /SHA-256/);
});

test('install commits atomically, validates files, detects missing storage, and delete protects preset and personal data', async () => {
  const personal = await openDB('paper-bridge-offline-test-personal', 1, {
    upgrade(db) {
      db.createObjectStore('documents');
    },
  });
  await personal.put('documents', { text: 'kept' }, 'paper');
  await assert.rejects(
    installModel(model, manifest, 'https://local.test/offline/', [], () => {}),
    /缺少/,
  );
  assert.deepEqual(await installedModels(manifest), []);
  const upload = new File([gzipSync(data)], 'model.onnx.gz');
  await installModel(model, manifest, 'https://local.test/offline/', [upload], () => {});
  assert.deepEqual(await installedModels(manifest), ['fixture']);
  assert.equal(await (await getAsset(file)).text(), data.toString());
  await assert.rejects(removeModel({ ...model, bundled: true }, manifest), /不可删除/);
  await removeModel(model, manifest);
  assert.deepEqual(await installedModels(manifest), []);
  assert.equal(await getAsset(file), undefined);
  assert.deepEqual(await personal.get('documents', 'paper'), { text: 'kept' });
  await putAsset(file, new Blob(['truncated']));
  assert.deepEqual(await installedModels(manifest), []);
  const other = {
    path: 'other.bin',
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex') + '0',
  };
  await putAsset(other, new Blob([data]));
  await clearModelCache(model, manifest);
  assert.equal((await getAsset(other)).size, data.length);
  personal.close();
});

test('all bundled assets match pinned hashes and fit static host single-file limits', async () => {
  const registry = JSON.parse(await readFile('public/offline/manifest.json'));
  for (const asset of [
    ...registry.runtimes,
    ...registry.models.filter((m) => m.bundled).flatMap((m) => m.files),
  ]) {
    const parts = await Promise.all(
      (asset.parts || [asset.path]).map((p) => readFile(`public/offline/${p}`)),
    );
    assert.ok(
      parts.every((p) => p.length < 25 * 1024 * 1024),
      asset.path,
    );
    const bytes = Buffer.concat(parts);
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.path);
  }
  assert.ok(
    !registry.models
      .filter((m) => !m.bundled)
      .some((m) => m.files.some((f) => !f.sha256 || f.url.includes('/main/'))),
  );
});

test('mirror failures and corrupt downloads try only pinned alternatives before committing bytes', async (t) => {
  const bytes = Buffer.from('mirror fallback fixture');
  const asset = {
    path: 'fallback.bin',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: 'https://mirror.test/bad.gz',
    fallbackUrls: ['https://origin.test/model.gz'],
  };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(String(url));
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    return new Response(String(url).includes('mirror') ? new Uint8Array(bytes.length) : gzipSync(bytes));
  });
  const blob = await loadAsset(asset, 'https://local.test/', { remote: true });
  assert.equal(await blob.text(), bytes.toString());
  assert.deepEqual(calls, [asset.url, ...asset.fallbackUrls]);
  assert.equal(await (await getAsset(asset)).text(), bytes.toString());
});

test('cancel cleanup removes only target model hashes, retaining shared vocabulary and personal stores', async () => {
  const fixture = (name) => ({
    path: name,
    bytes: name.length,
    sha256: createHash('sha256').update(name).digest('hex'),
  });
  const owned = fixture('plus weight'),
    shared = fixture('shared vocabulary'),
    unrelated = fixture('unrelated model');
  const lite = { id: 'offline-lite', bundled: true, files: [shared] };
  const plus = { id: 'offline-plus', files: [owned, shared] };
  for (const asset of [owned, shared, unrelated]) await putAsset(asset, new Blob([asset.path]));
  const personal = await openDB('paper-bridge-offline-cancel-personal', 1, {
    upgrade(db) {
      for (const store of ['documents', 'files', 'annotations', 'messages', 'settings'])
        db.createObjectStore(store);
    },
  });
  for (const store of personal.objectStoreNames)
    await personal.put(store, { value: `kept-${store}` }, 'sentinel');
  await clearModelCache(plus, { models: [lite, plus], runtimes: [] });
  assert.equal(await getAsset(owned), undefined);
  for (const asset of [shared, unrelated]) assert.equal(await (await getAsset(asset)).text(), asset.path);
  for (const store of personal.objectStoreNames)
    assert.deepEqual(await personal.get(store, 'sentinel'), { value: `kept-${store}` });
  personal.close();
});

test('ModelScope sources preserve existing OPUS/NLLB identities without bundling optional weights', async () => {
  const registry = JSON.parse(await readFile('public/offline/manifest.json'));
  const plus = registry.models.find((m) => m.id === 'offline-plus'),
    pro = registry.models.find((m) => m.id === 'offline-pro');
  assert.equal(plus.engine, 'onnx');
  assert.equal(plus.repository, 'Xenova/opus-mt-en-zh');
  assert.equal(plus.revision, '046f55aec303cdee3e0318604406d4df20f1e8ea');
  assert.equal(plus.files.length, 6);
  assert.equal(pro.revision, '261c31d1a5732c67cdd16d80e8d6088507c7ccea');
  for (const model of [plus, pro]) {
    assert.equal(model.bundled, false);
    assert.ok(
      model.files.every(
        (file) => !file.local && new URL(file.url).hostname === 'modelscope.cn' && !file.fallbackUrls,
      ),
    );
  }
  const directories = await readdir('public/offline');
  assert.ok(!directories.includes('plus') && !directories.includes('pro'));
  assert.ok(
    registry.models
      .filter((m) => m.engine === 'bergamot')
      .every((m) => m.files.every((f) => new URL(f.url).hostname === 'hf-mirror.com')),
  );
});
