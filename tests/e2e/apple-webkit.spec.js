import { test, expect, webkit } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// WebKit on Windows cannot store Blob in ephemeral contexts; a temporary
// persistent profile exercises real IndexedDB without changing application data.
const modes = [
  { name: 'macOS Safari', viewport: { width: 1440, height: 900 }, touch: false },
  { name: 'iPad desktop identity', viewport: { width: 820, height: 1180 }, touch: true, ipad: true },
  { name: 'iPhone Safari', viewport: { width: 390, height: 844 }, touch: true },
];
for (const mode of modes)
  test(`Apple compatibility renders, selects and edits with missing APIs on ${mode.name}`, async ({
    baseURL,
  }) => {
    const browserType = webkit;
    await mkdir('.cache', { recursive: true });
    const context = await browserType.launchPersistentContext(await mkdtemp('.cache/apple-webkit-'), {
      headless: true,
      executablePath: browserType.executablePath(),
      timeout: 20000,
      viewport: mode.viewport,
      hasTouch: mode.touch,
      isMobile: mode.touch,
      userAgent:
        mode.touch && !mode.ipad
          ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_3 like Mac OS X) AppleWebKit/605.1.15 Version/26.3 Mobile/15E148 Safari/604.1'
          : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
    });
    const page = await context.newPage(),
      failures = [],
      workers = [];
    page.on('pageerror', (e) => failures.push(e.message));
    page.on('worker', (worker) => workers.push(worker.url()));
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, 'platform', {
        value: mode.touch ? (mode.ipad ? 'MacIntel' : 'iPhone') : 'MacIntel',
      });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: mode.touch ? 5 : 0 });
      for (const proto of [Map.prototype, WeakMap.prototype]) {
        delete proto.getOrInsertComputed;
        delete proto.getOrInsert;
      }
      delete Promise.try;
      delete Promise.withResolvers;
      delete Math.sumPrecise;
      delete Uint8Array.prototype.toBase64;
      delete Uint8Array.fromBase64;
      delete ReadableStream.prototype[Symbol.asyncIterator];
      delete ReadableStream.prototype.values;
    }, mode);
    try {
      await page.goto(baseURL);
      await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
      await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-apple-webkit', '');
      let calls = 0;
      await page.route('https://api.mymemory.translated.net/**', (route) => {
        calls++;
        return route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '测试翻译' } } });
      });
      const pdf = await PDFDocument.create(),
        font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let n = 1; n <= 3; n++)
        pdf.addPage([612, 792]).drawText(`Safari words page ${n}`, { x: 60, y: 650, size: 18, font });
      await page.locator('#pdf-input').setInputFiles({
        name: 'Apple.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(await pdf.save()),
      });
      await expect(page.locator('.textLayer span').first()).toBeVisible();
      expect(workers.some((url) => url.includes('apple-pdf.worker'))).toBe(true);
      await expect(page.locator('.toast.error')).toHaveCount(0);
      const first = page.locator('.pdf-page[data-page="1"]');
      const width = await first.evaluate((el) => el.getBoundingClientRect().width);
      await page.getByRole('button', { name: '缩放比例', exact: true }).click();
      const menu = page.locator('.apple-select-portal');
      await expect(menu).toBeVisible();
      expect(
        await menu.evaluate((el) => {
          const r = el.querySelector('[data-value="0.75"]').getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
      ).toBe(true);
      await page.getByRole('option', { name: '75%', exact: true }).click();
      await expect.poll(() => first.evaluate((el) => el.getBoundingClientRect().width)).toBeCloseTo(459, 0);
      await expect(first.locator('.textLayer span').first()).toBeVisible();
      expect(await first.evaluate((el) => el.getBoundingClientRect().width)).not.toBe(width);
      await page.getByRole('button', { name: '放大', exact: true }).click();
      await expect(first.locator('.textLayer span').first()).toBeVisible();
      await page.getByRole('button', { name: '缩小', exact: true }).click();
      await expect(first.locator('.textLayer span').first()).toBeVisible();
      await page.getByRole('button', { name: '下一页', exact: true }).click();
      await expect(page.locator('#page-input')).toHaveValue('2');
      await expect(page.locator('.pdf-page[data-page="2"] .textLayer span').first()).toBeVisible();
      await page.getByRole('button', { name: '上一页', exact: true }).click();
      await page.getByRole('button', { name: '缩放比例', exact: true }).click();
      await page.getByRole('option', { name: '适应宽度', exact: true }).click();
      await expect(first.locator('.textLayer span').first()).toBeVisible();
      const selection = await page.evaluate(() => {
        const span = document.querySelector('.textLayer span'),
          r = span.getBoundingClientRect();
        const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const range = document.createRange();
        range.setStart(span.firstChild, 0);
        range.setEnd(span.firstChild, 6);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return {
          text: getSelection().toString(),
          target: target?.tagName,
          selectable: getComputedStyle(span).webkitUserSelect,
          canvas: getComputedStyle(document.querySelector('.page-canvas')).pointerEvents,
        };
      });
      expect(selection).toMatchObject({ text: 'Safari', target: 'SPAN', selectable: 'text', canvas: 'none' });
      await page.getByRole('button', { name: '手绘笔迹', exact: true }).click();
      expect(await page.evaluate(() => getSelection().toString())).toBe('');
      const draw = async () => {
        if (mode.touch)
          await page.locator('.pdf-page[data-page="1"] .ink-layer').evaluate((canvas) => {
            const r = canvas.getBoundingClientRect(),
              params = { pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true, button: 0 };
            canvas.setPointerCapture = () => {};
            canvas.dispatchEvent(
              new PointerEvent('pointerdown', {
                ...params,
                clientX: r.x + r.width * 0.25,
                clientY: r.y + r.height * 0.4,
              }),
            );
            canvas.dispatchEvent(
              new PointerEvent('pointermove', {
                ...params,
                clientX: r.x + r.width * 0.5,
                clientY: r.y + r.height * 0.45,
              }),
            );
            canvas.dispatchEvent(
              new PointerEvent('pointerup', {
                ...params,
                clientX: r.x + r.width * 0.5,
                clientY: r.y + r.height * 0.45,
              }),
            );
          });
        else {
          const r = await first.boundingBox();
          await page.mouse.move(r.x + r.width * 0.25, r.y + r.height * 0.4);
          await page.mouse.down();
          await page.mouse.move(r.x + r.width * 0.5, r.y + r.height * 0.45, { steps: 5 });
          await page.mouse.up();
        }
      };
      const count = (type) =>
        page.evaluate(
          async (type) =>
            (await (await import('/src/js/storage.js')).all('annotations')).filter(
              (a) => a.type === type && !a.deleted,
            ).length,
          type,
        );
      await draw();
      await expect.poll(() => count('pen')).toBe(1);
      await page.getByRole('button', { name: '形状绘制', exact: true }).click();
      await draw();
      await expect.poll(() => count('shape')).toBe(1);
      await page.getByRole('button', { name: '添加文本框', exact: true }).click();
      const ink = first.locator('.ink-layer');
      if (mode.touch) {
        const r = await ink.boundingBox();
        await page.touchscreen.tap(r.x + r.width * 0.3, r.y + r.height * 0.6);
      } else await ink.click({ position: { x: 100, y: 330 } });
      await page.locator('.annotation-input').fill('Safari 中文编辑');
      await page.locator('#document-status').click();
      await expect.poll(() => count('text')).toBe(1);
      expect(calls).toBe(0);
      await page.screenshot({
        path: `test-results/apple-${mode.touch ? (mode.ipad ? 'ipad' : 'iphone') : 'mac'}.png`,
        animations: 'disabled',
      });
      await page.reload();
      await expect(page.locator('.annotation-text')).toContainText('Safari 中文编辑');
      await expect(page.locator('.toast.error')).toHaveCount(0);
      expect(failures).toEqual([]);
    } finally {
      await context.close();
    }
  });
