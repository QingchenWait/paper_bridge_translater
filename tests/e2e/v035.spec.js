import { test, expect, webkit, firefox } from '@playwright/test';
import { PDFDocument, PDFName, PDFString, degrees } from 'pdf-lib';
import { mkdtemp, mkdir } from 'node:fs/promises';
async function setup(page, url = '/') {
  await page.addInitScript(() => {
    navigator.storage.persist = async () => false;
  });
  await page.goto(url);
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
}
async function fixture() {
  const pdf = await PDFDocument.create();
  const pages = Array.from({ length: 3 }, () => pdf.addPage([600, 800]));
  pages.forEach((p, i) =>
    p.drawText(i ? `Reference target ${i + 1}` : 'Click reference [1] here', { x: 60, y: 700, size: 16 }),
  );
  pages[2].setRotation(degrees(90));
  const target = [pages[1].ref, PDFName.of('XYZ'), 60, 400, null];
  const names = pdf.context.obj({ Names: [PDFString.of('reference-one'), target] });
  pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: names }));
  const links = [
    {
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [55, 695, 240, 720],
      Dest: PDFString.of('reference-one'),
      Border: [0, 0, 0],
    },
    {
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [55, 640, 240, 665],
      A: { S: 'GoTo', D: [pages[2].ref, PDFName.of('FitH'), 650] },
      Border: [0, 0, 0],
    },
    {
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [55, 600, 240, 620],
      A: { S: 'URI', URI: PDFString.of('https://external.invalid') },
      Border: [0, 0, 0],
    },
  ];
  pages[0].node.set(
    PDFName.of('Annots'),
    pdf.context.obj(links.map((a) => pdf.context.register(pdf.context.obj(a)))),
  );
  pages[2].node.set(
    PDFName.of('Annots'),
    pdf.context.obj([
      pdf.context.register(
        pdf.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [55, 695, 240, 720],
          Dest: [pages[0].ref, PDFName.of('Fit')],
          Border: [0, 0, 0],
        }),
      ),
    ]),
  );
  return { name: 'Internal links.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function ready(page, n = 1) {
  await page.waitForFunction(
    (n) => !!document.querySelector(`.pdf-page[data-page="${n}"] .ink-layer`)?.onpointerdown,
    n,
  );
}
async function load(page) {
  await page.locator('#pdf-input').setInputFiles(await fixture());
  await ready(page);
}
async function tapLink(page, n, index = 0, touch = false) {
  const link = page.locator(`.pdf-page[data-page="${n}"] .pdf-internal-link`).nth(index),
    rect = await link.boundingBox();
  if (touch) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}
async function linkScenario(page, touch = false) {
  await load(page);
  await expect(page.locator('.pdf-page[data-page="1"] .pdf-internal-link')).toHaveCount(2);
  if (!touch) {
    const link = await page.locator('.pdf-page[data-page="1"] .textLayer span').first().boundingBox();
    await page.mouse.move(link.x + 2, link.y + link.height / 2);
    await page.mouse.down();
    await page.mouse.move(link.x + link.width - 2, link.y + link.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('#page-input')).toHaveValue('1');
    expect(await page.evaluate(() => getSelection().toString().length)).toBeGreaterThan(0);
    await page.evaluate(() => getSelection().removeAllRanges());
  }
  await tapLink(page, 1, 0, touch);
  await expect(page.locator('#page-input')).toHaveValue('2');
  await ready(page, 2);
  const pos = await page.evaluate(() => {
    const r = document.getElementById('pdf-scroll'),
      s = r.querySelector('[data-page="2"]');
    return Math.abs(r.scrollTop - (s.offsetTop + s.clientHeight * 0.5 - r.clientHeight * 0.25));
  });
  expect(pos).toBeLessThan(3);
  await page.locator('#page-input').fill('1');
  await page.locator('#page-input').press('Enter');
  await ready(page, 1);
  await page.getByRole('button', { name: '缩放比例', exact: true }).click();
  await page.getByRole('option', { name: '75%', exact: true }).click();
  await ready(page, 1);
  await tapLink(page, 1, 1, touch);
  await ready(page, 3);
  // At the end of a short PDF the scroll range is clamped: page 2 can remain
  // at the viewport's reading threshold while the entire destination is visible.
  await expect(page.locator('.pdf-page[data-page="3"] .textLayer span').first()).toBeInViewport();
  await tapLink(page, 3, 0, touch);
  await expect(page.locator('#page-input')).toHaveValue('1');
  await ready(page, 1);
  if (!touch) {
    await page.getByRole('button', { name: '添加文本框', exact: true }).click();
    const rect = await page.locator('.pdf-page[data-page="1"]').boundingBox();
    await page.mouse.click(rect.x + 90 * 0.75, rect.y + 90 * 0.75);
    await page.locator('.annotation-input').fill('Edit over link');
    await page.locator('#document-status').click();
    await expect(page.locator('#page-input')).toHaveValue('1');
    await page.getByRole('button', { name: '添加文本框', exact: true }).click();
    await page.locator('.pdf-internal-link').nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.pdf-page[data-page="3"] .textLayer span').first()).toBeInViewport();
  }
}
test('PDF internal links navigate exact destinations through scaling/rotation while selection and editing work', async ({
  page,
}) => {
  await setup(page);
  await linkScenario(page);
});
test('PDF internal links support touch WebKit and Firefox without external navigation', async ({
  baseURL,
}) => {
  await mkdir('.cache', { recursive: true });
  for (const engine of [webkit, firefox]) {
    const touch = engine === webkit;
    const context = await engine.launchPersistentContext(await mkdtemp('.cache/internal-link-'), {
      executablePath: engine.executablePath(),
      headless: true,
      viewport: touch ? { width: 820, height: 1180 } : { width: 1440, height: 900 },
      ...(touch ? { hasTouch: true, isMobile: true } : {}),
    });
    try {
      const page = await context.newPage();
      await setup(page, baseURL);
      await linkScenario(page, touch);
    } finally {
      await context.close();
    }
  }
});

