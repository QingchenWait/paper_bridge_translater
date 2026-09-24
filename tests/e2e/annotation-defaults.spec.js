import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function setup(page, mobile) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '测试译文' } } }),
  );
  const pdf = await PDFDocument.create();
  for (let n = 0; n < 2; n++)
    pdf
      .addPage([600, 800])
      .drawText('Needle text for independent annotation defaults', { x: 60, y: 700, size: 16 });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Defaults.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await page.evaluate(async () => {
    const { all, put } = await import('/src/js/storage.js'),
      doc = (await all('documents'))[0];
    for (const row of [
      { id: 'seed-note', type: 'note', x: 0.12, y: 0.25, text: 'Seed note', fontSize: 47, rects: [] },
      { id: 'seed-text', type: 'text', x: 0.5, y: 0.4, text: 'Seed text', fontSize: 14 },
      { id: 'keep-mark', type: 'highlight', rects: [{ x: 0.1, y: 0.15, w: 0.2, h: 0.02 }] },
    ])
      await put('annotations', { page: 1, color: '#c3a7ff', documentId: doc.id, deleted: false, ...row });
  });
  await page.reload();
  await expect(page.locator('[data-annotation-id="seed-note"]').first()).toBeVisible();
}
const row = (page, id) =>
  page.evaluate(async (id) => (await import('/src/js/storage.js')).get('annotations', id), id);
const options = (page) =>
  page.evaluate(
    async () =>
      (await (await import('/src/js/storage.js')).get('settings', 'annotation-tools'))?.value.options,
  );
