import { test, expect, firefox } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { existsSync } from 'node:fs';

const sample = 'tests/1-s2.0-S0950705126003436-main.pdf';
async function setup(page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
}
async function ready(page, number) {
  await page.waitForFunction(
    (n) => Boolean(document.querySelector(`.pdf-page[data-page="${n}"] .ink-layer`)?.onpointerdown),
    number,
  );
}

test('Firefox keeps the dense sample readable and responsive through all thirteen pages', async ({
  baseURL,
}, testInfo) => {
  test.skip(!existsSync(sample), 'User-provided performance fixture is not present');
  const browser = await firefox.launch({ executablePath: firefox.executablePath() });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      // Firefox waits for a browser permission prompt outside the page in CI.
      navigator.storage.persist = async () => false;
      window.pdfTickGaps = [];
      let last = performance.now();
      setInterval(() => {
        const now = performance.now();
        window.pdfTickGaps.push(now - last);
        last = now;
      }, 20);
    });
    await page.goto(baseURL);
    await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
    await page.evaluate(() => {
      window.pdfTickGaps = [];
    });
    await page.locator('#pdf-input').setInputFiles(sample);
    await ready(page, 1);
    for (let n = 2; n <= 13; n++) {
      await page.evaluate((n) => {
        const scroll = document.getElementById('pdf-scroll');
        scroll.scrollTop = scroll.querySelector(`[data-page="${n}"]`).offsetTop - 18;
      }, n);
      await ready(page, n);
    }
    const maxGap = await page.evaluate(() => Math.max(...window.pdfTickGaps));
    await testInfo.attach('firefox-event-loop.json', {
      body: JSON.stringify({ maxGap }),
      contentType: 'application/json',
    });
    expect(maxGap).toBeLessThan(750);
    await page.getByRole('button', { name: '缩放比例', exact: true }).click();
    await page.getByRole('option', { name: '75%', exact: true }).click();
    await ready(page, 13);
    expect(errors).toEqual([]);
    await expect(page.locator('.toast.error')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('dense-word sample scrolls through every page without per-span forced layouts', async ({
  page,
}, testInfo) => {
  test.skip(!existsSync(sample), 'User-provided performance fixture is not present');
  await page.addInitScript(() => {
    window.pdfLongTasks = [];
    new PerformanceObserver((list) =>
      window.pdfLongTasks.push(...list.getEntries().map((e) => e.duration)),
    ).observe({ type: 'longtask', buffered: true });
  });
  await setup(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => {
    window.pdfLongTasks = [];
  });
  await page.locator('#pdf-input').setInputFiles(sample);
  const pages = [];
  for (let n = 1; n <= 13; n++) {
    const start = Date.now();
    if (n > 1)
      await page.evaluate((n) => {
        const scroll = document.getElementById('pdf-scroll');
        scroll.scrollTop = scroll.querySelector(`[data-page="${n}"]`).offsetTop - 18;
      }, n);
    await ready(page, n);
    pages.push({
      page: n,
      waitMs: Date.now() - start,
      spans: await page.locator(`.pdf-page[data-page="${n}"] .textLayer span`).count(),
    });
  }
  const after = await cdp.send('Performance.getMetrics');
  const metric = (data, key) => data.metrics.find((m) => m.name === key).value;
  const layouts = metric(after, 'LayoutCount') - metric(before, 'LayoutCount');
  const longTasks = await page.evaluate(() => window.pdfLongTasks);
  await testInfo.attach('dense-pdf-performance.json', {
    body: JSON.stringify({ pages, layouts, longTasks }),
    contentType: 'application/json',
  });
  expect(pages.reduce((sum, p) => sum + p.spans, 0)).toBeGreaterThan(20000);
  // Layout count, unlike elapsed time, diagnoses the quadratic read/write loop
  // regardless of hardware. The broken version performs >17,000 for ten pages.
  expect(layouts).toBeLessThan(250);
  expect(Math.max(0, ...longTasks)).toBeLessThan(1000);
  expect(await page.locator('.page-canvas').count()).toBeLessThan(6);
  await page.evaluate(() => {
    document.getElementById('pdf-scroll').scrollTop = 0;
  });
  await ready(page, 1);
  await expect(page.locator('.toast.error')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/dense-pdf-reader.png' });
});

test('missing modern APIs are supplied in both main window and real PDF worker on Chromium', async ({
  page,
}) => {
  const errors = [],
    workers = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workers.push(worker));
  await page.addInitScript(() => {
    function removeModernApis() {
      for (const proto of [Map.prototype, WeakMap.prototype]) {
        delete proto.getOrInsertComputed;
        delete proto.getOrInsert;
      }
      delete Promise.try;
      delete Promise.withResolvers;
      delete Math.sumPrecise;
      delete Uint8Array.fromBase64;
      delete Uint8Array.prototype.toBase64;
      delete ReadableStream.prototype[Symbol.asyncIterator];
      delete ReadableStream.prototype.values;
    }
    removeModernApis();
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        // A separate realm genuinely lacks these APIs before the real entry imports.
        const script = `self.testWorkerSource = ${JSON.stringify(new URL(url, location.href).href)}; (${removeModernApis.toString()})(); await import(self.testWorkerSource);`;
        const objectUrl = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
        super(objectUrl, { ...options, type: 'module' });
        URL.revokeObjectURL(objectUrl);
      }
    };
  });
  await setup(page);
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 3; i++) pdf.addPage().drawText(`Compatible text page ${i + 1}`);
  await page.locator('#pdf-input').setInputFiles({
    name: 'Compatibility.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await ready(page, 1);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await ready(page, 2);
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await ready(page, 2);
  const restored = () =>
    typeof Map.prototype.getOrInsertComputed === 'function' &&
    typeof WeakMap.prototype.getOrInsertComputed === 'function' &&
    typeof Promise.withResolvers === 'function' &&
    typeof ReadableStream.prototype[Symbol.asyncIterator] === 'function';
  expect(await page.evaluate(restored)).toBe(true);
  expect(workers.length).toBeGreaterThan(0);
  const pdfWorker = (
    await Promise.all(
      workers.map(async (worker) => ({ worker, source: await worker.evaluate(() => self.testWorkerSource) })),
    )
  ).find(({ source }) => source?.includes('pdf.worker'))?.worker;
  expect(pdfWorker).toBeTruthy();
  expect(await pdfWorker.evaluate(restored)).toBe(true);
  await expect(page.locator('html')).not.toHaveAttribute('data-apple-webkit', '');
  await expect(page.locator('.toast.error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
