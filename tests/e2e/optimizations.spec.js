import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, PDFString } from 'pdf-lib';
async function fixture(name = 'Navigation.pdf', outline = true) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(`Chapter ${i}`, { x: 60, y: 720, size: 22, font });
    page.drawText('Select these words for translation.', { x: 60, y: 650, size: 15, font });
  }
  if (outline) {
    const root = pdf.context.obj({ Type: PDFName.of('Outlines'), Count: 2 });
    const rootRef = pdf.context.register(root);
    const first = pdf.context.obj({
      Title: PDFString.of('Introduction'),
      Parent: rootRef,
      Dest: [pdf.getPage(0).ref, PDFName.of('Fit')],
    });
    const firstRef = pdf.context.register(first);
    const second = pdf.context.obj({
      Title: PDFString.of('Last chapter'),
      Parent: rootRef,
      Dest: PDFString.of('last-chapter'),
      Prev: firstRef,
    });
    const secondRef = pdf.context.register(second);
    first.set(PDFName.of('Next'), secondRef);
    root.set(PDFName.of('First'), firstRef);
    root.set(PDFName.of('Last'), secondRef);
    pdf.catalog.set(PDFName.of('Outlines'), rootRef);
    pdf.catalog.set(
      PDFName.of('Names'),
      pdf.context.obj({
        Dests: { Names: [PDFString.of('last-chapter'), [pdf.getPage(2).ref, PDFName.of('Fit')]] },
      }),
    );
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function setup(page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({
      json: { responseStatus: 200, responseData: { translatedText: '选择这些文字进行翻译。' } },
    }),
  );
  await page.locator('#pdf-input').setInputFiles(await fixture());
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeVisible({
    timeout: 15000,
  });
}
async function select(page, text = 'Select these words', release = true) {
  await page.evaluate(
    ({ text, release }) => {
      const span = [...document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span')].find((s) =>
        s.textContent.includes(text),
      );
      const range = document.createRange();
      const start = span.textContent.indexOf(text);
      range.setStart(span.firstChild, start);
      range.setEnd(span.firstChild, start + text.length);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      if (release)
        document
          .getElementById('pdf-scroll')
          .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    },
    { text, release },
  );
}
async function configure(page) {
  await page.evaluate(async () => {
    const { saveSettings } = await import('/src/js/settings.js');
    await saveSettings({
      chatProviders: [
        { id: 'test', name: 'Test', baseUrl: 'https://llm.test/v1', model: 'test', protocol: 'chat' },
      ],
      defaultChatProviderId: 'test',
    });
  });
}
test('defers the Markdown renderer until a rich assistant view is opened', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  const initial = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );
  const richRenderer = (name) =>
    /(?:\/|-)markdown(?:[./_-]|$)|(?:\/|-)katex(?:[./_-]|$)|highlight(?:_js|\.js|\.css)/i.test(name);
  expect(initial.some(richRenderer)).toBe(false);
  await page.locator('#pdf-input').setInputFiles(await fixture());
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 15000 });
  await page.locator('[data-assistant-tab="chat"]').click();
  await expect(page.locator('#chat-input')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((entry) => /(?:\/|-)markdown(?:[./_-]|$)/i.test(entry.name)),
      ),
    )
    .toBe(true);
});
for (const mobile of [false, true])
  test(
    'entry controls do not wait for persistence or a restored PDF on ' + (mobile ? 'mobile' : 'desktop'),
    async ({ page }) => {
      if (mobile) await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(() => {
        navigator.storage.persist = () => new Promise(() => {});
      });
      await page.goto('/');
      await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
      await page.locator('#pdf-input').setInputFiles(await fixture());
      await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
      let release;
      const held = new Promise((done) => {
        release = done;
      });
      let requested = false;
      await page.route(/pdfjs-dist(?:_|\/)legacy(?:_|\/)build(?:_|\/)pdf(?:__|\.)mjs/, async (route) => {
        requested = true;
        await held;
        await route.continue().catch(() => {});
      });
      try {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: '直接进入 APP', exact: true })).toBeVisible();
        await expect.poll(() => requested).toBe(true);
        expect(await page.locator('.textLayer span').count()).toBe(0);
        await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
        await page.locator((mobile ? '.mobile-nav' : '.sidebar') + ' [data-action=settings]').click();
        await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        release();
        await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 15000 });
      } finally {
        release();
      }
    },
  );

