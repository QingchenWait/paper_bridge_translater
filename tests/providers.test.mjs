import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, providerKeyUrl, openProviderWebsite } from '../src/js/providers.js';
import { normalizeSettings } from '../src/js/settings.js';

test('provider templates use the requested values without changing saved configurations', () => {
  assert.deepEqual(
    PROVIDERS.map((p) => [p.name, p.baseUrl, p.model]),
    [
      ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-v4-flash'],
      ['MiMO', 'https://api.xiaomimimo.com/v1', 'mimo-v2.6-flash'],
      ['Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-flash'],
      ['OpenAI', 'https://api.openai.com/v1', 'gpt-5.6-luna'],
      ['GLM', 'https://open.bigmodel.cn/api/paas/v4', 'glm-5.3-flash'],
      ['Kimi', 'https://api.moonshot.cn/v1', 'kimi-k3'],
      ['LM Studio', 'https://localhost:1234/v1', ''],
      ['自定义', '', ''],
    ],
  );
  const previous = {
    id: 'existing',
    name: 'My API',
    baseUrl: 'https://custom.test/v1',
    model: 'kept-model',
    apiKey: 'kept-key',
  };
  const normalized = normalizeSettings({ onboardingDone: true, chatProviders: [previous] });
  for (const [key, value] of Object.entries(previous)) assert.equal(normalized.chatProviders[0][key], value);
  assert.equal(normalized.hideOnboarding, false);
  assert.equal(normalizeSettings({ hideOnboarding: true }).hideOnboarding, true);
});

test('key links only map recognized hosts to fixed official pages', () => {
  for (const preset of PROVIDERS) assert.equal(providerKeyUrl(preset.baseUrl), preset.keyUrl || null);
  assert.equal(
    providerKeyUrl(' https://API.DEEPSEEK.COM/v1/?key=private '),
    'https://platform.deepseek.com/api_keys',
  );
  for (const url of [
    '',
    'invalid',
    'javascript:alert(1)',
    'https://api.openai.com.evil.test/v1',
    'https://api.openai.com@evil.test',
    'https://user:secret@api.openai.com',
    'https://api.openai.com:1234/v1',
    'https://unknown.test',
  ])
    assert.equal(providerKeyUrl(url), null);
});

test('key links open a new browser tab or use the native default-browser opener', async () => {
  const original = globalThis.window;
  const calls = [];
  try {
    globalThis.window = { open: (...args) => calls.push(args) };
    await openProviderWebsite(PROVIDERS[0].baseUrl);
    assert.deepEqual(calls.pop(), [PROVIDERS[0].keyUrl, '_blank', 'noopener,noreferrer']);
    window.__TAURI_INTERNALS__ = { invoke: async (...args) => calls.push(args) };
    await openProviderWebsite(PROVIDERS[1].baseUrl);
    assert.deepEqual(calls.pop(), ['plugin:opener|open_url', { url: PROVIDERS[1].keyUrl }]);
    delete window.__TAURI_INTERNALS__;
    window.__TAURI__ = { shell: { open: async (...args) => calls.push(args) } };
    await openProviderWebsite(PROVIDERS[2].baseUrl);
    assert.deepEqual(calls.pop(), [PROVIDERS[2].keyUrl]);
    window.__TAURI__.opener = { openUrl: async (...args) => calls.push(args) };
    await openProviderWebsite(PROVIDERS[3].baseUrl);
    assert.deepEqual(calls.pop(), [PROVIDERS[3].keyUrl]);
    await openProviderWebsite('https://localhost:1234/v1');
    assert.equal(calls.length, 0);
  } finally {
    globalThis.window = original;
  }
});
