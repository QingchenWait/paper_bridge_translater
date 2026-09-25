import { test, expect, webkit, firefox } from '@playwright/test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';

async function setup(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
}
async function openBasic(page, mobile) {
  await page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action=settings]`).click();
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
  await page.locator('.offline-provider .basic-summary').click();
}
async function uploadPdf(page) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText('This paper presents a new method for machine translation.', { x: 50, y: 700, font, size: 16 });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Offline.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.textLayer span').first()).toBeVisible();
}
async function selectText(page) {
  await page.evaluate(() => {
    const span = document.querySelector('.textLayer span');
    span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
}
for (const mobile of [false, true])
  test(`offline model settings and actual Lite translation on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    const external = [];
    await page.route('https://**/*', (route) => {
      external.push(route.request().url());
      return route.abort();
    });
    await setup(page, mobile);
    await openBasic(page, mobile);
    await expect(page.locator('.offline-model')).toHaveCount(3);
    await expect(page.locator('[data-offline-model=offline-lite] button')).toBeDisabled();
    await expect(page.locator('[data-offline-model=offline-pro]')).toContainText('869.7 MiB');
    await page.getByRole('button', { name: '默认基础翻译模型', exact: true }).click();
    await expect(page.getByRole('option', { name: '中英翻译 Plus', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: '中英翻译 Lite', exact: true }).click();
    await page.screenshot({ path: `test-results/offline-${mobile ? 'mobile' : 'desktop'}.png` });
    expect(await page.locator('.modal').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    await page.keyboard.press('Escape');
    await uploadPdf(page);
    if (mobile) await page.locator('[data-mobile-pane="assistant"]').click();
    await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
    await expect(page.getByRole('option', { name: '本地引擎 · 中英翻译 Lite', exact: true })).toBeVisible();
    await page.getByRole('option', { name: '本地引擎 · 中英翻译 Lite', exact: true }).click();
    if (mobile) await page.locator('[data-mobile-pane="reader"]').click();
    await page.locator('.textLayer span').first().waitFor();
    await selectText(page);
    await expect(page.locator('#selection-result')).toContainText('机器翻译', { timeout: 30000 });
    expect(external).toEqual([]);
    await page.reload();
    await page.locator('.textLayer span').first().waitFor();
    await selectText(page);
    await expect(page.locator('#selection-result')).toContainText('机器翻译');
  });

test('loading status, single-word offline path, rejected language pair and cancellation', async ({
  page,
}) => {
  await page.route('**/offline/lite/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await route.continue().catch(() => {});
  });
  await setup(page);
  await page.evaluate(async () => {
    const { saveBasicTranslation } = await import('/src/js/settings.js');
    await saveBasicTranslation((current) => ({ ...current, defaultProvider: 'offline-lite' }));
  });
  await uploadPdf(page);
  await selectText(page);
  await expect(page.getByRole('status').filter({ hasText: '离线机翻模型加载中' })).toBeVisible();
  await expect(page.locator('#selection-result')).toContainText('机器翻译', { timeout: 30000 });
  const result = await page.evaluate(async () => {
    const { offlineTranslate } = await import('/src/js/offline-translation.js');
    const word = await offlineTranslate('science', {
      provider: 'offline-lite',
      source: 'en',
      target: 'zh-CN',
    });
    let direction;
    try {
      await offlineTranslate('science', { provider: 'offline-lite', source: 'en', target: 'ja' });
    } catch (e) {
      direction = e.message;
    }
    const controller = new AbortController();
    const pending = offlineTranslate('This is a long passage. '.repeat(100), {
      provider: 'offline-lite',
      source: 'en',
      target: 'zh-CN',
      signal: controller.signal,
    });
    controller.abort();
    let aborted;
    try {
      await pending;
    } catch (e) {
      aborted = e.name;
    }
    return { word, direction, aborted };
  });
  expect(result.word).toContain('科学');
  expect(result.direction).toContain('仅支持');
  expect(result.aborted).toBe('AbortError');
});

