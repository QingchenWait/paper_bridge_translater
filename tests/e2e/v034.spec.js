import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'node:http';

async function fixture(name = 'Reading.pdf') {
  const pdf = await PDFDocument.create();
  pdf.setTitle(name);
  pdf.addPage().drawText('Independent reading font preferences', { x: 60, y: 700, size: 18 });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function setup(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
}
const fonts = (page) =>
  page.evaluate(async () => (await (await import('/src/js/settings.js')).getSettings()).readingFontSizes);
const size = (page, selector) =>
  page.locator(selector).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
async function choose(page, mobile) {
  if (mobile) await page.locator('.mobile-nav [data-mobile-pane="reader"]').click();
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page.evaluate(() => {
    document.activeElement?.blur();
    const span = document.querySelector('.textLayer span'),
      range = document.createRange();
    span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document
      .getElementById('pdf-scroll')
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
  if (mobile) await page.locator('.mobile-nav [data-mobile-pane="assistant"]').click();
  await expect(page.locator('#selection-result')).toContainText('独立字号译文');
}

test('external extensionless and redirected PDF responses enter the library without a local download', async ({
  page,
}) => {
  await setup(page);
  let downloads = 0,
    pickers = 0;
  page.on('download', () => downloads++);
  page.on('filechooser', () => pickers++);
  const first = await fixture('remote'),
    second = await fixture('redirected');
  // Browser redirect chains are served by a real local endpoint: Playwright's
  // route hook is only called for the first URL of a redirected request.
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.url.startsWith('/download')) {
      response.writeHead(302, { location: '/content/42' });
      response.end();
    } else {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(second.buffer);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    await page.route('https://arxiv.org/pdf/2503.13443', (route) =>
      route.fulfill({ body: first.buffer, contentType: 'application/pdf' }),
    );
    for (const [url, expected] of [
      ['https://arxiv.org/pdf/2503.13443', '2503.13443.pdf'],
      [`${endpoint}/download?token=abc`, 'download.pdf'],
    ]) {
      await page.locator('.document-bar [data-action="open-pdf"]').click();
      await page.getByRole('menuitem', { name: '外部链接', exact: true }).click();
      await page.locator('#external-pdf-form [name="url"]').fill(url);
      await page.locator('#external-pdf-form [type="submit"]').click();
      await expect(page.locator('.document-tab.active')).toContainText(expected);
      await expect(page.locator('.textLayer span').first()).toBeVisible();
    }
    expect(downloads).toBe(0);
    expect(pickers).toBe(0);
    expect(
      await page.evaluate(async () =>
        (await (await import('/src/js/storage.js')).all('documents')).every((d) => d.folderId === null),
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await page.route('https://files.test/article', (route) =>
      route.fulfill({ body: '<html>This is an article page</html>', contentType: 'text/html' }),
    );
    await page.locator('.document-bar [data-action="open-pdf"]').click();
    await page.getByRole('menuitem', { name: '外部链接', exact: true }).click();
    await page.locator('#external-pdf-form [name="url"]').fill('https://files.test/article');
    await page.locator('#external-pdf-form [type="submit"]').click();
    await expect(page.locator('.toast.error').last()).toContainText('导入失败');
    expect(
      await page.evaluate(async () => (await (await import('/src/js/storage.js')).all('documents')).length),
    ).toBe(2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

for (const mobile of [false, true]) {
  test(`three independent reading sizes persist, preserve markup and stop at bounds on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    let calls = 0;
    await page.route('https://api.mymemory.translated.net/**', (route) => {
      calls++;
      return route.fulfill({
        json: { responseStatus: 200, responseData: { translatedText: '独立字号译文' } },
      });
    });
    await page.locator('#pdf-input').setInputFiles(await fixture());
    await choose(page, mobile);
    const original = await size(page, '.source-text'),
      translated = await size(page, '#selection-result');
    await page.getByRole('button', { name: '原文字体加大', exact: true }).click();
    await expect.poll(() => size(page, '.source-text')).toBeCloseTo(original * 1.1, 2);
    expect(await size(page, '#selection-result')).toBe(translated);
    await page.getByRole('button', { name: '译文字体缩小', exact: true }).click();
    await expect.poll(() => fonts(page)).toEqual({ source: 110, selection: 90, full: 100 });
    expect(calls).toBe(1);
    await page.evaluate(async () => {
      const { all, put } = await import('/src/js/storage.js');
      const doc = (await all('documents'))[0];
      const text =
        '# 标题\n\n正文 $x^2$\n\n| A | B |\n|---|---|\n|1|2|\n\n```js\nlet x = 1;\n```\n\n<span style="font-size:20px;color:red">定制文字</span>';
      for (const [id, createdAt] of [
        ['older', 1],
        ['latest', 2],
      ])
        await put('translations', {
          id,
          documentId: doc.id,
          rootId: doc.rootId,
          createdAt,
          status: 'complete',
          content: text,
        });
    });
    await page.getByRole('tab', { name: '全文翻译', exact: true }).click();
    await expect(page.locator('#full-result h1')).toHaveText('标题');
    const full = await size(page, '#full-result'),
      heading = await size(page, '#full-result h1');
    await page.getByRole('button', { name: '全文译文字体加大', exact: true }).click();
    await expect.poll(() => size(page, '#full-result h1')).toBeCloseTo(heading * 1.1, 2);
    await expect.poll(() => size(page, '#full-result [style*="20px"]')).toBe(22);
    await page.getByRole('button', { name: '全文译文字体加大', exact: true }).click();
    await expect.poll(() => size(page, '#full-result')).toBeCloseTo(full * 1.2, 2);
    expect(await size(page, '#full-result [style*="20px"]')).toBe(24);
    await page.getByRole('button', { name: '翻译历史', exact: true }).click();
    await page.locator('[data-select="translation-history"] [data-value="older"]').click();
    await expect.poll(() => size(page, '#full-result [style*="20px"]')).toBe(24);
    await expect(page.locator('#full-result .katex')).toHaveCount(1);
    await expect(page.locator('#full-result table')).toHaveCount(1);
    await page.screenshot({
      path: `test-results/v034-full-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
    await page.getByRole('tab', { name: '划词翻译', exact: true }).click();
    await expect.poll(() => fonts(page)).toEqual({ source: 110, selection: 90, full: 120 });
    for (let n = 0; n < 7; n++) await page.getByRole('button', { name: '原文字体加大', exact: true }).click();
    await expect(page.getByRole('button', { name: '原文字体加大', exact: true })).toBeDisabled();
    for (let n = 0; n < 2; n++) await page.getByRole('button', { name: '译文字体缩小', exact: true }).click();
    await expect(page.getByRole('button', { name: '译文字体缩小', exact: true })).toBeDisabled();
    await page.screenshot({
      path: `test-results/v034-selection-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
    expect(await page.locator('.selection-content').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await page.locator('#pdf-input').setInputFiles(await fixture('Second.pdf'));
    await expect(page.locator('.document-tab.active')).toContainText('Second.pdf');
    await choose(page, mobile);
    await expect.poll(() => fonts(page)).toEqual({ source: 180, selection: 70, full: 120 });
    await expect(page.getByRole('button', { name: '原文字体加大', exact: true })).toBeDisabled();
    await page.reload();
    await choose(page, mobile);
    await expect(page.getByRole('button', { name: '译文字体缩小', exact: true })).toBeDisabled();
    expect((await fonts(page)).full).toBe(120);
  });
  test(`zoom control keeps its width across fit, standard and custom values on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    await page.locator('#pdf-input').setInputFiles(await fixture());
    await expect(page.locator('.textLayer span').first()).toBeVisible();
    const control = page.locator('[data-select="zoom"]'),
      trigger = control.locator('.select-trigger');
    const width = (await trigger.boundingBox()).width;
    let menuWidth;
    for (const text of ['50%', '200%', '适应宽度']) {
      await trigger.click();
      const currentMenu = (await control.locator('.select-menu').boundingBox()).width;
      if (menuWidth) expect(currentMenu).toBeCloseTo(menuWidth, 1);
      menuWidth = currentMenu;
      await page.getByRole('option', { name: text, exact: true }).click();
      expect((await trigger.boundingBox()).width).toBeCloseTo(width, 1);
    }
    await page.getByRole('button', { name: '放大', exact: true }).click();
    expect((await trigger.boundingBox()).width).toBeCloseTo(width, 1);
  });
}

test('full translation stream retains font preference without restarting the API request', async ({
  page,
}) => {
  await setup(page);
  await page.locator('#pdf-input').setInputFiles(await fixture());
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page.evaluate(async () => {
    await (
      await import('/src/js/settings.js')
    ).saveSettings({
      chatProviders: [{ id: 'stream', name: 'Stream', baseUrl: 'https://stream.test/v1', model: 'm' }],
    });
  });
  let calls = 0,
    release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://stream.test/v1/chat/completions', async (route) => {
    calls++;
    await held;
    await route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: '# 流式译文\n\n正文' } }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.getByRole('tab', { name: '全文翻译', exact: true }).click();
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.getByRole('button', { name: '全文译文字体加大', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全文译文字体加大', exact: true }).click();
  await expect.poll(() => fonts(page)).toMatchObject({ full: 110 });
  release();
  await expect(page.locator('#full-result h1')).toHaveText('流式译文');
  expect(
    await page.locator('#full-result').evaluate((el) => el.style.getPropertyValue('--reading-font-scale')),
  ).toBe('1.1');
  expect(calls).toBe(1);
});