for (const view of ['selection', 'chat'])
  test('a delayed ' + view + ' renderer does not overwrite a newer assistant tab', async ({ page }) => {
    await setup(page);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let release;
    const held = new Promise((done) => {
      release = done;
    });
    let requested = false;
    await page.route('**/src/js/markdown.js', async (route) => {
      requested = true;
      await held;
      await route.continue().catch(() => {});
    });
    try {
      if (view === 'selection') await select(page);
      else await page.locator('[data-assistant-tab="chat"]').click();
      await expect.poll(() => requested).toBe(true);
      await page.locator('[data-assistant-tab="full"]').click();
      await expect(page.locator('#full-controls')).toBeVisible();
      release();
      await page.evaluate(() => import('/src/js/markdown.js'));
      await expect(page.locator('#full-controls')).toBeVisible();
      await expect(page.locator('#chat-input')).toHaveCount(0);
      await expect(page.locator('#selection-result')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      release();
    }
  });

test('translation waits for mouse and touch release, not selectionchange while held', async ({ page }) => {
  await setup(page);
  let requests = 0;
  await page.route('https://api.mymemory.translated.net/**', (route) => {
    requests++;
    return route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '完成选取' } } });
  });
  const span = page
    .locator('.pdf-page[data-page="1"] .textLayer span')
    .filter({ hasText: 'Select these words' });
  const box = await span.boundingBox();
  await page.mouse.move(box.x + 2, box.y + 4);
  await page.mouse.down();
  await select(page, 'Select these', false);
  await page.waitForTimeout(350);
  expect(requests).toBe(0);
  await select(page, 'Select these words', false);
  await page.waitForTimeout(350);
  expect(requests).toBe(0);
  await page.mouse.up();
  await expect.poll(() => requests).toBe(1);
  await page
    .locator('#pdf-scroll')
    .dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  await select(page, 'words for translation', false);
  await page.waitForTimeout(350);
  expect(requests).toBe(1);
  await page
    .locator('#pdf-scroll')
    .dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
  await expect.poll(() => requests).toBe(2);
  await page.waitForTimeout(300);
  expect(requests).toBe(2);
});
test('a final native selectionchange after pointer release translates the updated range', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const requests = [];
  await page.route('https://api.mymemory.translated.net/**', (route) => {
    requests.push(new URL(route.request().url()).searchParams.get('q'));
    return route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '最终选区' } } });
  });
  const scroll = page.locator('#pdf-scroll');
  await scroll.dispatchEvent('pointerdown', { pointerId: 8, pointerType: 'touch', button: 0 });
  await select(page, 'Select these', false);
  await scroll.dispatchEvent('pointerup', { pointerId: 8, pointerType: 'touch' });
  await expect.poll(() => requests).toEqual(['Select these']);
  // Native selection handles often send no DOM pointer/touch events at all.
  // Allow the initial selection debounce to expire before extending it.
  await page.waitForTimeout(350);
  await select(page, 'Select these words for translation.', false);
  await expect.poll(() => requests).toEqual(['Select these', 'Select these words for translation.']);
  await select(page, 'words for translation', false);
  await expect.poll(() => requests).toHaveLength(3);
  await page.evaluate(() => document.dispatchEvent(new Event('selectionchange')));
  await page.waitForTimeout(350);
  expect(requests).toHaveLength(3);
  // Android hands ownership to native selection UI with pointercancel.
  await scroll.dispatchEvent('pointerdown', { pointerId: 9, pointerType: 'touch', button: 0 });
  await scroll.dispatchEvent('pointercancel', { pointerId: 9, pointerType: 'touch' });
  await select(page, 'these words for translation.', false);
  await expect.poll(() => requests).toHaveLength(4);
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeLessThan(50);
});
test('chat displays a thinking ring until the first answer and clears it on failure', async ({ page }) => {
  await setup(page);
  await configure(page);
  let release;
  await page.route('https://llm.test/**', async (route) => {
    await new Promise((resolve) => (release = resolve));
    await route.fulfill({
      json: { choices: [{ message: { content: '回答已到达' }, finish_reason: 'stop' }] },
    });
  });
  await page.locator('[data-assistant-tab="chat"]').click();
  await page.locator('#chat-input').fill('请解释内容');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message-thinking')).toContainText('正在思考');
  await expect(page.locator('.message-thinking .spinner')).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  release();
  await expect(page.locator('.chat-message.assistant')).toContainText('回答已到达');
  await expect(page.locator('.message-thinking')).toHaveCount(0);
  await page.unroute('https://llm.test/**');
  await page.route('https://llm.test/**', (route) =>
    route.fulfill({ status: 500, json: { error: 'test failure' } }),
  );
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  await page.locator('#chat-input').fill('再问一次');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.message-status').last()).toContainText('500');
  await expect(page.locator('.message-thinking')).toHaveCount(0);
});
test('opening a translated PDF shows a matching busy icon until conversion finishes', async ({ page }) => {
  await setup(page);
  await configure(page);
  await page.route('https://llm.test/**', (route) =>
    route.fulfill({
      json: {
        choices: [
          { message: { content: '# Translated paper\n\nA complete translation.' }, finish_reason: 'stop' },
        ],
      },
    }),
  );
  await page.locator('[data-assistant-tab="full"]').click();
  await page.getByRole('button', { name: '开始全文翻译', exact: true }).click();
  await expect(page.locator('#full-result h1')).toHaveText('Translated paper');
  let release;
  await page.route('**/src/js/pdf-export.js*', async (route) => {
    await new Promise((resolve) => (release = resolve));
    await route.continue();
  });
  const button = page.getByRole('button', { name: '在左侧打开译文 PDF', exact: true });
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button.locator('.icon-spin')).toBeVisible();
  await expect(button).toBeDisabled();
  await expect.poll(() => Boolean(release)).toBe(true);
  release();
  await expect(page.locator('.document-tab')).toHaveCount(2, { timeout: 30000 });
  await expect(page.locator('.document-tab.active')).toContainText('译文.pdf');
});
test('navigation shrinks the rail, renders thumbnails and resolves built-in named bookmarks', async ({
  page,
}) => {
  await setup(page);
  const before = await page.locator('.pdf-page[data-page="1"]').boundingBox();
  const originalRail = await page.locator('.sidebar').boundingBox();
  await page.getByRole('button', { name: '缩略图', exact: true }).click();
  await expect(page.locator('.pdf-thumbnail img:not(.icon)').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '缩略图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect((await page.locator('.sidebar').boundingBox()).width).toBeLessThan(originalRail.width);
  await expect(page.locator('.sidebar .nav-item span').first()).toBeHidden();
  await expect
    .poll(async () => (await page.locator('.pdf-page[data-page="1"]').boundingBox())?.width || Infinity)
    .toBeLessThan(before.width);
  await page.getByRole('button', { name: '跳到第 2 页' }).click();
  await expect(page.locator('#page-input')).toHaveValue('2');
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.locator('.pdf-thumbnail')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '缩略图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.getByRole('button', { name: 'Last chapter', exact: true }).click();
  await expect(page.locator('#page-input')).toHaveValue('3');
  await page.screenshot({ path: 'test-results/navigation-desktop.png', animations: 'disabled' });
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.locator('#pdf-navigation')).toBeHidden();
  await expect(page.locator('.sidebar .nav-item span').first()).toBeVisible();
  await page.locator('#pdf-input').setInputFiles(await fixture('No bookmarks.pdf', false));
  await page.getByRole('button', { name: '书签', exact: true }).click();
  await expect(page.locator('.navigation-empty')).toContainText('没有内置书签');
});
test('font and pen sliders affect new records; strike and shapes survive archive and PDF export', async ({
  page,
}) => {
  await setup(page);
  const setSize = async (tool, value) => {
    await page.getByRole('button', { name: tool + '颜色', exact: true }).click();
    await page.locator('#tool-size').evaluate((slider, value) => {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await expect(page.locator('.tool-size-row output')).toHaveText(`${value} pt`);
    await page.keyboard.press('Escape');
  };
  await setSize('批注', 22);
  await select(page);
  await page.getByRole('button', { name: '批注', exact: true }).click();
  await page.locator('.annotation-input').fill('Larger note');
  await page.locator('#document-status').click();
  await setSize('添加文本框', 26);
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  const ink = page.locator('.pdf-page[data-page="1"] .ink-layer');
  await ink.click({ position: { x: 90, y: 180 } });
  await page.locator('.annotation-input').fill('Sized textbox');
  await page.locator('#document-status').click();
  await page.keyboard.press('Escape');
  await setSize('手绘笔迹', 5);
  await page.getByRole('button', { name: '手绘笔迹', exact: true }).click();
  let box = await ink.boundingBox();
  await page.mouse.move(box.x + 50, box.y + 250);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 260, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await select(page);
  await page.getByRole('button', { name: '文字删除线', exact: true }).click();
  await expect(page.locator('.mark-strike')).toHaveCount(1);
  for (const [shape, label] of [
    ['rectangle', '矩形'],
    ['circle', '圆形'],
    ['line', '直线'],
    ['arrow', '箭头'],
  ]) {
    await page.getByRole('button', { name: '形状绘制颜色', exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '形状绘制', exact: true }).click();
    box = await ink.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 330);
    await page.mouse.down();
    await page.mouse.move(box.x + 250, box.y + 420, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
  }
  const result = await page.evaluate(async () => {
    const { all, get } = await import('/src/js/storage.js');
    const { createArchive, readArchive } = await import('/src/js/archive.js');
    const { loadPdf, extractPdfText } = await import('/src/js/pdf.js');
    const { exportAnnotatedPdf } = await import('/src/js/pdf-export.js');
    const rows = await all('annotations'),
      doc = (await all('documents'))[0],
      file = await get('files', doc.id);
    const source = await loadPdf(file.blob);
    const exported = await exportAnnotatedPdf(file.blob, rows, source);
    await source.destroy();
    const rendered = await loadPdf(exported);
    const text = await extractPdfText(rendered);
    await rendered.destroy();
    const archive = await readArchive(await createArchive());
    return { rows, restored: archive.annotations.length, text };
  });
  expect(result.rows.find((r) => r.type === 'note').fontSize).toBe(22);
  expect(result.rows.find((r) => r.type === 'text').fontSize).toBe(26);
  expect(result.rows.find((r) => r.type === 'pen').strokeWidth).toBe(5);
  expect(result.rows.filter((r) => r.type === 'shape')).toHaveLength(4);
  expect(result.restored).toBe(result.rows.length);
  expect(result.text).toContain('Sized textbox');
  await page.reload();
  await expect(page.locator('.mark-strike')).toHaveCount(1);
  await expect(page.locator('.annotation-note')).toContainText('Larger note');
  await page.getByRole('button', { name: '手绘笔迹颜色', exact: true }).click();
  await expect(page.locator('#tool-size')).toHaveValue('5');
});
test('mobile navigation and custom size sliders stay in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole('button', { name: '缩略图', exact: true }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.pdf-thumbnail').first()).toBeVisible();
  await expect
    .poll(() => page.locator('#pdf-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth + 2))
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/navigation-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '关闭 PDF 导航' }).click();
  await expect(page.locator('.sidebar')).toBeHidden();
  await page.getByRole('button', { name: '批注颜色', exact: true }).click();
  await expect(page.getByRole('slider', { name: '字体尺寸' })).toBeVisible();
  const bounds = await page.locator('#color-popover').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/tool-slider-mobile.png', animations: 'disabled' });
});