test('failed or cancelled download never appears installed and preserves settings and documents', async ({
  page,
}) => {
  await setup(page);
  await page.route('https://modelscope.cn/**', (route) => route.fulfill({ status: 200, body: 'bad model' }));
  await openBasic(page, false);
  await page.locator('[data-offline-model=offline-plus] [data-offline-action=install]').click();
  await expect(page.locator('.toast').last()).toContainText('大小不匹配');
  await expect(page.locator('[data-offline-model=offline-plus] [data-offline-action=delete]')).toHaveCount(0);
  await page.unroute('https://modelscope.cn/**');
  await page.route('https://modelscope.cn/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.abort().catch(() => {});
  });
  await page.locator('[data-offline-model=offline-plus] [data-offline-action=install]').click();
  await page.locator('[data-offline-model=offline-plus] [data-offline-action=cancel]').click();
  await expect(page.locator('[data-offline-model=offline-plus] [data-offline-action=install]')).toBeEnabled();
  expect(
    await page.evaluate(
      async () =>
        (await (await import('/src/js/settings.js')).getSettings()).basicTranslation.defaultProvider,
    ),
  ).toBe('mymemory');
});

for (const modelId of ['offline-plus', 'offline-pro'])
  test(`cancelling ${modelId} removes only its partial cache`, async ({ page }) => {
    await setup(page);
    await page.evaluate(async () => {
      const { offlineTranslate } = await import('/src/js/offline-translation.js');
      await offlineTranslate('A local model.', { provider: 'offline-lite', source: 'en', target: 'zh-CN' });
    });
    const snapshot = await page.evaluate(async (modelId) => {
      const { database } = await import('/src/js/storage.js');
      const { putAsset, loadAsset } = await import('/src/js/offline/store.js');
      const manifest = await fetch('/offline/manifest.json').then((r) => r.json());
      const model = manifest.models.find((model) => model.id === modelId);
      // The first completed file is present; the next download will hang.
      const partial = model.files[0];
      await putAsset(partial, new Blob([new Uint8Array(partial.bytes)]));
      for (const file of manifest.runtimes.filter((file) => file.engine === 'onnx'))
        await loadAsset(file, new URL('/offline/', location.href).href);
      const unrelated = { sha256: 'other-model-sentinel' };
      await putAsset(unrelated, new Blob(['other model kept']));
      const personal = await database();
      const saved = {};
      for (const store of ['documents', 'files', 'annotations', 'messages', 'settings']) {
        await personal.put(store, { id: 'cancel-sentinel', value: `kept-${store}` });
        saved[store] = await personal.getAll(store);
      }
      return saved;
    }, modelId);
    let started;
    const requested = new Promise((done) => {
      started = done;
    });
    await page.context().route('https://modelscope.cn/**', async (route) => {
      started();
      await new Promise((done) => setTimeout(done, 2500));
      await route.abort().catch(() => {});
    });
    await openBasic(page, false);
    await page.locator(`[data-offline-model=${modelId}] [data-offline-action=install]`).click();
    await requested;
    await page.locator(`[data-offline-model=${modelId}] [data-offline-action=cancel]`).click();
    await expect(page.locator(`[data-offline-model=${modelId}] [data-offline-action=install]`)).toBeEnabled();
    const after = await page.evaluate(async (modelId) => {
      const { database } = await import('/src/js/storage.js');
      const manifest = await fetch('/offline/manifest.json').then((r) => r.json());
      const { getAsset } = await import('/src/js/offline/store.js');
      const model = manifest.models.find((model) => model.id === modelId);
      const personal = await database();
      const saved = {};
      for (const store of ['documents', 'files', 'annotations', 'messages', 'settings'])
        saved[store] = await personal.getAll(store);
      return {
        saved,
        removed: (await getAsset(model.files[0])) === undefined,
        shared: (await getAsset(manifest.models[0].files.find((file) => file.role === 'srcVocab')))?.size,
        unrelated: await (await getAsset({ sha256: 'other-model-sentinel' })).text(),
      };
    }, modelId);
    expect(after.saved).toEqual(snapshot);
    expect(after.removed).toBe(true);
    expect(after.shared).toBe(806952);
    expect(after.unrelated).toBe('other model kept');
  });

