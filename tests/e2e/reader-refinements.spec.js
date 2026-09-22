import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFName, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
const sentence = 'Alpha beta Alpha alphabet. Needle NEEDLE needle. WWW iii office';
async function fixture() {
  const pdf = await PDFDocument.create();
  const expected = [];
  for (const [fontName, rotation, unit, crop] of [
    [StandardFonts.TimesRoman, 0, 1, false],
    [StandardFonts.HelveticaBold, 90, 1, false],
    [StandardFonts.CourierOblique, 270, 1.5, true],
  ]) {
    const font = await pdf.embedFont(fontName),
      page = pdf.addPage([612, 792]);
    page.setRotation(degrees(rotation));
    if (crop) page.setCropBox(20, 30, 592, 720);
    if (unit !== 1) page.node.set(PDFName.of('UserUnit'), pdf.context.obj(unit));
    page.drawText(sentence, { x: 65, y: 655, size: 14, font });
    // Standard-font Tj strings have per-glyph advances, without AFM pair kerning.
    const advance = (value) => [...value].reduce((sum, char) => sum + font.widthOfTextAtSize(char, 14), 0);
    expected.push({
      rotation,
      unit,
      start: 65,
      width: advance(sentence),
      prefix: advance(sentence.slice(0, sentence.indexOf('Needle'))),
      word: advance('Needle'),
    });
  }
  return {
    file: { name: 'Precise reader.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) },
    expected,
  };
}
async function setup(page) {
  await page.goto('/');
  await page.getByRole('button', { name: '先使用在线翻译' }).click();
  const document = await fixture();
  await page.locator('#pdf-input').setInputFiles(document.file);
  await expect(page.locator('.pdf-page[data-page="1"] .textLayer span').first()).toBeVisible();
  return document;
}
async function goTo(page, number) {
  await page.locator('#page-input').fill(String(number));
  await page.locator('#page-input').press('Enter');
  await expect(page.locator(`.pdf-page[data-page="${number}"] .textLayer span`).first()).toBeVisible();
}
test('text selection matches PDF advances and raster ink at multiple zooms, rotations and crop/user units', async ({
  page,
}) => {
  const { expected } = await setup(page);
  for (let number = 1; number <= 3; number++)
    for (const zoom of [0.25, 0.5, 0.75, 1, 1.5, 2, 4]) {
      if (zoom === 0.25 || zoom === 4)
        await page.evaluate(
          (value) =>
            document
              .querySelector('[data-select="zoom"]')
              .dispatchEvent(new CustomEvent('valuechange', { bubbles: true, detail: String(value) })),
          zoom,
        );
      else {
        await page.getByRole('button', { name: '缩放比例' }).click();
        await page.getByRole('option', { name: `${zoom * 100}%`, exact: true }).click();
      }
      await goTo(page, number);
      const measurement = await page.evaluate(
        ({ number, rotation }) => {
          const shell = document.querySelector(`.pdf-page[data-page="${number}"]`),
            span = [...shell.querySelectorAll('.textLayer span')].find((s) =>
              s.textContent.includes('Needle'),
            ),
            bounds = shell.getBoundingClientRect();
          const range = document.createRange();
          const runs = [...shell.querySelectorAll('.textLayer span')].filter((s) => s.textContent);
          range.setStart(runs[0].firstChild, 0);
          range.setEnd(runs.at(-1).firstChild, runs.at(-1).textContent.length);
          const full = range.getBoundingClientRect();
          const index = span.textContent.indexOf('Needle');
          range.setStart(span.firstChild, index);
          range.setEnd(span.firstChild, index + 6);
          const word = range.getBoundingClientRect();
          const canvas = shell.querySelector('.page-canvas'),
            pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          let minX = canvas.width,
            minY = canvas.height,
            maxX = 0,
            maxY = 0;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const i = (y * canvas.width + x) * 4;
              if (pixels[i] < 90 && pixels[i + 1] < 90 && pixels[i + 2] < 90) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
              }
            }
          const ink = {
            left: bounds.left + (minX / canvas.width) * bounds.width,
            right: bounds.left + ((maxX + 1) / canvas.width) * bounds.width,
            top: bounds.top + (minY / canvas.height) * bounds.height,
            bottom: bounds.top + ((maxY + 1) / canvas.height) * bounds.height,
          };
          return {
            full: full.toJSON(),
            word: word.toJSON(),
            ink,
            extent: rotation % 180 ? full.height : full.width,
            wordExtent: rotation % 180 ? word.height : word.width,
            prefix:
              rotation === 270
                ? full.bottom - word.bottom
                : rotation === 90
                  ? word.top - full.top
                  : word.left - full.left,
          };
        },
        { number, rotation: expected[number - 1].rotation },
      );
      const e = expected[number - 1],
        scale = zoom * e.unit;
      expect(
        Math.abs(measurement.extent - e.width * scale),
        `full advance page ${number} zoom ${zoom}`,
      ).toBeLessThan(0.4);
      expect(
        Math.abs(measurement.wordExtent - e.word * scale),
        `word advance page ${number} zoom ${zoom}`,
      ).toBeLessThan(1.2);
      expect(
        Math.abs(measurement.prefix - e.prefix * scale),
        `word position page ${number} zoom ${zoom}`,
      ).toBeLessThan(1.8);
      expect(measurement.ink.left).toBeGreaterThanOrEqual(measurement.full.left - 2);
      expect(measurement.ink.top).toBeGreaterThanOrEqual(measurement.full.top - 2);
      expect(measurement.ink.right).toBeLessThanOrEqual(measurement.full.right + 2);
      expect(measurement.ink.bottom).toBeLessThanOrEqual(measurement.full.bottom + 2);
    }
});
test('search lists all matches, filters them, highlights on each page and navigates to text', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: '查找文字', exact: true }).click();
  await expect(page.getByRole('tab', { name: '查找', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('textbox', { name: '查找文本' }).fill('alpha');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.locator('.search-result')).toHaveCount(9);
  await expect(page.locator('.pdf-page[data-page="1"] .search-hit')).toHaveCount(3);
  await page.getByRole('checkbox', { name: '全字匹配' }).check();
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.locator('.search-result')).toHaveCount(6);
  await page.getByRole('checkbox', { name: '区分大小写' }).check();
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.locator('.search-result')).toHaveCount(0);
  await page.getByRole('textbox', { name: '查找文本' }).fill('Needle');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.locator('.search-result')).toHaveCount(3);
  await page.locator('.search-result').last().click();
  await expect(page.locator('#page-input')).toHaveValue('3');
  await expect(page.locator('.pdf-page[data-page="3"] .search-hit')).toHaveCount(1);
  const mark = await page.locator('.pdf-page[data-page="3"] .search-hit').boundingBox(),
    viewport = await page.locator('#pdf-scroll').boundingBox();
  expect(mark.y).toBeGreaterThanOrEqual(viewport.y);
  expect(mark.y).toBeLessThan(viewport.y + viewport.height);
  expect(
    await page.evaluate(async () => {
      const { all } = await import('/src/js/storage.js');
      return (await all('annotations')).length;
    }),
  ).toBe(0);
  await page.screenshot({ path: 'test-results/search-results-desktop.png', animations: 'disabled' });
});
async function seedAnnotations(page) {
  await page.evaluate(async () => {
    const { all, put } = await import('/src/js/storage.js');
    const doc = (await all('documents'))[0];
    const base = { documentId: doc.id, page: 1, color: '#6370ee', deleted: false, createdAt: Date.now() };
    await put('annotations', {
      ...base,
      id: 'drag-note',
      type: 'note',
      text: 'Drag note',
      x: 0.1,
      y: 0.3,
      fontSize: 12,
    });
    await put('annotations', {
      ...base,
      id: 'drag-text',
      type: 'text',
      text: 'Drag textbox',
      x: 0.1,
      y: 0.5,
      fontSize: 16,
    });
    await put('annotations', {
      ...base,
      id: 'drag-shape',
      type: 'shape',
      shape: 'rectangle',
      start: { x: 0.55, y: 0.45 },
      end: { x: 0.7, y: 0.6 },
      strokeWidth: 2,
    });
  });
  await page.reload();
  await expect(page.locator('[data-annotation-id="drag-text"]')).toBeVisible();
}
async function stored(page, id) {
  return page.evaluate(async (id) => {
    const { get } = await import('/src/js/storage.js');
    return get('annotations', id);
  }, id);
}
test('objects drag within the page; undo/redo locate operations and disable unavailable actions', async ({
  page,
}) => {
  await setup(page);
  await seedAnnotations(page);
  const undo = page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }),
    redo = page.getByRole('button', { name: '重做批注 (Ctrl+Shift+Z)', exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  for (const id of ['drag-note', 'drag-text', 'drag-shape']) {
    const old = await stored(page, id);
    const handle = page.locator(`[data-annotation-id="${id}"]`).first();
    const bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 60, bounds.y + bounds.height / 2 + 35, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () =>
        (await stored(page, id)).type === 'shape'
          ? (await stored(page, id)).start.x
          : (await stored(page, id)).x,
      )
      .toBeGreaterThan(old.start?.x || old.x);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await goTo(page, 2);
  await undo.click();
  await expect(page.locator('#page-input')).toHaveValue('1');
  await expect(redo).toBeEnabled();
  expect((await stored(page, 'drag-shape')).start.x).toBeCloseTo(0.55);
  await goTo(page, 3);
  await redo.click();
  await expect(page.locator('#page-input')).toHaveValue('1');
  await expect(redo).toBeDisabled();
  await page.getByRole('button', { name: '手绘橡皮擦', exact: true }).click();
  const shape = await stored(page, 'drag-shape');
  const ink = page.locator('.pdf-page[data-page="1"] .ink-layer'),
    bounds = await ink.boundingBox();
  await page.mouse.click(
    bounds.x + ((shape.start.x + shape.end.x) / 2) * bounds.width,
    bounds.y + ((shape.start.y + shape.end.y) / 2) * bounds.height,
  );
  await expect.poll(async () => (await stored(page, 'drag-shape')).deleted).toBe(true);
  await goTo(page, 2);
  await undo.click();
  await expect(page.locator('#page-input')).toHaveValue('1');
  expect((await stored(page, 'drag-shape')).deleted).toBe(false);
  await page.reload();
  await expect(page.locator('[data-annotation-id="drag-text"]')).toBeVisible();
  expect((await stored(page, 'drag-text')).x).toBeGreaterThan(0.1);
});
test('narrow navigation floats over the unchanged reader, keeps bottom navigation and dismisses outside', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  const before = await page.locator('#pdf-scroll').boundingBox();
  await page.getByRole('button', { name: '缩略图', exact: true }).click();
  await expect(page.locator('#pdf-navigation')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  const after = await page.locator('#pdf-scroll').boundingBox();
  expect(after.width).toBeCloseTo(before.width, 1);
  await page.getByRole('tab', { name: '查找', exact: true }).click();
  await page.getByRole('textbox', { name: '查找文本' }).fill('Needle');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await expect(page.locator('.search-result')).toHaveCount(9);
  await page.screenshot({ path: 'test-results/search-mobile-overlay.png', animations: 'disabled' });
  await page.locator('.mobile-header').click({ position: { x: 100, y: 20 } });
  await expect(page.locator('#pdf-navigation')).toBeHidden();
  expect((await page.locator('#pdf-scroll').boundingBox()).width).toBeCloseTo(before.width, 1);
});
test('touch dragging moves notes, textboxes and shapes without opening edit dialogs', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await seedAnnotations(page);
  const cdp = await context.newCDPSession(page);
  for (const id of ['drag-note', 'drag-text', 'drag-shape']) {
    const before = await stored(page, id),
      bounds = await page.locator(`[data-annotation-id="${id}"]`).first().boundingBox();
    const x = bounds.x + bounds.width / 2,
      y = bounds.y + bounds.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 4; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 6, y: y + i * 4 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => {
        const row = await stored(page, id);
        return row.start?.x || row.x;
      })
      .toBeGreaterThan(before.start?.x || before.x);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});
