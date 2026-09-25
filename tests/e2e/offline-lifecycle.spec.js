import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

async function observeWorkers(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.modelWorkers = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.record = { url: String(url), requests: [], responses: [], terminated: false };
        window.modelWorkers.push(this.record);
        this.addEventListener('message', ({ data }) => this.record.responses.push(data));
      }
      postMessage(message, ...args) {
        this.record.requests.push({ id: message.id, type: message.type, modelId: message.modelId });
        return super.postMessage(message, ...args);
      }
      terminate() {
        this.record.terminated = true;
        return super.terminate();
      }
    };
  });
}
const workers = (page) =>
  page.evaluate(() =>
    window.modelWorkers.filter((worker) =>
      worker.requests.some((request) => request.type === 'load' || request.type === 'translate'),
    ),
  );
async function entered(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await observeWorkers(page);
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function choose(page, name, mobile = false) {
  if (mobile) await page.locator('.mobile-nav [data-mobile-pane=assistant]').click();
  await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
  await expect(page.locator('#selection-engine .select-trigger')).toHaveAttribute('title', name);
}
async function ready(page, modelId) {
  await expect
    .poll(
      async () =>
        (await workers(page)).some(
          (worker) =>
            !worker.terminated &&
            worker.requests.some(
              (request) =>
                request.type === 'load' &&
                request.modelId === modelId &&
                worker.responses.some((response) => response.id === request.id && response.result === true),
            ),
        ),
      { timeout: 90000 },
    )
    .toBe(true);
}
async function importPdf(page) {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Offline model loading must not block reading.', { x: 50, y: 700 });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Lifecycle.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.textLayer span').first()).toBeVisible({ timeout: 15000 });
}
async function selectText(page) {
  await page.locator('.textLayer span').first().waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const span = document.querySelector('.textLayer span'),
      range = document.createRange();
    span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
}

for (const mobile of [false, true])
  test(`online startup makes no model request and pending Lite is nonblocking on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    const requests = [];
    let release;
    const gate = new Promise((done) => {
      release = done;
    });
    await page.context().route(/\/offline\/(lite|bergamot|onnx)\//, async (route) => {
      requests.push(route.request().url());
      await gate;
      await route.continue().catch(() => {});
    });
    try {
      await entered(page, mobile);
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.modelWorkers.some(
              (worker) =>
                worker.requests.some((request) => request.type === 'list') && worker.responses.length > 0,
            ),
          ),
        )
        .toBe(true);
      expect(await workers(page)).toHaveLength(0);
      expect(requests).toEqual([]);
      await choose(page, '本地引擎 · 中英翻译 Lite', mobile);
      await expect.poll(() => requests.length).toBeGreaterThan(0);
      if (mobile) await page.locator('.mobile-nav [data-mobile-pane=reader]').click();
      await page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action=settings]`).click();
      await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
      await expect(page.getByRole('button', { name: '默认基础翻译模型', exact: true })).toBeEnabled();
      await page.keyboard.press('Escape');
      await importPdf(page);
      await selectText(page);
      if (mobile) await page.locator('.mobile-nav [data-mobile-pane=assistant]').click();
      await expect(page.locator('.inline-loading')).toContainText('离线机翻模型加载中');
      await page.route('https://translate.googleapis.com/**', (route) =>
        route.fulfill({ json: [[['在线翻译仍可使用']]] }),
      );
      await choose(page, 'Google 翻译（仅海外可访问）', mobile);
      await expect.poll(async () => (await workers(page)).every((worker) => worker.terminated)).toBe(true);
      await expect(page.locator('.inline-loading')).toHaveCount(0);
      await expect(page.locator('.error-card')).toHaveCount(0);
      expect(
        await page.evaluate(async () => {
          try {
            await (
              await import('/src/js/offline-translation.js')
            ).offlineTranslate('Old request', { provider: 'offline-lite', source: 'en', target: 'zh-CN' });
            return '';
          } catch (error) {
            return error.name;
          }
        }),
      ).toBe('AbortError');
      if (mobile) await page.locator('.mobile-nav [data-mobile-pane=reader]').click();
      await selectText(page);
      await expect(page.locator('#selection-result')).toContainText('在线翻译仍可使用');
      release();
      await page.reload();
      await expect
        .poll(() => page.evaluate(() => window.modelWorkers.some((worker) => worker.responses.length > 0)))
        .toBe(true);
      expect(await workers(page)).toHaveLength(0);
    } finally {
      release();
    }
  });

