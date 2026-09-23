import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { saveSettings, saveBasicTranslation, getSettings, flushSettings } from '../src/js/settings.js';
import { get, put } from '../src/js/storage.js';
import { createArchive, readArchive } from '../src/js/archive.js';
globalThis.document = new EventTarget();

test('interleaved live LLM, basic and preference writes preserve immutable input snapshots', async () => {
  const input = {
    chatProviders: [
      {
        id: 'live',
        name: 'Live',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'captured-key',
        model: 'model',
        protocol: 'responses',
        pdfInput: true,
        pdfOutput: true,
      },
    ],
    defaultChatProviderId: 'live',
  };
  const first = saveSettings(input);
  input.chatProviders[0].apiKey = 'mutated-after-queue';
  const second = saveBasicTranslation((basic) => ({
    ...basic,
    providers: { ...basic.providers, aliyun: { keyId: 'id', secret: 'latest-secret' } },
  }));
  const third = saveSettings({ translationStyle: '通俗易懂', hideOnboarding: true });
  await Promise.all([first, second, third]);
  const saved = (await get('settings', 'app')).value;
  assert.equal(saved.chatProviders[0].apiKey, 'captured-key');
  assert.equal(saved.chatProviders[0].protocol, 'responses');
  assert.equal(saved.chatProviders[0].pdfInput, true);
  assert.equal(saved.chatProviders[0].pdfOutput, true);
  assert.equal(saved.basicTranslation.providers.aliyun.secret, 'latest-secret');
  assert.equal(saved.translationStyle, '通俗易懂');
  assert.equal(saved.hideOnboarding, true);
});

test('secret-inclusive archive waits for pending writes and round-trips every app setting and credential', async () => {
  await put('settings', {
    id: 'annotation-tools',
    value: { colors: { pen: '#334155' }, options: { penWidth: 4 } },
  });
  const a = saveSettings({
    chatProviders: [
      {
        id: 'one',
        name: 'First',
        baseUrl: 'https://one.test/v1',
        apiKey: 'first-key',
        model: 'first',
        protocol: 'responses',
        pdfInput: true,
        pdfOutput: true,
      },
      {
        id: 'two',
        name: 'Second',
        baseUrl: 'https://two.test/v1',
        apiKey: 'second-key',
        model: 'second',
        protocol: 'chat',
      },
    ],
    defaultChatProviderId: 'two',
    translationProviderId: 'one',
    targetLanguage: 'ja',
    sourceLanguage: 'en',
    webdav: {
      url: 'https://dav.test',
      username: 'archive-user',
      password: 'cloud-secret',
      path: '/reader',
      enabled: false,
      intervalMinutes: 45,
    },
  });
  const b = saveBasicTranslation((basic) => ({
    ...basic,
    defaultProvider: 'baidu',
    providers: Object.fromEntries(
      ['baidu', 'aliyun', 'volcengine'].map((id) => [id, { keyId: id + '-id', secret: id + '-secret' }]),
    ),
  }));
  // Start export immediately, without awaiting either configuration save.
  const restored = await readArchive(
    await createArchive({ includeSecrets: true, password: 'backup-test' }),
    'backup-test',
  );
  await Promise.all([a, b]);
  const value = restored.settings.find((row) => row.id === 'app').value;
  assert.deepEqual(value, (await get('settings', 'app')).value);
  assert.deepEqual(restored.settings.find((row) => row.id === 'annotation-tools').value, {
    colors: { pen: '#334155' },
    options: { penWidth: 4 },
  });
  assert.deepEqual(
    value.chatProviders.map((p) => p.apiKey),
    ['first-key', 'second-key'],
  );
  assert.equal(value.webdav.password, 'cloud-secret');
  for (const id of ['baidu', 'aliyun', 'volcengine'])
    assert.equal(value.basicTranslation.providers[id].secret, id + '-secret');
  const ordinary = await readArchive(await createArchive({ includeSecrets: false }));
  const safe = ordinary.settings.find((row) => row.id === 'app').value;
  assert.ok(safe.chatProviders.every((p) => p.apiKey === ''));
  assert.ok(Object.values(safe.basicTranslation.providers).every((p) => p.keyId === '' && p.secret === ''));
  assert.equal(safe.webdav.password, '');
  assert.equal((await getSettings()).chatProviders[1].apiKey, 'second-key');
});

test('autosaving removal of the final LLM does not recreate its legacy alias', async () => {
  await saveSettings({ chatProviders: [], defaultChatProviderId: '' });
  await saveSettings({ targetLanguage: 'zh-CN' });
  await flushSettings();
  const saved = (await get('settings', 'app')).value;
  assert.deepEqual(saved.chatProviders, []);
  assert.equal(saved.apiKey, '');
  assert.equal(saved.baseUrl, '');
});