test('embedded Chinese fonts and high-DPI text layers use the same glyph advances', async ({ browser }) => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile('public/fonts/NotoSansSC-Regular.otf'), { subset: true });
  const text = '中文 Needle 选区';
  pdf.addPage([612, 792]).drawText(text, { x: 60, y: 650, size: 18, font });
  const expected = [...text].reduce((sum, char) => sum + font.widthOfTextAtSize(char, 18), 0);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.getByRole('button', { name: '先使用在线翻译' }).click();
    await page
      .locator('#pdf-input')
      .setInputFiles({
        name: 'Chinese.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await pdf.save()),
      });
    await expect(page.locator('.textLayer span').first()).toBeVisible();
    const measurements = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.textLayer span')].filter((span) => span.textContent);
      const range = document.createRange();
      range.setStart(spans[0].firstChild, 0);
      range.setEnd(spans.at(-1).firstChild, spans.at(-1).textContent.length);
      const shell = document.querySelector('.pdf-page');
      return {
        width: range.getBoundingClientRect().width,
        scale: shell.clientWidth / 612,
        text: range.toString(),
      };
    });
    expect(measurements.text).toContain('中文');
    expect(Math.abs(measurements.width - expected * measurements.scale)).toBeLessThan(0.6);
  } finally {
    await context.close();
  }
});
