import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
async function fixture(name = 'Research Paper.pdf') {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  for (let n = 1; n <= 3; n++) {
    const p = pdf.addPage([612, 792]);
    p.drawText(n === 1 ? 'Attention Is All You Need' : `Research findings - page ${n}`, {
      x: 62,
      y: 715,
      size: 23,
      font: bold,
    });
    p.drawText('Paper Bridge reading and annotation test', { x: 130, y: 672, size: 12, font });
    p.drawText('Abstract', { x: 265, y: 616, size: 15, font: bold });
    const lines = [
      'We present the Transformer, a model architecture relying solely on attention.',
      'The model supports parallel computation and improves translation quality.',
      'Our method achieves strong results on two machine translation tasks.',
      'This document tests reliable PDF selection, annotation, and conversation.',
    ];
    lines.forEach((line, i) =>
      p.drawText(line, { x: 54, y: 582 - i * 22, size: 11, font, color: rgb(0.15, 0.15, 0.2) }),
    );
    p.drawText('1   Introduction', { x: 54, y: 442, size: 16, font: bold });
    lines
      .concat(lines, lines)
      .forEach((line, i) => p.drawText(line, { x: 54, y: 405 - i * 22, size: 11, font }));
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function setup(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '先使用在线翻译' }).click();
}
async function importPdf(page, name) {
  await page.locator('#pdf-input').setInputFiles(await fixture(name));
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeVisible();
}
async function selectText(page, text) {
  await expect(
    page.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: text }).first(),
  ).toBeVisible();
  await page.evaluate((value) => {
    const span = [...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')].find((s) =>
      s.textContent.includes(value),
    );
    if (!span) throw new Error('Missing PDF text ' + value);
    const range = document.createRange();
    const start = span.textContent.indexOf(value);
    range.setStart(span.firstChild, start);
    range.setEnd(span.firstChild, start + value.length);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document
      .getElementById('pdf-scroll')
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  }, text);
}
async function configure(page) {
  await page.evaluate(async () => {
    const { saveSettings } = await import('/src/js/settings.js');
    await saveSettings({
      chatProviders: [
        {
          id: 'test',
          name: 'Test API',
          baseUrl: 'https://llm.test/v1',
          model: 'test-model',
          protocol: 'chat',
          pdfInput: false,
        },
      ],
      defaultChatProviderId: 'test',
    });
  });
}
test('desktop imports, renders, annotates and restores PDFs after reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  await page.screenshot({ path: 'test-results/desktop-empty.png', animations: 'disabled' });
  await importPdf(page);
  await expect(page.locator('.document-tab')).toHaveCount(1);
  await expect(page.locator('#page-input')).toHaveValue('1');
  await selectText(page, 'parallel computation');
  await page.getByRole('button', { name: '文字高亮', exact: true }).click();
  await expect(page.locator('.mark-highlight')).toHaveCount(1);
  await expect(page.locator('.mark-highlight')).toHaveCSS('background-color', 'rgb(255, 224, 130)');
  const highlight = await page.locator('.mark-highlight').boundingBox();
  expect(highlight.width).toBeGreaterThan(30);
  expect(highlight.height).toBeGreaterThan(5);
  expect(highlight.height).toBeLessThan(40);
  await expect(page.getByRole('button', { name: '文字高亮', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  await page.locator('.pdf-page[data-page="1"] .ink-layer').click({ position: { x: 200, y: 130 } });
  await page.locator('#input-form textarea').fill('中文批注：核心方法');
  await page.locator('#input-form button[type=submit]').click();
  await expect(page.locator('.annotation-text')).toContainText('中文批注');
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  await page.screenshot({ path: 'test-results/desktop-reading.png', animations: 'disabled' });
  await page.reload();
  await expect(page.locator('.annotation-text')).toContainText('中文批注');
  await expect(page.locator('.mark-highlight')).toHaveCount(1);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('#page-input')).toHaveValue('2');
  await page.locator('[data-action="library"]').first().click();
  await expect(page.locator('.library-card')).toHaveCount(1);
  expect(errors).toEqual([]);
});
test('dictionary never calls LLM; sentence translation renders online response', async ({ page }) => {
  await setup(page);
  await importPdf(page);
  let llmCalls = 0;
  await page.route('https://llm.test/**', (route) => {
    llmCalls++;
    return route.abort();
  });
  await page.route('https://api.dictionaryapi.dev/**', (route) =>
    route.fulfill({
      json: [
        {
          word: 'attention',
          phonetic: '/əˈtenʃən/',
          phonetics: [],
          meanings: [
            {
              partOfSpeech: 'noun',
              definitions: [{ definition: 'The act of focusing the mind.', example: 'Pay attention.' }],
              synonyms: ['focus'],
            },
          ],
        },
      ],
    }),
  );
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '注意力；关注' } } }),
  );
  await page.route('https://en.wiktionary.org/**', (route) =>
    route.fulfill({
      json: {
        parse: {
          text: { '*': '<span class="headword-line"><b lang="en">attention</b> (plural attentions)</span>' },
        },
      },
    }),
  );
  await selectText(page, 'attention');
  await expect(page.locator('.dictionary-heading')).toContainText('attention');
  await expect(page.locator('.chinese-meaning')).toContainText('注意力');
  expect(llmCalls).toBe(0);
  await selectText(page, 'parallel computation');
  await expect(page.locator('#selection-result')).toContainText('注意力');
});
test('chat histories include every turn, remain isolated and survive reload; translated PDFs share roots', async ({
  page,
}) => {
  await setup(page);
  await importPdf(page, 'Original.pdf');
  await configure(page);
  const requests = [];
  await page.route('https://llm.test/v1/chat/completions', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'data: {"choices":[{"delta":{"content":"## 研究结论\\n这是回答。 $E=mc^2$"}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await page.locator('[data-assistant-tab="chat"]').click();
  await page.locator('#chat-input').fill('第一个问题');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.chat-message.assistant .message-body')).toContainText('研究结论');
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  await page.locator('#chat-input').fill('继续说明');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.chat-message.assistant')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
  expect(requests[1].messages.some((m) => m.content === '第一个问题')).toBe(true);
  expect(requests[1].messages.some((m) => m.role === 'assistant' && m.content.includes('研究结论'))).toBe(
    true,
  );
  await page.getByRole('button', { name: '新建独立对话' }).click();
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await page.locator('[data-select="chat-thread"] .select-trigger').click();
  await page.getByRole('option', { name: '第一个问题', exact: true }).click();
  await expect(page.locator('.chat-message')).toHaveCount(4);
  const originalId = await page.evaluate(async () => {
    const { all } = await import('/src/js/storage.js');
    return (await all('documents'))[0].id;
  });
  await importPdf(page, 'Unrelated.pdf');
  await page.locator('[data-assistant-tab="chat"]').click();
  await expect(page.locator('.chat-message')).toHaveCount(0);
  await page.evaluate(async (id) => {
    const { all, patch } = await import('/src/js/storage.js');
    const doc = (await all('documents')).find((d) => d.id !== id);
    await patch('documents', doc.id, { rootId: id });
  }, originalId);
  await page.reload();
  await page.locator('[data-assistant-tab="chat"]').click();
  await page.locator('[data-select="chat-thread"] .select-trigger').click();
  await page.getByRole('option', { name: '第一个问题', exact: true }).click();
  await expect(page.locator('.chat-message')).toHaveCount(4);
});
test('full translation renders math, table and sanitized styles and exports a real PDF', async ({ page }) => {
  await setup(page);
  await importPdf(page);
  await configure(page);
  const markdown =
    '# 全文译文\n\n## 摘要\n\n公式 $E=mc^2$。\n\n$$\\sum_{i=1}^n i$$\n\n| 方法 | 得分 |\n| --- | --- |\n| Transformer | 99 |\n\n```python\nprint("论文")\n```\n\n<span style="color: red" onclick="alert(1)">红色文本</span>';
  await page.route('https://llm.test/v1/chat/completions', (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: markdown } }] })}\n\ndata: [DONE]\n\n`,
    }),
  );
  await page.locator('[data-assistant-tab="full"]').click();
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.locator('#full-result h1')).toHaveText('全文译文');
  await expect(page.locator('#full-stage')).toHaveCount(0);
  await expect(page.locator('#full-result table')).toHaveCount(1);
  await expect(page.locator('#full-result .katex')).toHaveCount(2);
  await expect(page.locator('#full-result [onclick]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/desktop-full-translation.png', animations: 'disabled' });
  await page.getByRole('button', { name: '在左侧打开译文 PDF' }).click();
  await expect(page.locator('.document-tab')).toHaveCount(2, { timeout: 45000 });
  await expect(page.locator('.document-tab.active')).toContainText('译文.pdf');
  const roots = await page.evaluate(async () => {
    const { all } = await import('/src/js/storage.js');
    return (await all('documents')).map((d) => d.rootId);
  });
  expect(new Set(roots).size).toBe(1);
});
test('portrait layout separates library, reader and AI; settings stay within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await importPdf(page);
  await expect(page.locator('.reader-panel')).toBeVisible();
  await expect(page.locator('.assistant-panel')).toBeHidden();
  await page.locator('[data-mobile-pane="assistant"]').click();
  await expect(page.locator('.reader-panel')).toBeHidden();
  await expect(page.locator('.assistant-panel')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-translation.png', animations: 'disabled' });
  await page.locator('.mobile-nav [data-action="library"]').click();
  await expect(page.locator('#library-view')).toBeVisible();
  await expect(page.locator('#workspace')).toBeHidden();
  await page.locator('[data-mobile-pane="reader"]').click();
  await expect(page.locator('.reader-panel')).toBeVisible();
  await page.locator('.mobile-nav [data-action="settings"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-settings.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('Chinese annotation export is a readable PDF; ink erase and undo persist correctly', async ({
  page,
}) => {
  await setup(page);
  await importPdf(page);
  await page.getByRole('button', { name: '手绘笔迹', exact: true }).click();
  const ink = page.locator('.pdf-page[data-page="1"] .ink-layer');
  const box = await ink.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { all } = await import('/src/js/storage.js');
        return (await all('annotations')).filter((a) => a.type === 'pen' && !a.deleted).length;
      }),
    )
    .toBe(1);
  await page.getByRole('button', { name: '手绘橡皮擦', exact: true }).click();
  await ink.click({ position: { x: 150, y: 125 } });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { all } = await import('/src/js/storage.js');
        return (await all('annotations')).filter((a) => a.type === 'pen' && !a.deleted).length;
      }),
    )
    .toBe(0);
  await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  await ink.click({ position: { x: 100, y: 200 } });
  await page.locator('#input-form textarea').fill('中文导出测试');
  await page.locator('#input-form button[type=submit]').click();
  const result = await page.evaluate(async () => {
    const { all, get } = await import('/src/js/storage.js');
    const { loadPdf, extractPdfText } = await import('/src/js/pdf.js');
    const { exportAnnotatedPdf } = await import('/src/js/pdf-export.js');
    const doc = (await all('documents'))[0];
    const file = await get('files', doc.id);
    const annotations = await all('annotations');
    const source = await loadPdf(file.blob);
    const blob = await exportAnnotatedPdf(file.blob, annotations, source);
    await source.destroy();
    const rendered = await loadPdf(blob);
    const text = await extractPdfText(rendered);
    await rendered.destroy();
    return {
      size: blob.size,
      text,
      activeInk: annotations.filter((a) => a.type === 'pen' && !a.deleted).length,
    };
  });
  expect(result.size).toBeGreaterThan(2000);
  expect(result.text).toContain('中文导出测试');
  expect(result.activeInk).toBe(1);
});
test('responsive layouts and floating controls fit common screen sizes and browser zoom equivalents', async ({
  page,
}) => {
  await setup(page);
  for (const [width, height] of [
    [320, 640],
    [390, 844],
    [768, 1024],
    [1024, 768],
    [1280, 720],
    [1536, 864],
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    const action =
      width <= 960
        ? page.locator('.mobile-nav [data-action="settings"]')
        : page.locator('.sidebar [data-action="settings"]');
    await action.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.height).toBeLessThanOrEqual(height);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
});
test('encrypted archive restores documents, annotations and full conversations into a fresh browser', async ({
  page,
  browser,
}) => {
  await setup(page);
  await importPdf(page);
  const archive = await page.evaluate(async () => {
    const { all, put } = await import('/src/js/storage.js');
    const { createArchive } = await import('/src/js/archive.js');
    const { bytesToBase64 } = await import('/src/js/utils.js');
    const doc = (await all('documents'))[0];
    await put('conversations', { id: 'backup-thread', rootId: doc.rootId, title: '备份会话', createdAt: 1 });
    await put('messages', {
      id: 'backup-message',
      conversationId: 'backup-thread',
      role: 'assistant',
      content: '不会丢失的对话内容',
      status: 'complete',
      createdAt: 2,
    });
    const blob = await createArchive({ password: 'restore-pass' });
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  });
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto('http://127.0.0.1:5173');
  await other.getByRole('button', { name: '先使用在线翻译' }).click();
  const restored = await other.evaluate(async (data) => {
    const { importArchive } = await import('/src/js/archive.js');
    const { all } = await import('/src/js/storage.js');
    await importArchive(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))]), {
      password: 'restore-pass',
      restoreSettings: true,
    });
    return { docs: (await all('documents')).length, message: (await all('messages'))[0].content };
  }, archive);
  expect(restored.docs).toBe(1);
  expect(restored.message).toBe('不会丢失的对话内容');
  await other.reload();
  await expect(other.locator('.document-tab')).toHaveCount(1);
  await context.close();
});
test('selection-first actions toggle independently and remove only the selected part', async ({ page }) => {
  await setup(page);
  await importPdf(page);
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '选择测试' } } }),
  );
  const highlight = page.getByRole('button', { name: '文字高亮', exact: true });
  const underline = page.getByRole('button', { name: '文字下划线', exact: true });
  const note = page.getByRole('button', { name: '批注', exact: true });
  for (const btn of [highlight, underline, note]) {
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.mark')).toHaveCount(0);
  await selectText(page, 'parallel computation');
  await highlight.click();
  await expect(highlight).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, 'parallel computation');
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');
  await underline.click();
  await expect(underline).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, 'parallel computation');
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await note.click();
  await page.locator('#input-form textarea').fill('绑定文本的批注');
  await page.locator('#input-form button[type=submit]').click();
  await expect(note).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, 'parallel computation');
  await expect(note).toHaveAttribute('aria-pressed', 'true');
  await expect(highlight).toHaveAttribute('aria-pressed', 'true');
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await highlight.click();
  await expect(page.locator('.mark-highlight')).toHaveCount(0);
  await expect(page.locator('.mark-underline')).toHaveCount(1);
  await expect(page.locator('.annotation-note')).toHaveCount(1);
  await selectText(page, 'parallel computation');
  await note.click();
  await expect(page.locator('.annotation-note')).toHaveCount(0);
  await selectText(page, 'computation');
  await underline.click();
  await expect(page.locator('.mark-underline')).toHaveCount(1);
  await selectText(page, 'computation');
  await expect(underline).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, 'parallel');
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
  await page.reload();
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeVisible();
  await selectText(page, 'computation');
  await expect(underline).toHaveAttribute('aria-pressed', 'true');
});
test('dictionary fallback displays definitions when the primary times out without using an LLM', async ({
  page,
}) => {
  await setup(page);
  await importPdf(page);
  let llm = 0;
  await page.route('https://api.dictionaryapi.dev/**', () => {});
  await page.route('https://en.wiktionary.org/api/rest_v1/**', (route) =>
    route.fulfill({
      json: {
        en: [
          {
            partOfSpeech: 'Noun',
            definitions: [{ definition: '<b>Mental focus</b>.', examples: ['Pay attention.'] }],
          },
        ],
      },
    }),
  );
  await page.route('https://en.wiktionary.org/w/api.php*', (route) =>
    route.fulfill({
      json: {
        parse: {
          text: { '*': '<span class="headword-line"><b lang="en">attention</b> (plural attentions)</span>' },
        },
      },
    }),
  );
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '注意力' } } }),
  );
  await page.route('https://llm.test/**', (route) => {
    llm++;
    return route.abort();
  });
  await selectText(page, 'attention');
  await expect(page.locator('.word-meaning')).toContainText('Mental focus');
  await expect(page.locator('.chinese-meaning')).toHaveText('注意力');
  await expect(page.locator('.error-card')).toHaveCount(0);
  expect(llm).toBe(0);
});
test('one PDF save request writes once even when the button is activated twice', async ({ page }) => {
  await setup(page);
  await importPdf(page);
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.evaluate(() => {
    window.saved = { pickers: 0, writes: 0, closes: 0, header: '' };
    window.showSaveFilePicker = async () => {
      saved.pickers++;
      await new Promise((r) => setTimeout(r, 150));
      return {
        createWritable: async () => ({
          write: async (blob) => {
            saved.writes++;
            saved.header = await blob.slice(0, 5).text();
          },
          close: async () => {
            saved.closes++;
          },
        }),
      };
    };
    const btn = document.querySelector('[data-action="download-pdf"]');
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.saved.closes)).toBe(1);
  expect(await page.evaluate(() => window.saved)).toEqual({
    pickers: 1,
    writes: 1,
    closes: 1,
    header: '%PDF-',
  });
  expect(downloads).toBe(0);
});
test('sub-100 percent zoom uses supersampled canvases and single-line tabs stay compact', async ({
  page,
}) => {
  await setup(page);
  await importPdf(page);
  for (const zoom of ['50%', '75%', '100%']) {
    await page.getByRole('button', { name: '缩放比例' }).click();
    await page.getByRole('option', { name: zoom, exact: true }).click();
    await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeVisible();
    const size = await page.locator('.pdf-page[data-page="1"] .page-canvas').evaluate((canvas) => ({
      pixels: canvas.width * canvas.height,
      width: canvas.width,
      css: canvas.getBoundingClientRect().width,
    }));
    expect(size.width).toBeGreaterThanOrEqual(918);
    expect(size.width / size.css).toBeGreaterThanOrEqual(1.99);
    expect(size.pixels).toBeLessThan(6010000);
  }
  await expect(page.locator('.tab-caption small')).toHaveCount(0);
  const tab = await page.locator('.document-tab').boundingBox();
  expect(tab.height).toBeLessThan(45);
});
test('translation popover anchors below its button and uses the selected API', async ({ page }) => {
  await setup(page);
  await importPdf(page);
  await configure(page);
  await page.evaluate(async () => {
    const { saveSettings, getSettings } = await import('/src/js/settings.js');
    const s = await getSettings();
    await saveSettings({
      chatProviders: [
        ...s.chatProviders,
        { id: 'second', name: 'Second API', baseUrl: 'https://second.test/v1', model: 'second-model' },
      ],
    });
  });
  let used = '';
  await page.route('https://second.test/v1/chat/completions', (route) => {
    used = route.request().postDataJSON().model;
    return route.fulfill({
      json: { choices: [{ message: { content: '使用第二个 API 的译文' }, finish_reason: 'stop' }] },
    });
  });
  const anchor = page.getByRole('button', { name: '翻译设置', exact: true });
  await anchor.click();
  const box = await anchor.boundingBox();
  await expect
    .poll(async () =>
      Math.abs((await page.locator('.translation-popover').boundingBox()).y - box.y - box.height - 8),
    )
    .toBeLessThan(0.5);
  const popup = await page.locator('.translation-popover').boundingBox();
  expect(popup.width).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await page.getByRole('option', { name: 'Second API · second-model', exact: true }).click();
  await page.locator('[data-action="save-translation"]').click();
  await selectText(page, 'parallel computation');
  await expect(page.locator('#selection-result')).toContainText('第二个 API');
  expect(used).toBe('second-model');
});
test('full translation collapses at the first streamed text and keeps its status bar sticky', async ({
  page,
}) => {
  await setup(page);
  await importPdf(page);
  await configure(page);
  await page.evaluate(() => {
    const original = window.fetch;
    window.fetch = (url, options) => {
      if (String(url) !== 'https://llm.test/v1/chat/completions') return original(url, options);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const encode = new TextEncoder();
              controller.enqueue(
                encode.encode(
                  `data: ${JSON.stringify({ choices: [{ delta: { content: '# 流式译文\n\n' + '这是正文段落。\n\n'.repeat(100) } }] })}\n\n`,
                ),
              );
              setTimeout(() => {
                controller.enqueue(encode.encode('data: [DONE]\n\n'));
                controller.close();
              }, 2500);
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
      );
    };
  });
  await page.locator('[data-assistant-tab="full"]').click();
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.locator('#full-controls')).toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-full-stage]')).toHaveText('结果转换中');
  await expect(page.locator('#full-result h1')).toHaveText('流式译文');
  await expect.poll(async () => (await page.locator('#full-controls').boundingBox()).height).toBeLessThan(1);
  await page.locator('#assistant-content').evaluate((el) => (el.scrollTop = 600));
  const bar = await page.locator('.full-summary').boundingBox(),
    area = await page.locator('#assistant-content').boundingBox();
  expect(Math.abs(bar.y - area.y)).toBeLessThan(3);
  await page.getByRole('button', { name: '展开翻译设置' }).click();
  await expect(page.locator('#full-controls')).not.toHaveClass(/is-collapsed/);
  await page.locator('#assistant-content').evaluate((el) => (el.scrollTop = 0));
  await expect(page.getByRole('button', { name: '全文目标语言' })).toBeVisible();
  await expect(page.locator('[data-full-stage]')).toHaveText('翻译完成');
  await page.getByRole('button', { name: '收起翻译设置' }).click();
  await expect(page.locator('#full-controls')).toHaveClass(/is-collapsed/);
  await page.screenshot({ path: 'test-results/full-collapsed.png', animations: 'disabled' });
});
test('mobile selection remains available for annotations and compact translation controls fit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await importPdf(page);
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '手机端译文' } } }),
  );
  await selectText(page, 'parallel computation');
  await expect(page.locator('.reader-panel')).toBeVisible();
  await page.getByRole('button', { name: '文字高亮', exact: true }).click();
  await expect(page.locator('.mark-highlight')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '文字高亮', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  expect((await page.locator('.document-tab').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.locator('[data-mobile-pane="assistant"]').click();
  await expect(page.locator('#selection-result')).toContainText('手机端译文');
  await page.getByRole('button', { name: '翻译设置', exact: true }).click();
  await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
  await expect(page.getByRole('option', { name: 'MyMemory · 在线翻译' })).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-translation-popover.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('a direct PDF response is saved once without entering the local PDF export branch', async ({ page }) => {
  await setup(page);
  await importPdf(page);
  await configure(page);
  const returned = await fixture('translated.pdf');
  await page.route('https://llm.test/v1/chat/completions', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: returned.buffer }),
  );
  await page.evaluate(() => {
    window.saveCount = 0;
    window.showSaveFilePicker = async () => {
      saveCount++;
      return { createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    };
  });
  await page.locator('[data-assistant-tab="full"]').click();
  await page.getByRole('button', { name: '全文展示方式' }).click();
  await page.getByRole('option', { name: '转换为 PDF 并下载', exact: true }).click();
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.locator('.result-toolbar')).toContainText('翻译完成');
  expect(await page.evaluate(() => window.saveCount)).toBe(1);
});
