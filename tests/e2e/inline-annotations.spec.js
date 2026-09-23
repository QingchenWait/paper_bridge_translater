import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
const text = 'Original paper text selected for a linked comment.';
async function setup(page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.route('https://api.mymemory.translated.net/**', (r) =>
    r.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '测试译文' } } }),
  );
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(text, { x: 60, y: 650, font, size: 14 });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Inline.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
}
async function records(page) {
  return page.evaluate(async () =>
    (await (await import('/src/js/storage.js')).all('annotations')).filter((a) => !a.deleted),
  );
}
async function selectedText(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.textLayer span');
    document.activeElement?.blur();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
}
async function textbox(page, value = 'Textbox') {
  const tool = page.getByRole('button', { name: '添加文本框', exact: true });
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
  const bounds = await page.locator('.ink-layer').boundingBox();
  await page.locator('.ink-layer').click({ position: { x: bounds.width * 0.15, y: bounds.height * 0.45 } });
  await expect(page.getByRole('textbox', { name: '文本框内容', exact: true })).toBeFocused();
  if (value) await page.getByRole('textbox', { name: '文本框内容', exact: true }).fill(value);
}
const finish = (page) => page.locator('#document-status').click();

test('inline creation supports Enter, automatic sizing, empty removal and durable text without a modal', async ({
  page,
}) => {
  await setup(page);
  await textbox(page, '');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await finish(page);
  await expect(page.locator('.annotation-text')).toHaveCount(0);
  expect(await records(page)).toHaveLength(0);
  await textbox(page, 'First');
  const short = await page.locator('.annotation-text').boundingBox();
  await page.getByRole('textbox', { name: '文本框内容' }).press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('Second line is longer');
  await expect
    .poll(async () => (await page.locator('.annotation-text').boundingBox()).height)
    .toBeGreaterThan(short.height);
  await expect.poll(async () => (await records(page))[0]?.text).toBe('First\nSecond line is longer');
  await page.reload();
  await expect(page.locator('.annotation-text')).toContainText('Second line is longer'); // An active edit was already durable.
  await page.locator('.annotation-text').dblclick();
  await page.getByRole('textbox', { name: '文本框内容' }).fill('');
  await finish(page);
  await expect(page.locator('.annotation-text')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.annotation-text')).toContainText('Second line is longer');
});

test('width handles lock wrapping, text editing preserves manual width, reset restores auto size and tools undo', async ({
  page,
}) => {
  await setup(page);
  await textbox(page, 'A fairly long textbox sentence repeated. '.repeat(8));
  await finish(page);
  const box = page.locator('.annotation-text');
  await box.click();
  await expect(page.locator('.annotation-tools')).toBeVisible();
  await expect(page.locator('.annotation-tools button')).toHaveCount(5);
  const shell = await page.locator('.pdf-page').boundingBox(),
    handle = await box.locator('[data-resize="right"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(shell.x + shell.width * 0.87, handle.y + handle.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await records(page))[0].width).toBeGreaterThan(0.45);
  const manual = (await box.boundingBox()).width;
  await box.dblclick();
  await page.getByRole('textbox', { name: '文本框内容' }).fill('Short');
  await finish(page);
  expect((await box.boundingBox()).width).toBeCloseTo(manual, 0);
  await page.reload();
  await expect(box).toContainText('Short');
  expect((await box.boundingBox()).width).toBeCloseTo(manual, 0);
  await box.click();
  await page.getByRole('button', { name: '字体变大', exact: true }).click();
  await expect.poll(async () => (await records(page))[0].fontSize).toBe(15);
  await page.getByRole('button', { name: '添加/去除边框', exact: true }).click();
  await expect(box).toHaveClass(/has-border/);
  await page.getByRole('button', { name: '尺寸变更重置', exact: true }).click();
  await expect.poll(async () => (await records(page))[0].width).toBeUndefined();
  expect((await box.boundingBox()).width).toBeLessThan(manual);
  await box.dblclick();
  await page.getByRole('textbox', { name: '文本框内容' }).fill('Automatic sizing grows again');
  await finish(page);
  expect((await box.boundingBox()).width).toBeLessThanOrEqual(shell.width * 0.45 + 1);
  await box.click();
  await page.getByRole('button', { name: '删除该对象', exact: true }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
  await expect(box).toContainText('Automatic sizing grows again');
  await expect(box).toHaveClass(/has-border/);
  await page.reload();
  await expect(box).toHaveClass(/has-border/);
  expect((await records(page))[0].fontSize).toBe(15);
});

test('notes underline their source, glow on hover, support multiline editing and remove their anchors on delete', async ({
  page,
}) => {
  await setup(page);
  await selectedText(page);
  await page.getByRole('button', { name: '批注', exact: true }).click();
  const input = page.getByRole('textbox', { name: '批注内容', exact: true });
  await expect(input).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input.fill('中文批注\n第二行内容');
  await finish(page);
  await expect(page.locator('.note-anchor')).toHaveCount(1);
  const row = (await records(page))[0];
  expect(await page.locator('.note-anchor').evaluate((el) => el.style.getPropertyValue('--mark-color'))).toBe(
    row.color,
  );
  const source = await page.locator('.textLayer span').first().boundingBox();
  await page.mouse.move(source.x + 5, source.y + source.height / 2);
  await expect(page.locator('.annotation-note')).toHaveClass(/is-emphasized/);
  await page.locator('.annotation-note').click();
  await expect(page.locator('.annotation-tools button')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '添加/去除边框', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/inline-note-desktop.png' });
  await page.getByRole('button', { name: '删除该对象', exact: true }).click();
  await expect(page.locator('.note-anchor')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.note-anchor')).toHaveCount(1);
});

test('exported PDF preserves native comment Contents/popups instead of page text, with complete backup geometry', async ({
  page,
}) => {
  await setup(page);
  await selectedText(page);
  await page.getByRole('button', { name: '批注', exact: true }).click();
  await page.getByRole('textbox', { name: '批注内容' }).fill('标准批注第一行\nNative note content');
  await finish(page);
  await textbox(page, 'Added textbox content');
  await finish(page);
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (blob) => {
          window.exportedPdf = blob;
        },
        close: async () => {},
      }),
    });
  });
  await page.getByRole('button', { name: '下载包含批注的 PDF' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.exportedPdf))).toBe(true);
  const result = await page.evaluate(async () => {
    const { loadPdf } = await import('/src/js/pdf.js'),
      pdf = await loadPdf(window.exportedPdf);
    const { createArchive, readArchive } = await import('/src/js/archive.js');
    try {
      const p = await pdf.getPage(1);
      return {
        text: (await p.getTextContent()).items.map((i) => i.str).join(' '),
        annotations: await p.getAnnotations(),
        bytes: Array.from(new Uint8Array(await window.exportedPdf.arrayBuffer())),
        backup: (await readArchive(await createArchive())).annotations,
      };
    } finally {
      await pdf.destroy();
    }
  });
  expect(result.text).toContain('Added textbox content');
  expect(result.text).not.toContain('Native note content');
  const note = result.annotations.find((a) => a.subtype === 'Underline');
  expect(note.contentsObj.str).toContain('标准批注第一行\nNative note content');
  expect(note.quadPoints.length).toBe(8);
  expect(result.annotations.some((a) => a.subtype === 'Popup')).toBe(true);
  expect(result.backup.filter((a) => !a.deleted).every((a) => a.boxWidth > 0 && a.boxHeight > 0)).toBe(true);
  await writeFile('.cache/annotations-export.pdf', Buffer.from(result.bytes));
});