async function sizeMenu(page, type) {
  await page.evaluate((type) => {
    const primary = document.querySelector('[data-action="tool-' + type + '"]');
    const buttons = [...document.querySelectorAll('#pdf-toolbar button')];
    const arrow =
      buttons.find(
        (b) =>
          b.dataset.action === 'color-' + type || b.dataset.toolColor === type || b.dataset.color === type,
      ) ||
      (primary?.nextElementSibling?.tagName === 'BUTTON'
        ? primary.nextElementSibling
        : [...(primary?.parentElement.querySelectorAll('button') || [])].find((b) => b !== primary));
    if (!arrow) throw new Error('No color menu for ' + type);
    arrow.click();
  }, type);
  await expect(page.locator('#tool-size')).toBeVisible();
}
async function selectPdfText(page) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    const span = document.querySelector('.textLayer span'),
      range = document.createRange();
    span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 1, button: 0 }),
    );
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document
      .getElementById('pdf-scroll')
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', pointerId: 1 }));
  });
}
for (const mobile of [false, true]) {
  test(
    'floating note/text sizes persist independently and cap at 48 on ' + (mobile ? 'mobile' : 'desktop'),
    async ({ page }) => {
      await setup(page, mobile);
      await page.locator('[data-annotation-id="seed-note"]').first().click();
      const larger = page.getByRole('button', { name: '字体变大', exact: true });
      await larger.click();
      await expect.poll(async () => (await row(page, 'seed-note')).fontSize).toBe(48);
      if (await larger.isEnabled()) await larger.click();
      await expect.poll(async () => (await options(page))?.noteSize).toBe(48);
      expect((await row(page, 'seed-note')).fontSize).toBe(48);
      await sizeMenu(page, 'note');
      await expect(page.locator('#tool-size')).toHaveValue('48');
      await expect(page.locator('#tool-size')).toHaveAttribute('max', '48');
      await page.locator('#document-status').click();
      await page.locator('[data-annotation-id="seed-text"]').first().dblclick();
      await page.locator('.annotation-input').fill('Edited text');
      await larger.click();
      await expect.poll(async () => (await options(page))?.textSize).toBe(15);
      expect((await options(page)).noteSize).toBe(48);
      await page.locator('#document-status').click();
      await sizeMenu(page, 'text');
      await expect(page.locator('#tool-size')).toHaveValue('15');
      await page.locator('#document-status').click();
      await selectPdfText(page);
      await page.getByRole('button', { name: '批注', exact: true }).click();
      await page.locator('.annotation-input').fill('New note');
      await page.locator('#document-status').click();
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await (await import('/src/js/storage.js')).all('annotations')).find(
                (a) => a.text === 'New note',
              )?.fontSize,
          ),
        )
        .toBe(48);
      await page.getByRole('button', { name: '添加文本框', exact: true }).click();
      const ink = page.locator('.ink-layer').first(),
        bounds = await ink.boundingBox();
      await ink.click({ position: { x: bounds.width * 0.55, y: bounds.height * 0.6 } });
      await page.locator('.annotation-input').fill('New text');
      await page.locator('#document-status').click();
      await expect
        .poll(() =>
          page.evaluate(
            async () =>
              (await (await import('/src/js/storage.js')).all('annotations')).find(
                (a) => a.text === 'New text',
              )?.fontSize,
          ),
        )
        .toBe(15);
      await page.reload();
      await expect(page.locator('.textLayer span').first()).toBeVisible();
      await sizeMenu(page, 'note');
      await expect(page.locator('#tool-size')).toHaveValue('48');
      await page.locator('#document-status').click();
      await sizeMenu(page, 'text');
      await expect(page.locator('#tool-size')).toHaveValue('15');
      expect((await options(page)).noteSize).toBe(48);
      await page.locator('#document-status').click();
      await page.locator('[data-annotation-id="seed-note"]').first().dblclick();
      await larger.click(); // Text-edit mode obeys the same maximum.
      await expect.poll(async () => (await row(page, 'seed-note')).fontSize).toBe(48);
      await sizeMenu(page, 'note');
      // Keep the floating toolbar and menu open together to check live sync.
      await page.locator('[data-text-action="smaller"]').evaluate((button) => button.click());
      await expect(page.locator('#tool-size')).toHaveValue('47');
      await expect(page.locator('#color-popover output')).toHaveText('47 pt');
      await expect.poll(async () => (await options(page))?.noteSize).toBe(47);
      expect((await options(page)).textSize).toBe(15);
    },
  );
  test(
    'search highlights follow the visible search tab on ' + (mobile ? 'mobile' : 'desktop'),
    async ({ page }) => {
      await setup(page, mobile);
      const search = page.getByRole('button', { name: '查找文字', exact: true });
      await search.click();
      const form = page.locator('.navigation-search-form'),
        input = form.locator('input:not([type="checkbox"])');
      await input.fill('Needle');
      await form.evaluate((el) => el.requestSubmit());
      await expect(page.locator('.search-hit').first()).toBeVisible();
      for (const label of ['书签', '缩略图']) {
        await page.locator('.pdf-navigation-tabs button').filter({ hasText: label }).click();
        await expect(page.locator('.search-hit:visible')).toHaveCount(0);
        await expect(page.locator('.mark-highlight')).toBeVisible();
        await page.locator('.pdf-navigation-tabs button').filter({ hasText: '查找' }).click();
        await expect(page.locator('.search-hit').first()).toBeVisible();
        await expect(input).toHaveValue('Needle');
      }
      await page.getByRole('button', { name: '关闭 PDF 导航', exact: true }).click();
      await expect(page.locator('#pdf-navigation')).toBeHidden();
      await expect(page.locator('.search-hit:visible')).toHaveCount(0);
      await page.getByRole('button', { name: '缩放比例', exact: true }).click();
      await page.getByRole('option', { name: '75%', exact: true }).click();
      await expect(page.locator('.textLayer span').first()).toBeVisible();
      await expect(page.locator('.search-hit:visible')).toHaveCount(0);
      await search.click();
      await expect(page.locator('.search-hit').first()).toBeVisible();
      await expect(input).toHaveValue('Needle');
      expect((await row(page, 'keep-mark')).deleted).toBe(false);
    },
  );
}
