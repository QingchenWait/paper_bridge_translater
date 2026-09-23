import { test, expect } from '@playwright/test';

const stored = (page) =>
  page.evaluate(async () => (await (await import('/src/js/storage.js')).get('settings', 'app'))?.value);
async function setup(page) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function settings(page, mobile = false) {
  await page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action="settings"]`).click();
}
async function add(page, name) {
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

for (const mobile of [false, true])
  test(`welcome copy, author link, centered buttons and opt-out close on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '纸间 · 文献翻译 & AI 分析', exact: true })).toBeVisible();
    await expect(page.locator('.welcome')).toContainText('LLM 划词翻译 | PDF 标注编辑 | AI 文献问答');
    await expect(page.locator('.welcome')).toContainText('青尘工作室');
    const author = page.getByRole('link', { name: '@CyanDust_青尘', exact: true });
    await page
      .context()
      .route('https://space.bilibili.com/385556208', (route) =>
        route.fulfill({ body: 'Author page fixture' }),
      );
    const opening = page.waitForEvent('popup');
    await author.click();
    const popup = await opening;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://space.bilibili.com/385556208');
    expect(await popup.evaluate(() => opener === null)).toBe(true);
    await popup.close();
    const layout = await page.evaluate(() => {
      const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
      const left = rect('.welcome-actions button:first-child'),
        right = rect('.welcome-actions button:last-child'),
        actions = rect('.welcome-actions'),
        preference = rect('.onboarding-preference'),
        body = rect('.onboarding-modal .modal-body');
      return {
        offset: Math.abs((left.left + right.right) / 2 - (actions.left + actions.width / 2)),
        preferenceWidth: preference.width,
        bodyWidth: body.width,
        rightGap: body.right - preference.right,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.offset).toBeLessThan(3);
    expect(layout.preferenceWidth).toBeLessThan(layout.bodyWidth / 2);
    expect(layout.rightGap).toBeLessThan(36);
    expect(layout.overflow).toBe(false);
    await page.screenshot({ path: `test-results/welcome-revised-${mobile ? 'mobile' : 'desktop'}.png` });
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(author).toBeVisible(); // Closing alone is not opting out.
    await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect.poll(async () => (await stored(page))?.hideOnboarding).toBe(true);
    await page.reload();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

test('all loading rings have a normal period even when reduced motion is requested', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'test-rings';
    host.innerHTML =
      '<span class="spinner"></span><span class="spinner small"></span><img class="icon icon-spin">';
    document.body.append(host);
  });
  for (const [mode, duration] of [
    ['no-preference', '1.2s'],
    ['reduce', '1.8s'],
  ]) {
    await page.emulateMedia({ reducedMotion: mode });
    for (const ring of await page.locator('#test-rings > *').all()) {
      await expect(ring).toHaveCSS('animation-duration', duration);
      await expect(ring).toHaveCSS('animation-iteration-count', 'infinite');
      const before = await ring.evaluate((el) => getComputedStyle(el).transform);
      await expect.poll(() => ring.evaluate((el) => getComputedStyle(el).transform)).not.toBe(before);
    }
  }
});