async function configureStream(page) {
  await load(page);
  await page.evaluate(async () => {
    await (
      await import('/src/js/settings.js')
    ).saveSettings({
      chatProviders: [{ id: 'stream', name: 'Stream', model: 'm', baseUrl: 'https://stream.test/v1' }],
    });
  });
  await page.getByRole('tab', { name: '全文翻译', exact: true }).click();
}
test('long multi-page and single-paragraph streaming keeps pace, preserves nodes and saves all output', async ({
  page,
}, testInfo) => {
  await setup(page);
  await configureStream(page);
  await page.evaluate(() => {
    const original = fetch,
      encoder = new TextEncoder();
    window.streamStats = { long: [], mutations: 0, ticks: [], frames: 0 };
    new PerformanceObserver((l) => streamStats.long.push(...l.getEntries().map((e) => e.duration))).observe({
      type: 'longtask',
    });
    window.streamText =
      '# 稳定标题\n\n' +
      '长段落文字 **加粗** 和 $x^2$。'.repeat(2500) +
      '\n\n' +
      Array.from({ length: 250 }, (_, i) => `## 第${i}节\n\n正文${i}。\n\n`).join('') +
      '\n最终完结';
    window.fetch = (url, opts) => {
      if (!String(url).startsWith('https://stream.test/')) return original(url, opts);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              let offset = 0;
              const timer = setInterval(() => {
                const text = streamText.slice(offset, offset + 700);
                offset += text.length;
                c.enqueue(
                  encoder.encode(
                    'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n',
                  ),
                );
                if (offset >= streamText.length) {
                  clearInterval(timer);
                  c.enqueue(encoder.encode('data: [DONE]\n\n'));
                  c.close();
                  streamStats.produced = performance.now();
                }
              }, 15);
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    };
  });
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.locator('#full-result h1')).toHaveText('稳定标题');
  const oldHeading = await page.locator('#full-result h1').elementHandle();
  expect(await page.evaluate(() => !!streamStats.produced)).toBe(false);
  await page.getByRole('button', { name: '全文译文字体加大', exact: true }).click();
  await page.locator('#assistant-content').evaluate((el) => (el.scrollTop = 200));
  await expect(page.locator('[data-full-stage]')).toHaveText('翻译完成', { timeout: 30000 });
  const stats = await page.evaluate(async () => {
    const saved = (await (await import('/src/js/storage.js')).all('translations'))[0];
    const r = document.querySelector('#full-result');
    return {
      ...streamStats,
      finished: performance.now(),
      exact: saved.content === streamText,
      length: streamText.length,
      headings: r.querySelectorAll('h2').length,
      math: r.querySelectorAll('.katex').length,
      scale: r.style.getPropertyValue('--reading-font-scale'),
    };
  });
  expect(stats.exact).toBe(true);
  expect(stats.headings).toBe(250);
  expect(stats.math).toBe(2500);
  expect(stats.scale).toBe('1.1');
  expect(await oldHeading.evaluate((el) => el.isConnected)).toBe(true);
  expect(stats.finished - stats.produced).toBeLessThan(6000);
  expect(Math.max(0, ...stats.long)).toBeLessThan(1200);
  await testInfo.attach('stream-performance.json', {
    body: JSON.stringify(stats),
    contentType: 'application/json',
  });
  await page.reload();
  await ready(page);
  await page.getByRole('tab', { name: '全文翻译', exact: true }).click();
  await expect(page.locator('#full-result')).toContainText('最终完结', { timeout: 30000 });
});
test('stream backup flushes latest text, stop preserves partial output and worker fallback still renders', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        if (String(url).includes('markdown.worker')) throw new Error('Worker disabled fixture');
        super(url, options);
      }
    };
  });
  await setup(page);
  await configureStream(page);
  await page.evaluate(() => {
    const original = fetch;
    window.fetch = (url, opts) => {
      if (!String(url).startsWith('https://stream.test/')) return original(url, opts);
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              window.partial = '# 部分译文\n\n保留全部内容 $x^2$';
              c.enqueue(
                new TextEncoder().encode(
                  'data: ' + JSON.stringify({ choices: [{ delta: { content: partial } }] }) + '\n\n',
                ),
              );
              opts.signal.addEventListener('abort', () => c.error(new DOMException('stopped', 'AbortError')));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    };
  });
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.locator('#full-result h1')).toHaveText('部分译文');
  expect(
    await page.evaluate(async () => {
      const a = await import('/src/js/archive.js');
      const d = await a.readArchive(await a.createArchive({ includeSecrets: false }));
      return d.translations[0].content === partial;
    }),
  ).toBe(true);
  await page.getByRole('button', { name: '停止全文翻译', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => (await (await import('/src/js/storage.js')).all('translations'))[0].status),
    )
    .toBe('stopped');
  await expect(page.locator('#full-result .katex')).toHaveCount(1);
});
