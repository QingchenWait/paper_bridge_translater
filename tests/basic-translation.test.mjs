import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import 'fake-indexeddb/auto';
import {
  buildBasicRequest,
  parseBasicResponse,
  basicTranslate,
  normalizeBasicTranslation,
  mergeBasicTranslation,
  basicOptions,
} from '../src/js/basic-translation.js';
import { normalizeSettings, saveSettings, saveBasicTranslation } from '../src/js/settings.js';
import { put, get, mergeSnapshot } from '../src/js/storage.js';
import { createArchive, readArchive } from '../src/js/archive.js';
const config = { keyId: 'example-key-id', secret: 'example-secret' };
const fixed = { date: new Date('2026-09-23T03:04:05.000Z'), nonce: 'fixed-nonce' };
const hash = (text) => createHash('sha256').update(text).digest('hex');
const mac = (key, text) => createHmac('sha256', key).update(text).digest();

test('basic settings upgrade without replacing LLMs and list only complete saved credentials', () => {
  const normalized = normalizeSettings({
    chatProviders: [{ id: 'existing', baseUrl: 'https://llm.test', model: 'kept', apiKey: 'kept' }],
  });
  assert.equal(normalized.chatProviders[0].apiKey, 'kept');
  assert.equal(normalized.basicTranslation.defaultProvider, 'mymemory');
  assert.deepEqual(
    basicOptions(normalized.basicTranslation).map(([id]) => id),
    ['mymemory', 'google'],
  );
  const basic = normalizeBasicTranslation({
    defaultProvider: 'baidu',
    providers: { baidu: config, aliyun: { keyId: 'id' } },
  });
  assert.equal(basic.defaultProvider, 'baidu');
  assert.deepEqual(
    basicOptions(basic).map(([id]) => id),
    ['mymemory', 'google', 'baidu'],
  );
  assert.equal(normalizeBasicTranslation({ defaultProvider: 'unknown' }).defaultProvider, 'mymemory');
});

test('Baidu uses UTF-8 MD5 and the academic domain only for academic style; language codes map correctly', async () => {
  const text = '研究 A&B + α';
  for (const style of ['学术论文', '忠实直译', '专业技术文档', '通俗易懂']) {
    const academic = style === '学术论文';
    const req = await buildBasicRequest('baidu', config, text, 'en', 'zh-CN', style, fixed);
    const url = new URL(req.url),
      params = url.searchParams;
    assert.equal(url.pathname, `/api/trans/vip/${academic ? 'fieldtranslate' : 'translate'}`);
    assert.equal(params.get('q'), text);
    assert.equal(params.get('to'), 'zh');
    assert.equal(params.get('domain'), academic ? 'academic' : null);
    assert.equal(
      params.get('sign'),
      createHash('md5')
        .update(config.keyId + text + fixed.nonce + (academic ? 'academic' : '') + config.secret, 'utf8')
        .digest('hex'),
    );
    assert.ok(!req.url.includes(config.secret));
  }
  const req = await buildBasicRequest('baidu', config, 'Hello', 'ja', 'fr', '忠实直译', fixed);
  assert.equal(new URL(req.url).searchParams.get('from'), 'jp');
  assert.equal(new URL(req.url).searchParams.get('to'), 'fra');
  await assert.rejects(buildBasicRequest('baidu', config, 'Hello', 'en', 'ja', '学术论文', fixed), /仅支持/);
});