test('mobile resize handles and floating controls follow the object and double tap edits text', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await textbox(page, 'Touch editing');
  await finish(page);
  const box = page.locator('.annotation-text');
  await box.click();
  const rect = await box.locator('[data-resize="right"]').boundingBox();
  expect(rect.width).toBeGreaterThanOrEqual(32);
  const cdp = await context.newCDPSession(page);
  const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 45, y: start.y }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await records(page))[0].width).toBeGreaterThan(0);
  const toolbar = await page.locator('.annotation-tools').boundingBox(),
    bounds = await box.boundingBox();
  expect(toolbar.y).toBeGreaterThan(bounds.y + bounds.height - 1);
  expect(toolbar.x).toBeGreaterThanOrEqual(0);
  expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/inline-text-mobile.png' });
  const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  for (let i = 0; i < 2; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await expect(page.getByRole('textbox', { name: '文本框内容' })).toBeFocused();
});

test('only Model/API inputs and selectors become more compact', async ({ page }) => {
  await setup(page);
  await page.locator('.sidebar [data-action="settings"]').click();
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('option', { name: 'DeepSeek', exact: true }).click();
  const input = (await page.locator('#provider-form [name="baseUrl"]').boundingBox()).height,
    select = (await page.locator('[data-select="api-protocol"] .select-trigger').boundingBox()).height;
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
  await page.locator('[data-basic-provider="baidu"] .basic-summary').click();
  expect(input).toBeLessThan(
    (await page.locator('[data-basic-provider="baidu"] [name="keyId"]').boundingBox()).height,
  );
  expect(select).toBeLessThan(
    (await page.locator('[data-select="basic-default"] .select-trigger').boundingBox()).height,
  );
});
