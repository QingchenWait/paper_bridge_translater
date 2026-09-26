import { test as base, expect, firefox, webkit } from '@playwright/test';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const engine = { firefox, webkit }[process.env.PAPER_BRIDGE_SMOKE_ENGINE];
const test = base.extend({
  context: async ({ context, baseURL, viewport, hasTouch }, use) => {
    if (engine !== webkit || process.platform !== 'win32') return use(context);
    // Windows WebKit needs a persistent profile to store real PDF Blobs in IndexedDB.
    await mkdir('.cache', { recursive: true });
    const persistent = await webkit.launchPersistentContext(await mkdtemp('.cache/layout-webkit-'), {
      headless: true,
      executablePath: webkit.executablePath(),
      baseURL,
      viewport,
      hasTouch,
    });
    try {
      await use(persistent);
    } finally {
      await persistent.close();
    }
  },
});
if (engine)
  test.use({ browserName: engine.name(), launchOptions: { executablePath: engine.executablePath() } });

async function enter(page) {
  if (engine === firefox)
    await page.addInitScript(() => {
      navigator.storage.persist = async () => false;
    });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
}
async function importFiles(page, first, count) {
  const files = [];
  for (let i = first; i < first + count; i++) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.setTitle(`Paper ${i}`);
    files.push({
      name: `Research paper ${i}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(await pdf.save()),
    });
  }
  await page.locator('#pdf-input').setInputFiles(files);
  await expect(page.locator('.document-tab')).toHaveCount(first + count, { timeout: 30000 });
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
}

for (const [name, viewport] of [
  ['desktop', { width: 1600, height: 900 }],
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1000 }],
]) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch: viewport.width <= 960 });
    test('overflow tabs reveal new files, scroll without activating or closing them, and recover after resize', async ({
      page,
    }) => {
      await enter(page);
      await importFiles(page, 0, 1);
      const left = page.getByRole('button', { name: '向左滚动文件卡片', exact: true });
      const right = page.getByRole('button', { name: '向右滚动文件卡片', exact: true });
      const tabs = page.locator('#document-tabs');
      await expect(left).toBeHidden();
      await importFiles(page, 1, 8);
      await expect(left).toBeVisible();
      await expect(right).toBeDisabled();
      await expect(left).toBeEnabled();
      const activeVisible = () =>
        tabs.evaluate((el) => {
          const frame = el.getBoundingClientRect(),
            card = el.querySelector('.active').getBoundingClientRect();
          return card.left >= frame.left - 1 && card.right <= frame.right + 1;
        });
      await expect.poll(activeVisible).toBe(true);
      if (viewport.width > 960) {
        const arrow = await right.boundingBox(),
          open = await page.locator('.document-bar > .open-pdf').boundingBox();
        expect(arrow.x + arrow.width).toBeLessThanOrEqual(open.x);
      }
      await left.click();
      await expect(right).toBeEnabled();
      const box = await tabs.boundingBox();
      const before = await tabs.evaluate((el) => el.scrollLeft);
      await page.mouse.move(box.x + 30, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 130, box.y + box.height / 2, { steps: 10 });
      await page.mouse.up();
      await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeLessThan(before);
      await expect(page.locator('.document-tab')).toHaveCount(9);
      await expect(page.locator('.document-tab.active')).toContainText('paper 8.pdf');
      await tabs.focus();
      await page.keyboard.press('Home');
      await expect(left).toBeDisabled();
      await expect(right).toBeEnabled();
      await right.click();
      await expect(left).toBeEnabled();
      await tabs.focus();
      await page.keyboard.press('Home');
      await expect(left).toBeDisabled();
      if (name === 'phone' && !engine) {
        const cdp = await page.context().newCDPSession(page);
        const y = box.y + box.height / 2,
          x = box.x + box.width - 30;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 6; step++)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x - step * 20, y }],
          });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => tabs.evaluate((el) => el.scrollLeft)).toBeGreaterThan(10);
        await expect(page.locator('.document-tab.active')).toContainText('paper 8.pdf');
        await cdp.detach();
      }
      await importFiles(page, 9, 1);
      await expect.poll(activeVisible).toBe(true);
      await expect(right).toBeDisabled();
      await page.locator('.document-tab.active .tab-close').click();
      await expect(page.locator('.document-tab')).toHaveCount(9);
      await expect(page.locator('.document-tab.active')).toContainText('paper 8.pdf');
      await expect.poll(activeVisible).toBe(true);
      await page.screenshot({ path: `test-results/tabs-overflow-${name}.png` });
      await page.setViewportSize({ width: 3840, height: 2160 });
      await expect(left).toBeHidden();
      await page.setViewportSize(viewport);
      await expect(left).toBeVisible();
      // Removing tabs changes overflow without changing document storage.
      for (let count = 9; count > 1; count--) {
        await page.locator('.document-tab.active .tab-close').click();
        await expect(page.locator('.document-tab')).toHaveCount(count - 1);
        await expect(tabs).toHaveAttribute('aria-busy', 'false');
      }
      await expect(left).toBeHidden();
      await expect(right).toBeHidden();
      await page.setViewportSize({ width: 1000, height: 650 });
      await expect.poll(activeVisible).toBe(true);
      expect(
        await page.evaluate(async () => (await (await import('/src/js/storage.js')).all('documents')).length),
      ).toBe(10);
    });

    test('settings navigation stays visible while long forms scroll and tabs remain usable', async ({
      page,
    }) => {
      await enter(page);
      await page
        .locator(`${viewport.width > 960 ? '.sidebar' : '.mobile-nav'} [data-action="settings"]`)
        .click();
      await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
      await page.locator('.offline-provider .basic-summary').click();
      for (const summary of await page.locator('.basic-provider > summary').all()) {
        if (await summary.evaluate((el) => !el.parentElement.open)) await summary.click();
      }
      const content = page.locator('#settings-content'),
        nav = page.locator('.settings-nav');
      const before = await nav.boundingBox();
      await expect
        .poll(() => content.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(50);
      await content.hover();
      await page.mouse.wheel(0, 1500);
      await expect.poll(() => content.evaluate((el) => el.scrollTop)).toBeGreaterThan(30);
      const after = await nav.boundingBox();
      expect(Math.abs(before.y - after.y)).toBeLessThan(1);
      for (const button of await nav.getByRole('button').all()) await expect(button).toBeInViewport();
      expect(await page.locator('.settings-modal').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
        false,
      );
      await page.screenshot({ path: `test-results/settings-scroll-${name}.png` });
      await page.getByRole('button', { name: '关于与帮助', exact: true }).click();
      await expect(page.getByRole('button', { name: '关于与帮助', exact: true })).toHaveClass(/active/);
      await page.getByRole('button', { name: '模型与 API', exact: true }).click();
      await expect(page.getByRole('heading', { name: '连接你的 AI', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  });
}