test('Aliyun RPC signs all unencoded fields with HMAC-SHA1 and preserves punctuation and Unicode', async () => {
  const text = '中文 A&B + * ~';
  const request = await buildBasicRequest('aliyun', config, text, 'auto', 'en', '学术论文', fixed);
  const params = new URLSearchParams(request.body),
    signature = params.get('Signature');
  params.delete('Signature');
  assert.equal(request.method, 'POST');
  assert.equal(request.url, 'https://mt.cn-hangzhou.aliyuncs.com/');
  assert.equal(params.get('Action'), 'TranslateGeneral');
  assert.equal(params.get('Version'), '2018-10-12');
  assert.equal(params.get('FormatType'), 'text');
  assert.equal(params.get('Scene'), 'general');
  assert.equal(params.get('SourceText'), text);
  assert.equal(params.get('Timestamp'), '2026-09-23T03:04:05Z');
  const quote = (value) =>
    encodeURIComponent(value).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const canonical = [...params]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${quote(k)}=${quote(v)}`)
    .join('&');
  assert.equal(
    signature,
    createHmac('sha1', config.secret + '&')
      .update('POST&%2F&' + quote(canonical))
      .digest('base64'),
  );
  assert.ok(!request.body.includes(config.secret));
});

test('Volcengine signature uses the documented cn-north-1 region and matching body hash', async () => {
  const request = await buildBasicRequest(
    'volcengine',
    config,
    'Hello world',
    'auto',
    'zh-CN',
    '学术论文',
    fixed,
  );
  assert.deepEqual(JSON.parse(request.body), { TargetLanguage: 'zh', TextList: ['Hello world'] });
  assert.equal(request.headers['X-Date'], '20260923T030405Z');
  assert.equal(request.headers['X-Content-Sha256'], hash(request.body));
  assert.ok(!Object.hasOwn(request.headers, 'Host')); // Browsers supply Host themselves.
  const canonical = `POST\n/\nAction=TranslateText&Version=2020-06-01\ncontent-type:application/json\nhost:translate.volcengineapi.com\nx-content-sha256:${hash(request.body)}\nx-date:20260923T030405Z\n\ncontent-type;host;x-content-sha256;x-date\n${hash(request.body)}`;
  const key = mac(mac(mac(mac(config.secret, '20260923'), 'cn-north-1'), 'translate'), 'request');
  const signature = mac(
    key,
    `HMAC-SHA256\n20260923T030405Z\n20260923/cn-north-1/translate/request\n${hash(canonical)}`,
  ).toString('hex');
  assert.equal(
    request.headers.Authorization,
    `HMAC-SHA256 Credential=${config.keyId}/20260923/cn-north-1/translate/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${signature}`,
  );
});

test('all response types preserve multiple segments and reject API errors or empty results', () => {
  assert.equal(
    parseBasicResponse('google', [
      [
        ['第一段', 'one'],
        ['第二段', 'two'],
      ],
    ]),
    '第一段第二段',
  );
  assert.equal(parseBasicResponse('baidu', { trans_result: [{ dst: '一' }, { dst: '二' }] }), '一\n二');
  assert.equal(parseBasicResponse('aliyun', { Code: 200, Data: { Translated: '你好' } }), '你好');
  assert.equal(
    parseBasicResponse('volcengine', {
      TranslationList: [{ Translation: '你好' }],
      ResponseMetadata: { Error: null },
    }),
    '你好',
  );
  assert.throws(() => parseBasicResponse('baidu', { error_code: '54001' }), /签名/);
  assert.throws(() => parseBasicResponse('aliyun', { Code: 'InvalidAccessKeyId' }), /InvalidAccessKeyId/);
  assert.throws(
    () =>
      parseBasicResponse('volcengine', { ResponseMetadata: { Error: { Code: 'SignatureDoesNotMatch' } } }),
    /SignatureDoesNotMatch/,
  );
  for (const provider of ['google', 'baidu', 'aliyun', 'volcengine'])
    assert.throws(() => parseBasicResponse(provider, {}));
  assert.throws(() => parseBasicResponse('google', null), /无效/);
});

test('long Google input is cleaned and fully chunked; cancellation stops further requests', async () => {
  const old = globalThis.fetch,
    seen = [];
  try {
    globalThis.fetch = async (url) => {
      const query = new URL(url).searchParams;
      seen.push(query.get('q'));
      assert.equal(query.get('client'), 'gtx');
      assert.equal(query.get('dt'), 't');
      assert.ok(new TextEncoder().encode(query.get('q')).length <= 1500);
      return new Response(JSON.stringify([[[query.get('q')]]]), { status: 200 });
    };
    const text = 'trans-\nlation ' + '科学 😀 '.repeat(1200);
    const out = await basicTranslate(text, { provider: 'google' });
    assert.equal(out, 'translation ' + '科学 😀 '.repeat(1200).trimEnd());
    assert.ok(seen.length > 1);
    const controller = new AbortController();
    let count = 0;
    globalThis.fetch = async () => {
      count++;
      controller.abort();
      return new Response(JSON.stringify([[['ok']]]));
    };
    await assert.rejects(basicTranslate(text, { provider: 'google', signal: controller.signal }), {
      name: 'AbortError',
    });
    assert.equal(count, 1);
  } finally {
    globalThis.fetch = old;
  }
});

test('basic secrets are excluded from ordinary archives, recoverable when included, and never erased by secret-free imports', async () => {
  const basicTranslation = normalizeBasicTranslation({
    defaultProvider: 'baidu',
    providers: { baidu: config, aliyun: config, volcengine: config },
  });
  await put('settings', { id: 'app', value: { basicTranslation } });
  const without = await readArchive(await createArchive({ includeSecrets: false }));
  for (const p of Object.values(
    without.settings.find((s) => s.id === 'app').value.basicTranslation.providers,
  )) {
    assert.equal(p.secret, '');
    assert.equal(p.keyId, '');
  }
  await mergeSnapshot(without, { restoreSettings: true });
  assert.equal((await get('settings', 'app')).value.basicTranslation.providers.baidu.secret, config.secret);
  const withSecrets = await readArchive(await createArchive({ includeSecrets: true }));
  assert.equal(
    withSecrets.settings.find((s) => s.id === 'app').value.basicTranslation.providers.aliyun.secret,
    config.secret,
  );
  const merged = mergeBasicTranslation(basicTranslation, {
    providers: { baidu: { keyId: 'different-account', secret: '' } },
  });
  assert.deepEqual(merged.providers.baidu, { ...config, connection: null });
});

test('concurrent saves of different basic services and the default never overwrite each other', async () => {
  const old = globalThis.document;
  globalThis.document = new EventTarget();
  try {
    await saveSettings({ basicTranslation: { providers: {} } });
    await Promise.all(
      ['baidu', 'aliyun', 'volcengine'].map((id) =>
        saveBasicTranslation((basic) => ({
          ...basic,
          providers: { ...basic.providers, [id]: { ...config, keyId: id } },
        })),
      ),
    );
    await saveBasicTranslation((basic) => ({ ...basic, defaultProvider: 'volcengine' }));
    const saved = (await get('settings', 'app')).value.basicTranslation;
    for (const id of ['baidu', 'aliyun', 'volcengine']) {
      assert.equal(saved.providers[id].keyId, id);
      assert.equal(saved.providers[id].secret, config.secret);
    }
    assert.equal(saved.defaultProvider, 'volcengine');
  } finally {
    globalThis.document = old;
  }
});
