import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { cleanPdfText, isSingleWord, splitForTranslation } from '../src/js/text.js';
import { normalizeSettings, saveSettings } from '../src/js/settings.js';
import { sseEvents, requestLlm } from '../src/js/llm.js';
import { addDocument, all, put, get, snapshot, mergeSnapshot } from '../src/js/storage.js';
import { createArchive, readArchive, importArchive, syncWebDav } from '../src/js/archive.js';
globalThis.document = new EventTarget();
test('cleans PDF line numbers and broken words without deleting years or numbered lists', () => {
  assert.equal(
    cleanPdfText(
      '005 One of the bottle-\n006 necks is inference [12]. 006\n007 Real-time results improve. 007',
    ),
    'One of the bottlenecks is inference . Real-time results improve.',
  );
  assert.equal(
    cleanPdfText('In 2026, accuracy increased by 4.7.\n1. First item\n2. Second item'),
    'In 2026, accuracy increased by 4.7. 1. First item 2. Second item',
  );
  assert.equal(cleanPdfText('classifica-\ntion'), 'classification');
  assert.equal(
    cleanPdfText('E = mc², 10⁻³\n2024 results\n2025 results\n2026 results'),
    'E = mc², 10⁻³ 2024 results 2025 results 2026 results',
  );
  assert.equal(cleanPdfText('005\nA paragraph\n006\nNext line\n007'), 'A paragraph Next line');
  assert.equal(isSingleWord('attention'), true);
  assert.equal(isSingleWord('neural network'), false);
  const input = '中文翻译🙂'.repeat(150);
  const chunks = splitForTranslation(input);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every((c) => new TextEncoder().encode(c).length <= 450));
});
test('normalizes legacy API settings and preserves all providers with unique IDs', () => {
  const legacy = normalizeSettings({ apiKey: 'key', baseUrl: 'https://example.com/v1/', model: 'model' });
  assert.equal(legacy.chatProviders[0].apiKey, 'key');
  assert.equal(legacy.baseUrl, 'https://example.com/v1');
  const multi = normalizeSettings({
    chatProviders: [
      { id: 'x', model: 'a' },
      { id: 'x', model: 'b' },
    ],
    defaultChatProviderId: 'x-2',
  });
  assert.deepEqual(
    multi.chatProviders.map((p) => p.id),
    ['x', 'x-2'],
  );
  assert.equal(multi.model, 'b');
});
test('SSE parser preserves fragmented UTF-8, split CRLF, multiple events and final tail', async () => {
  const source = 'data: {"choices":[{"delta":{"content":"译文"}}]}\r\n\r\ndata: [DONE]';
  const bytes = new TextEncoder().encode(source);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
      c.close();
    },
  });
  const events = [];
  for await (const event of sseEvents(stream)) events.push(event);
  assert.equal(JSON.parse(events[0]).choices[0].delta.content, '译文');
  assert.equal(events[1], '[DONE]');
});
test('stream disconnect is an error and preserves already received text; no max_tokens truncation', async () => {
  const original = globalThis.fetch;
  let payload;
  let text = '';
  globalThis.fetch = async (_url, options) => {
    payload = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    });
  };
  try {
    await assert.rejects(
      requestLlm({
        provider: { baseUrl: 'https://example.com/v1', model: 'test', protocol: 'chat' },
        messages: [{ role: 'user', content: 'full context' }],
        onDelta: async (_d, total) => (text = total),
      }),
      /完成标记/,
    );
    assert.equal(text, 'partial');
    assert.equal('max_tokens' in payload, false);
  } finally {
    globalThis.fetch = original;
  }
});
test('archive roundtrip, authenticated encryption, corruption protection and conflict preservation', async () => {
  const original = await addDocument(
    new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }),
    'paper.pdf',
    2,
  );
  await put('conversations', { id: 'thread-a', rootId: original.id, title: 'A', createdAt: 1 });
  await put('messages', {
    id: 'message-a',
    conversationId: 'thread-a',
    role: 'assistant',
    content: '完整历史',
    createdAt: 2,
    status: 'complete',
  });
  const archive = await createArchive({ password: 'backup-pass' });
  const restored = await readArchive(archive, 'backup-pass');
  assert.equal(restored.documents[0].name, 'paper.pdf');
  assert.equal(await restored.files[0].blob.text(), '%PDF-1.7\nfixture');
  await assert.rejects(readArchive(archive, 'wrong'), /密码不正确/);
  const before = await snapshot();
  await assert.rejects(importArchive(new Blob(['bad archive'])), /./);
  assert.deepEqual(await snapshot(), before);
  const incoming = structuredClone(restored);
  incoming.messages[0].content = '另一台设备上的版本';
  incoming.messages[0].updatedAt += 50;
  await mergeSnapshot(incoming);
  const messages = await all('messages');
  assert.equal(messages.length, 2);
  assert.equal((await get('messages', 'message-a')).content, '另一台设备上的版本');
  assert.ok(messages.some((m) => m.content === '完整历史' && m.recovered));
  await mergeSnapshot(incoming);
  assert.equal((await all('messages')).length, 2);
});
test('Responses sends the entire PDF and retrieves actual generated container file bytes', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/responses'))
      return Response.json({
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: '文件已生成',
                annotations: [
                  {
                    type: 'container_file_citation',
                    container_id: 'cntr-1',
                    file_id: 'file-1',
                    filename: 'translated.pdf',
                  },
                ],
              },
            ],
          },
        ],
      });
    return new Response('%PDF-1.7\ngenerated', { headers: { 'content-type': 'application/pdf' } });
  };
  try {
    const result = await requestLlm({
      provider: {
        baseUrl: 'https://example.com/v1',
        model: 'model',
        protocol: 'responses',
        pdfInput: true,
        pdfOutput: true,
        apiKey: 'test',
      },
      messages: [
        { role: 'system', content: 'translate all' },
        { role: 'user', content: 'translate' },
      ],
      pdf: { name: 'original.pdf', blob: new Blob(['%PDF-1.7\nall-pages']) },
      pdfOutput: true,
    });
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.input[0].content[0].type, 'input_file');
    assert.equal(atob(body.input[0].content[0].file_data.split(',')[1]), '%PDF-1.7\nall-pages');
    assert.equal(body.tools[0].type, 'code_interpreter');
    assert.equal(body.stream, false);
    assert.equal(requests[1].url, 'https://example.com/v1/containers/cntr-1/files/file-1/content');
    assert.equal(await result.pdf.text(), '%PDF-1.7\ngenerated');
  } finally {
    globalThis.fetch = original;
  }
});
test('archive without secrets retains preferences; restoring merges APIs and preserves existing keys', async () => {
  await saveSettings({
    chatProviders: [
      {
        id: 'private',
        name: 'Private',
        apiKey: 'local-key',
        baseUrl: 'https://api.example.com',
        model: 'model',
      },
    ],
    defaultChatProviderId: 'private',
    translationStyle: '通俗易懂',
    webdav: { url: 'https://dav.test', username: 'user', password: 'password' },
  });
  const archive = await createArchive({ includeSecrets: false });
  const data = await readArchive(archive);
  const settings = data.settings.find((r) => r.id === 'app').value;
  assert.equal(settings.translationStyle, '通俗易懂');
  assert.equal(settings.apiKey, '');
  assert.equal(settings.chatProviders[0].apiKey, '');
  assert.equal(settings.webdav.password, '');
  await mergeSnapshot(data, { restoreSettings: true });
  assert.equal((await get('settings', 'app')).value.chatProviders[0].apiKey, 'local-key');
});
test('WebDAV refuses missing ETag and concurrent 412 writes without losing local records', async () => {
  const original = globalThis.fetch;
  await saveSettings({
    webdav: {
      url: 'https://dav.test',
      path: '/paper-bridge',
      username: 'user',
      password: 'pass',
      enabled: false,
    },
  });
  const remote = await createArchive({ includeSecrets: false });
  let writes = 0;
  globalThis.fetch = async () => new Response(remote, { status: 200 });
  try {
    await assert.rejects(syncWebDav(), /ETag/);
    globalThis.fetch = async (_url, options) => {
      if (!options.method) return new Response(remote, { headers: { ETag: '"revision-1"' } });
      if (options.method === 'PUT') {
        writes++;
        assert.equal(options.headers['If-Match'], '"revision-1"');
        return new Response(null, { status: 412 });
      }
      throw new Error('Unexpected method');
    };
    const before = (await all('messages')).map((m) => m.content);
    await assert.rejects(syncWebDav(), /另一台设备/);
    assert.equal(writes, 1);
    assert.deepEqual(
      (await all('messages')).map((m) => m.content),
      before,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('PDF gateway field compatibility retries only the reported 400 schema error and preserves bytes', async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return bodies.length === 1
      ? Response.json(
          { error: { message: '.messages[1]: file must have a file_id or file_data' } },
          { status: 400 },
        )
      : Response.json({ choices: [{ message: { content: '完整译文' }, finish_reason: 'stop' }] });
  };
  try {
    const result = await requestLlm({
      provider: { baseUrl: 'https://gateway.test/v1', model: 'vision', protocol: 'chat', pdfInput: true },
      messages: [
        { role: 'system', content: 'translate' },
        { role: 'user', content: 'all pages' },
      ],
      pdf: { name: 'all.pdf', blob: new Blob(['%PDF-1.7\nall pages']) },
    });
    assert.equal(result.text, '完整译文');
    assert.equal(bodies.length, 2);
    const first = bodies[0].messages[1].content[0];
    const second = bodies[1].messages[1].content[0];
    assert.equal(first.file.file_data, second.file_data);
    assert.equal(second.filename, 'all.pdf');
    assert.equal(bodies[1].messages[1].content[1].text, 'all pages');
    bodies.length = 0;
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return Response.json({ error: { message: 'model unsupported' } }, { status: 400 });
    };
    await assert.rejects(
      requestLlm({
        provider: { baseUrl: 'https://gateway.test/v1', model: 'text', protocol: 'chat', pdfInput: true },
        messages: [{ role: 'user', content: 'read' }],
        pdf: { name: 'file.pdf', blob: new Blob(['%PDF-1.7']) },
      }),
      /model unsupported/,
    );
    assert.equal(bodies.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