test('live ModelScope OPUS download and NLLB browser CORS', async ({ page }) => {
  test.skip(
    process.env.PAPER_BRIDGE_TEST_LIVE_SOURCES !== '1',
    'Opt in to downloading OPUS-MT and probing real NLLB files from ModelScope.',
  );
  test.setTimeout(240000);
  await setup(page);
  const result = await page.evaluate(async () => {
    const registry = await fetch('/offline/manifest.json').then((r) => r.json());
    const { manageOfflineModel, offlineTranslate } = await import('/src/js/offline-translation.js');
    await manageOfflineModel('offline-plus', 'install');
    const text = await offlineTranslate('This paper presents a new method.', {
      provider: 'offline-plus',
      source: 'en',
      target: 'zh-CN',
    });
    const probes = [];
    for (const file of registry.models.find((model) => model.id === 'offline-pro').files) {
      const response = await fetch(file.url, {
        cache: 'no-store',
        credentials: 'omit',
        headers: { Range: 'bytes=0-31' },
      });
      const reader = response.body.getReader();
      const { value } = await reader.read();
      await reader.cancel();
      probes.push({ ok: response.ok, bytes: value?.length || 0 });
    }
    await manageOfflineModel('offline-plus', 'delete');
    return { text, probes };
  });
  expect(result.text).toMatch(/[\u4e00-\u9fff]/);
  expect(result.probes).toHaveLength(6);
  expect(result.probes.every((probe) => probe.ok && probe.bytes > 0)).toBe(true);
});

for (const name of ['firefox', 'webkit'])
  test(`real Lite CPU inference in ${name}`, async ({ baseURL }) => {
    await mkdir('.cache', { recursive: true });
    const engine = name === 'firefox' ? firefox : webkit;
    const context = await engine.launchPersistentContext(await mkdtemp(`.cache/offline-${name}-`), {
      headless: true,
      executablePath: engine.executablePath(),
    });
    try {
      const page = await context.newPage();
      await page.goto(baseURL);
      const result = await page.evaluate(async () => {
        const { offlineTranslate } = await import('/src/js/offline-translation.js');
        return offlineTranslate('This paper presents a new method.', {
          provider: 'offline-lite',
          source: 'en',
          target: 'zh-CN',
        });
      });
      expect(result).toMatch(/[\u4e00-\u9fff]/);
    } finally {
      await context.close();
    }
  });

test('real optional OPUS/NLLB import, inference, reload and deletion', async ({ page }) => {
  test.skip(
    !process.env.PAPER_BRIDGE_TEST_MODEL_DIR,
    'Set PAPER_BRIDGE_TEST_MODEL_DIR to a prepared offline-plus/offline-pro fixture directory.',
  );
  test.setTimeout(240000);
  await setup(page);
  await openBasic(page, false);
  const manifest = JSON.parse(await readFile('public/offline/manifest.json'));
  for (const model of manifest.models.filter((m) => !m.bundled)) {
    const chooser = page.waitForEvent('filechooser');
    await page.locator(`[data-offline-model=${model.id}] [data-offline-action=import]`).click();
    await (
      await chooser
    ).setFiles(
      model.files.map(
        (file) =>
          `${process.env.PAPER_BRIDGE_TEST_MODEL_DIR}/${model.id}/${file.path}${model.engine === 'bergamot' ? '.gz' : ''}`,
      ),
    );
    await expect(page.locator(`[data-offline-model=${model.id}] [data-offline-action=delete]`)).toBeVisible({
      timeout: 180000,
    });
    const translated = await page.evaluate(async (id) => {
      const { offlineTranslate } = await import('/src/js/offline-translation.js');
      return offlineTranslate(
        id === 'offline-pro' ? 'Bonjour le monde.' : 'This paper presents a new method.',
        { provider: id, source: id === 'offline-pro' ? 'fr' : 'en', target: 'zh-CN' },
      );
    }, model.id);
    expect(translated).toMatch(/[\u4e00-\u9fff]/);
    await page.getByRole('button', { name: '默认基础翻译模型', exact: true }).click();
    await page.getByRole('option', { name: model.name, exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('默认基础翻译模型已保存');
    await page.reload();
    await openBasic(page, false);
    await expect(page.locator('[data-select=basic-default]')).toHaveAttribute('data-value', model.id);
    await page.locator(`[data-offline-model=${model.id}] [data-offline-action=delete]`).click();
    await expect(page.locator('[data-select=basic-default]')).toHaveAttribute('data-value', 'offline-lite');
  }
});