for (const mobile of [false, true])
  test(`LLM fields and options autosave without notices; save-current stays open on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await setup(page);
    await settings(page, mobile);
    await add(page, 'DeepSeek');
    await expect.poll(async () => (await stored(page))?.chatProviders.length).toBe(1);
    const form = page.locator('#provider-form');
    await form.locator('[name="name"]').fill('自动保存配置');
    await expect(page.locator('.provider-chip.active')).toContainText('自动保存配置');
    await form.locator('[name="baseUrl"]').fill('https://model.test/v1');
    await form.locator('[name="apiKey"]').fill('typed-secret');
    await form.locator('[name="model"]').fill('typed-model');
    await expect(form.locator('[name="model"]')).toBeFocused();
    await page.getByRole('button', { name: '接口协议', exact: true }).click();
    await page.getByRole('option', { name: 'Responses API', exact: true }).click();
    await form.locator('[name="pdfInput"]').check();
    await form.locator('[name="pdfOutput"]').check();
    await expect
      .poll(async () => {
        const p = (await stored(page))?.chatProviders[0];
        return p?.apiKey === 'typed-secret' && p?.protocol === 'responses' && p?.pdfInput && p?.pdfOutput;
      })
      .toBe(true);
    await expect(page.locator('.toast')).toHaveCount(0);
    const save = page.getByRole('button', { name: '保存当前设置', exact: true }),
      plus = page.getByRole('button', { name: '添加', exact: true });
    expect((await save.boundingBox()).x).toBeLessThan((await plus.boundingBox()).x);
    await save.click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
    await expect(form.locator('[name="apiKey"]')).toHaveValue('typed-secret');
    await page.screenshot({ path: `test-results/autosave-api-${mobile ? 'mobile' : 'desktop'}.png` });
    await form.locator('[name="apiKey"]').fill('latest-before-close');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect.poll(async () => (await stored(page))?.chatProviders[0]?.apiKey).toBe('latest-before-close');
    await page.reload();
    await settings(page, mobile);
    await expect(page.locator('[name="model"]')).toHaveValue('typed-model');
    await expect(page.locator('[data-select="api-protocol"]')).toHaveAttribute('data-value', 'responses');
  });

test('basic credentials autosave and immediate UI backup contains every key, secret and preference', async ({
  page,
}) => {
  await setup(page);
  await settings(page);
  await add(page, 'DeepSeek');
  await page.locator('[name="apiKey"]').fill('llm-one-secret');
  await add(page, 'Qwen');
  await page.locator('[name="apiKey"]').fill('llm-two-secret');
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
  for (const id of ['baidu', 'aliyun', 'volcengine']) {
    const panel = page.locator(`[data-basic-provider="${id}"]`);
    await panel.locator('.basic-summary').click();
    await panel.locator('[name="keyId"]').fill(`${id}-id`);
    await panel.locator('[name="secret"]').fill(`${id}-secret`);
    await expect
      .poll(async () => (await stored(page))?.basicTranslation.providers[id].secret)
      .toBe(`${id}-secret`);
  }
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.getByRole('button', { name: '默认基础翻译模型', exact: true }).click();
  await expect(page.locator('[data-select="basic-default"] [role="option"]')).toHaveCount(5);
  await page.getByRole('option', { name: '百度论文翻译 API', exact: true }).click();
  await page.locator('[data-action="settings-cloud"]').click();
  await page.locator('#cloud-form [name="url"]').fill('https://dav.test');
  await page.locator('#cloud-form [name="username"]').fill('cloud-user');
  await page.locator('#cloud-form [name="password"]').fill('cloud-secret');
  await page.locator('[data-action="save-cloud"]').click();
  await expect.poll(async () => (await stored(page))?.webdav.password).toBe('cloud-secret');
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
  await page.locator('[data-basic-provider="volcengine"] .basic-summary').click();
  await page.locator('[data-basic-provider="volcengine"] [name="secret"]').fill('last-edit-before-backup');
  await page.getByRole('button', { name: '备份与存档', exact: true }).click();
  await page.locator('#include-secrets').check();
  await page.locator('#backup-password').fill('roundtrip-password');
  await page.evaluate(() => {
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async (blob) => {
          window.backupBlob = blob;
        },
        close: async () => {},
      }),
    });
  });
  await page.getByRole('button', { name: '导出存档', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.backupBlob))).toBe(true);
  const data = await page.evaluate(async () => {
    const { readArchive } = await import('/src/js/archive.js');
    return (await readArchive(window.backupBlob, 'roundtrip-password')).settings.find(
      (row) => row.id === 'app',
    ).value;
  });
  expect(data.chatProviders.map((p) => p.apiKey)).toEqual(['llm-one-secret', 'llm-two-secret']);
  expect(data.basicTranslation.defaultProvider).toBe('baidu');
  expect(data.basicTranslation.providers.baidu.secret).toBe('baidu-secret');
  expect(data.basicTranslation.providers.aliyun.secret).toBe('aliyun-secret');
  expect(data.basicTranslation.providers.volcengine.secret).toBe('last-edit-before-backup');
  expect(data.webdav.username).toBe('cloud-user');
  expect(data.webdav.password).toBe('cloud-secret');
});