test('loaded Lite stays ready, switches release it and reselect uses intact disk cache', async ({ page }) => {
  await entered(page);
  await choose(page, '本地引擎 · 中英翻译 Lite');
  await ready(page, 'offline-lite');
  await page.evaluate(async () => {
    const { saveSettings } = await import('/src/js/settings.js');
    await saveSettings({ translationStyle: '忠实直译' });
  });
  expect(await workers(page)).toHaveLength(1);
  const stored = await page.evaluate(async () => {
    const manifest = await fetch('/offline/manifest.json').then((response) => response.json());
    const { getAsset } = await import('/src/js/offline/store.js');
    return Promise.all(
      manifest.models[0].files.map(async (file) => [file.sha256, (await getAsset(file))?.size]),
    );
  });
  await choose(page, 'MyMemory (额度有限)');
  await expect.poll(async () => (await workers(page))[0].terminated).toBe(true);
  const after = await page.evaluate(async () => {
    const manifest = await fetch('/offline/manifest.json').then((response) => response.json());
    const { getAsset } = await import('/src/js/offline/store.js');
    return Promise.all(
      manifest.models[0].files.map(async (file) => [file.sha256, (await getAsset(file))?.size]),
    );
  });
  expect(after).toEqual(stored);
  await page.route('**/offline/lite/**', (route) => route.abort());
  await choose(page, '本地引擎 · 中英翻译 Lite');
  await ready(page, 'offline-lite');
  expect(await workers(page)).toHaveLength(2);
  await page.reload();
  await ready(page, 'offline-lite');
  expect(await workers(page)).toHaveLength(1);
  await page.evaluate(async () => {
    const { saveSettings } = await import('/src/js/settings.js');
    await saveSettings({
      translationEngine: 'llm',
      chatProviders: [{ id: 'llm', name: 'LLM', baseUrl: 'https://example.test', model: 'test' }],
      translationProviderId: 'llm',
    });
  });
  await expect.poll(async () => (await workers(page))[0].terminated).toBe(true);
  await page.reload();
  await expect(page.locator('#selection-engine .select-trigger')).toHaveAttribute('title', 'LLM · test');
  expect(await workers(page)).toHaveLength(0);
});

test('saved Lite selection allows entry while its cold model request is held', async ({ page }) => {
  await entered(page);
  let release;
  const held = new Promise((done) => {
    release = done;
  });
  await page.context().route('**/offline/bergamot/**', async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  try {
    await page.evaluate(async () => {
      const { saveSettings } = await import('/src/js/settings.js');
      await saveSettings({ basicTranslation: { defaultProvider: 'offline-lite' } });
    });
    await page.reload();
    await expect(page.locator('.sidebar [data-action=settings]')).toBeEnabled();
    await expect
      .poll(async () =>
        (await workers(page)).some((worker) =>
          worker.requests.some((request) => request.type === 'load' && request.modelId === 'offline-lite'),
        ),
      )
      .toBe(true);
    await page.locator('.sidebar [data-action=settings]').click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await choose(page, 'MyMemory (额度有限)');
    await expect.poll(async () => (await workers(page)).every((worker) => worker.terminated)).toBe(true);
  } finally {
    release();
  }
});

test('Plus and Pro load only when selected and release their previous worker', async ({ page }) => {
  test.skip(!process.env.PAPER_BRIDGE_TEST_MODEL_DIR, 'Use verified optional model fixtures.');
  test.setTimeout(240000);
  await entered(page);
  const registry = JSON.parse(await readFile('public/offline/manifest.json'));
  await page.locator('.sidebar [data-action=settings]').click();
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
  await page.locator('.offline-provider .basic-summary').click();
  for (const model of registry.models.filter((model) => !model.bundled)) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator(`[data-offline-model=${model.id}] [data-offline-action=import]`).click();
    await (
      await chooser
    ).setFiles(
      model.files.map((file) => `${process.env.PAPER_BRIDGE_TEST_MODEL_DIR}/${model.id}/${file.path}`),
    );
    await expect(page.locator(`[data-offline-model=${model.id}] [data-offline-action=delete]`)).toBeVisible({
      timeout: 120000,
    });
  }
  expect(await workers(page)).toHaveLength(0);
  await page.keyboard.press('Escape');
  for (const model of registry.models) {
    const previous = (await workers(page)).length;
    await choose(page, `本地引擎 · ${model.name}`);
    await ready(page, model.id);
    const live = await workers(page);
    expect(live).toHaveLength(previous + 1);
    expect(live.filter((worker) => !worker.terminated)).toHaveLength(1);
    const text = await page.evaluate(
      async (provider) =>
        (await import('/src/js/offline-translation.js')).offlineTranslate(
          'This paper presents a new method.',
          { provider, source: 'en', target: 'zh-CN' },
        ),
      model.id,
    );
    expect(text).toMatch(/[\u4e00-\u9fff]/);
  }
  await choose(page, 'MyMemory (额度有限)');
  await expect.poll(async () => (await workers(page)).every((worker) => worker.terminated)).toBe(true);
});
