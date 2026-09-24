import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
const stored = (page) => page.evaluate(async () => await (await import('/src/js/settings.js')).getSettings());
async function setup(page, mobile) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  if (mobile) await page.locator('[data-mobile-pane="assistant"]').click();
}
for (const mobile of [false, true]) {
  test(`grouped translation engine moves between header and popover on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    await page.evaluate(async () => {
      await (
        await import('/src/js/settings.js')
      ).saveSettings({
        chatProviders: [
          {
            id: 'chosen',
            name: 'Renamed DeepSeek',
            model: 'deepseek-v4-flash',
            baseUrl: 'https://api.deepseek.com/v1',
          },
        ],
      });
    });
    const header = page.locator('#selection-engine');
    const trigger = header.getByRole('button', { name: '翻译引擎', exact: true });
    await expect(trigger).toHaveText('·机翻');
    await expect(trigger.locator('img')).toHaveAttribute('src', /meta/i);
    await trigger.click();
    await expect(header.getByRole('group')).toHaveCount(2);
    await expect(header.getByRole('option')).toHaveCount(3);
    await page.screenshot({
      path: `test-results/v033-engines-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
    await header.getByRole('option', { name: /Renamed DeepSeek/ }).click();
    await expect.poll(async () => (await stored(page)).translationProviderId).toBe('chosen');
    await expect(trigger).toHaveText('·AI');
    await expect(trigger.locator('img')).toHaveAttribute('src', /deepseek/i);
    await page.getByRole('button', { name: '翻译设置', exact: true }).click();
    await expect(page.locator('.translation-popover [data-select="translation-engine"]')).toHaveCount(0);
    await page.getByRole('button', { name: '翻译风格', exact: true }).click();
    await page.getByRole('option', { name: '忠实直译', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    expect((await stored(page)).translationEngine).toBe('llm');
    for (const tab of ['全文翻译', 'AI 问答']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(header).toBeHidden();
      await page.getByRole('button', { name: '翻译设置', exact: true }).click();
      await expect(page.locator('.translation-popover [data-select="translation-engine"]')).toBeVisible();
      await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
      await page.getByRole('option', { name: 'Google 翻译（仅海外可访问）', exact: true }).click();
      await page.getByRole('button', { name: '保存', exact: true }).click();
    }
    await page.getByRole('tab', { name: '划词翻译', exact: true }).click();
    await expect(trigger.locator('img')).toHaveAttribute('src', /google/i);
    const metrics = await page.evaluate(() => {
      const header = document.querySelector('.assistant-header'),
        engine = document.querySelector('#selection-engine .select-trigger'),
        settings = document.querySelector('#translation-settings');
      return {
        overlap: engine.getBoundingClientRect().right > settings.getBoundingClientRect().left,
        overflows: header.scrollWidth > header.clientWidth,
        logo: engine.querySelector('img').getBoundingClientRect().width,
        settingsIcon: settings.querySelector('img').getBoundingClientRect().width,
        labelVisible: getComputedStyle(engine.querySelector('span')).display !== 'none',
      };
    });
    expect(metrics.overlap).toBe(false);
    expect(metrics.overflows).toBe(false);
    expect(metrics.logo).toBe(metrics.settingsIcon);
    if (mobile) expect(metrics.labelVisible).toBe(false);
    await page.reload();
    if (mobile) await page.locator('[data-mobile-pane="assistant"]').click();
    await expect(trigger.locator('img')).toHaveAttribute('src', /google/i);
  });
  test(`onboarding reuses key/model actions and makes its provider the translation default on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
    await page.getByRole('button', { name: '配置我的 AI', exact: true }).click();
    const form = page.locator('#onboarding-form');
    const key = form.getByRole('button', { name: '获取', exact: true });
    await expect(form.locator('[data-action="toggle-api-key"]')).toHaveCount(0);
    await expect(key).toBeEnabled();
    await page.locator('[data-preset="lmstudio"]').click();
    await expect(key).toBeDisabled();
    await expect(form.locator('[name="baseUrl"]')).toHaveValue('http://localhost:1234/v1');
    await expect(form.getByRole('button', { name: '获取模型列表', exact: true })).toBeEnabled();
    await page.locator('[data-preset="deepseek"]').click();
    await form.locator('[name="baseUrl"]').fill('https://unknown.test/v1');
    await expect(key).toBeDisabled();
    await form.locator('[name="baseUrl"]').fill('https://api.deepseek.com/v1');
    await page
      .context()
      .route('https://platform.deepseek.com/api_keys', (route) => route.fulfill({ body: 'Key page' }));
    const opening = page.waitForEvent('popup');
    await key.click();
    const popup = await opening;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://platform.deepseek.com/api_keys');
    await popup.close();
    await form.locator('[name="apiKey"]').fill('fixture-key');
    let auth;
    await page.route('https://api.deepseek.com/v1/models', (route) => {
      auth = route.request().headers().authorization;
      return route.fulfill({ json: { data: [{ id: 'deepseek-from-list' }] } });
    });
    await form.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await form.getByRole('button', { name: 'deepseek-from-list', exact: true }).click();
    expect(auth).toBe('Bearer fixture-key');
    await expect(form.locator('[name="model"]')).toHaveValue('deepseek-from-list');
    await page.screenshot({
      path: `test-results/v033-onboarding-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
    expect(await form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await form.getByRole('button', { name: '保存并开始', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const settings = await stored(page);
    expect(settings.translationEngine).toBe('llm');
    expect(settings.translationProviderId).toBe(settings.defaultChatProviderId);
    expect(settings.chatProviders[0].model).toBe('deepseek-from-list');
    if (mobile) await page.locator('[data-mobile-pane="assistant"]').click();
    await expect(page.locator('#selection-engine .select-trigger')).toHaveText('·AI');
    await page.reload();
    expect((await stored(page)).translationProviderId).toBe(settings.translationProviderId);
    await page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action="settings"]`).click();
    const configured = page.locator('#provider-form');
    await configured.getByRole('button', { name: '获取模型列表', exact: true }).click();
    await configured.getByRole('button', { name: 'deepseek-from-list', exact: true }).click();
    await expect(configured.locator('[name="model"]')).toHaveValue('deepseek-from-list');
    await expect(configured.getByRole('button', { name: '显示 API Key', exact: true })).toBeVisible();
  });
}
test('zoom trigger shows custom percentages while its menu stays fixed and minus precedes plus', async ({
  page,
}) => {
  await setup(page, false);
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Zoom test');
  await page
    .locator('#pdf-input')
    .setInputFiles({ name: 'Zoom.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  const trigger = page.getByRole('button', { name: '缩放比例', exact: true });
  await trigger.click();
  await page.getByRole('option', { name: '100%', exact: true }).click();
  await page.getByRole('button', { name: '放大', exact: true }).click();
  await expect(trigger).toContainText('115%');
  await trigger.click();
  await expect(page.locator('[data-select="zoom"] [role="option"]')).toHaveText([
    '适应宽度',
    '50%',
    '75%',
    '100%',
    '125%',
    '150%',
    '200%',
  ]);
  await expect(page.locator('[data-select="zoom"] [aria-selected="true"]')).toHaveCount(0);
  await expect(page.locator('[data-select="zoom"] [data-value="fit"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-select="zoom"] .select-menu')).toBeHidden();
  await expect(page.locator('.zoom-group [data-action]').first()).toHaveAttribute('data-action', 'zoom-out');
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect(trigger).toContainText('100%');
  await page.reload();
  await expect(trigger).toContainText('100%');
});
