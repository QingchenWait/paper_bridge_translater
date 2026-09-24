import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createHash } from 'node:crypto';
async function setup(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function openBasic(page, mobile = false) {
  await page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action="settings"]`).click();
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
}
const section = (page, id) => page.locator(`[data-basic-provider="${id}"]`);
async function fill(page, id) {
  const panel = section(page, id);
  await panel.locator('.basic-summary').click();
  await panel.locator('[name="keyId"]').fill(`${id}-test-id`);
  await panel.locator('[name="secret"]').fill(`${id}-test-secret`);
  return panel;
}
async function mockApis(page, seen = []) {
  await page.route('https://fanyi-api.baidu.com/api/trans/vip/**', (route) => {
    const url = new URL(route.request().url()),
      p = url.searchParams;
    seen.push(url);
    expect(p.get('sign')).toBe(
      createHash('md5')
        .update(p.get('appid') + p.get('q') + p.get('salt') + (p.get('domain') || '') + 'baidu-test-secret')
        .digest('hex'),
    );
    expect(url.href).not.toContain('baidu-test-secret');
    return route.fulfill({
      contentType: 'application/javascript',
      body: `${p.get('callback')}(${JSON.stringify({ trans_result: [{ dst: p.has('domain') ? '论文译文' : '通用译文' }] })})`,
    });
  });
  await page.route('https://mt.cn-hangzhou.aliyuncs.com/**', (route) => {
    const p = new URLSearchParams(route.request().postData());
    expect(p.get('Action')).toBe('TranslateGeneral');
    expect(p.get('Signature')).toBeTruthy();
    return route.fulfill({ json: { Code: 200, Data: { Translated: '阿里译文' } } });
  });
  await page.route('https://translate.volcengineapi.com/**', (route) => {
    expect(route.request().headers().authorization).toContain('/cn-north-1/translate/request');
    expect(route.request().postDataJSON().TextList.length).toBe(1);
    return route.fulfill({
      json: { ResponseMetadata: { Error: null }, TranslationList: [{ Translation: '火山译文' }] },
    });
  });
  await page.route('https://translate.googleapis.com/**', (route) =>
    route.fulfill({ json: [[['谷歌译文'], ['第二段']]] }),
  );
}
for (const mobile of [false, true])
  test(`basic settings accordion, saved default, tutorials and masked credentials on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    await mockApis(page);
    await openBasic(page, mobile);
    await expect(page.locator('.basic-provider-body:visible')).toHaveCount(0);
    await page.getByRole('button', { name: '默认基础翻译模型', exact: true }).click();
    await expect(page.getByRole('option', { name: 'MyMemory（每日上限低）', exact: true })).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Google 翻译（仅海外可访问）', exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-select="basic-default"] [role="option"]')).toHaveCount(2);
    await page.getByRole('option', { name: 'MyMemory（每日上限低）', exact: true }).click();
    for (const id of ['baidu', 'aliyun', 'volcengine']) {
      const panel = await fill(page, id),
        secret = panel.locator('[name="secret"]');
      await expect(secret).toHaveAttribute('type', 'password');
      await panel.locator('[data-action="show-basic-secret"]').click();
      await expect(secret).toHaveAttribute('type', 'text');
      await panel.locator('[data-action="show-basic-secret"]').click();
      await panel.getByRole('button', { name: '连接测试', exact: true }).click();
      await expect(panel.locator('.basic-status')).toHaveText('可连接');
      await panel.getByRole('button', { name: '保存配置', exact: true }).click();
      await expect(page.locator('.toast').last()).toContainText('基础翻译配置已保存');
      await panel.locator('.basic-summary').click();
      await expect(panel.locator('.basic-status')).toHaveClass(/connected/);
    }
    await page.getByRole('button', { name: '默认基础翻译模型', exact: true }).click();
    await expect(page.locator('[data-select="basic-default"] [role="option"]')).toHaveCount(5);
    await page.getByRole('option', { name: '阿里云翻译 API', exact: true }).click();
    await expect(page.locator('.toast').last()).toContainText('默认基础翻译模型已保存');
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.screenshot({ path: `test-results/basic-settings-${mobile ? 'mobile' : 'desktop'}.png` });
    await section(page, 'baidu').locator('.basic-summary').click();
    const link = section(page, 'baidu').getByRole('link', { name: '开发者信息页面' });
    await page
      .context()
      .route('https://fanyi-api.baidu.com/manage/developer', (route) =>
        route.fulfill({ body: 'Official developer page fixture' }),
      );
    const popupPromise = page.waitForEvent('popup');
    await link.click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://fanyi-api.baidu.com/manage/developer');
    await popup.close();
    await page.screenshot({
      path: `test-results/basic-settings-expanded-${mobile ? 'mobile' : 'desktop'}.png`,
    });
    expect(
      await page
        .locator('.modal')
        .evaluate((el) => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().right > innerWidth),
    ).toBe(false);
    await page.reload();
    await openBasic(page, mobile);
    await expect(page.getByRole('button', { name: '默认基础翻译模型', exact: true })).toContainText('阿里云');
    await expect(page.locator('.basic-provider-body:visible')).toHaveCount(0);
    await expect(section(page, 'baidu').locator('.basic-status')).toHaveText('可连接');
    await section(page, 'baidu').locator('.basic-summary').click();
    await expect(section(page, 'baidu').locator('[name="secret"]')).toHaveAttribute('type', 'password');
    await section(page, 'baidu').locator('[name="secret"]').fill('changed');
    await expect(section(page, 'baidu').locator('.basic-status')).toHaveText('未测试');
  });

test('testing shows progress, credential edits cancel stale tests, failures never become connected', async ({
  page,
}) => {
  await setup(page);
  await openBasic(page);
  const panel = await fill(page, 'aliyun');
  let release, started;
  const gate = new Promise((resolve) => (release = resolve)),
    request = new Promise((resolve) => (started = resolve));
  await page.route('https://mt.cn-hangzhou.aliyuncs.com/**', async (route) => {
    started();
    await gate;
    await route.fulfill({ json: { Code: 200, Data: { Translated: 'stale success' } } }).catch(() => {});
  });
  await panel.getByRole('button', { name: '连接测试', exact: true }).click();
  await request;
  await expect(panel.locator('.spinner')).toBeVisible();
  await expect(panel.getByRole('button', { name: '保存配置' })).toBeDisabled();
  await panel.locator('[name="secret"]').fill('new-secret');
  release();
  await expect(panel.locator('.basic-status')).toHaveText('未测试');
  await page.unroute('https://mt.cn-hangzhou.aliyuncs.com/**');
  await page.route('https://mt.cn-hangzhou.aliyuncs.com/**', (route) =>
    route.fulfill({ json: { Code: 'InvalidAccessKeyId', Message: 'example' } }),
  );
  await panel.getByRole('button', { name: '连接测试', exact: true }).click();
  await expect(panel.locator('.basic-status')).toHaveText('连接失败');
  await expect(panel.locator('.basic-test-detail')).toContainText('InvalidAccessKeyId');
  await expect(panel.locator('.spinner')).toHaveCount(0);
  expect(
    await page.evaluate(
      async () =>
        (await (await import('/src/js/settings.js')).getSettings()).basicTranslation.providers.aliyun.secret,
    ),
  ).toBe('new-secret');
});

async function importPdf(page) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([612, 792])
    .drawText('This paper presents a new method for reading.', { x: 60, y: 650, size: 16, font });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Basic translation.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await expect(page.locator('.textLayer span').first()).toBeVisible();
}
async function translateSelection(page) {
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
test('reader routes Google and each saved basic provider, switches Baidu by style, and never calls LLM', async ({
  page,
}) => {
  await setup(page);
  const seen = [];
  await mockApis(page, seen);
  let llmCalls = 0;
  await page.route('https://llm.test/**', (route) => {
    llmCalls++;
    return route.abort();
  });
  await page.evaluate(async () => {
    const { saveSettings } = await import('/src/js/settings.js');
    await saveSettings({
      basicTranslation: {
        defaultProvider: 'google',
        providers: Object.fromEntries(
          ['baidu', 'aliyun', 'volcengine'].map((id) => [
            id,
            { keyId: `${id}-test-id`, secret: `${id}-test-secret` },
          ]),
        ),
      },
      chatProviders: [{ id: 'llm', name: 'Test LLM', baseUrl: 'https://llm.test/v1', model: 'model' }],
    });
  });
  await importPdf(page);
  await translateSelection(page);
  await expect(page.locator('#selection-result')).toContainText('谷歌译文第二段');
  for (const [name, result, style] of [
    ['百度论文翻译 API', '论文译文', '学术论文'],
    ['百度论文翻译 API', '通用译文', '忠实直译'],
    ['阿里云翻译 API', '阿里译文', '学术论文'],
    ['火山引擎翻译 API', '火山译文', '学术论文'],
  ]) {
    await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await page.getByRole('button', { name: '翻译设置', exact: true }).click();
    await page.getByRole('button', { name: '翻译风格', exact: true }).click();
    await page.getByRole('option', { name: style, exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await translateSelection(page);
    await expect(page.locator('#selection-result')).toContainText(result);
  }
  expect(seen.map((url) => url.pathname)).toEqual([
    '/api/trans/vip/fieldtranslate',
    '/api/trans/vip/translate',
  ]);
  expect(llmCalls).toBe(0);
});

test('Baidu JSONP timeout and cancellation remove callbacks and do not save a false connection', async ({
  page,
}) => {
  await setup(page);
  await openBasic(page);
  const panel = await fill(page, 'baidu');
  await page.route('https://fanyi-api.baidu.com/api/trans/vip/**', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: '/* missing callback */' }),
  );
  await page.evaluate(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms) => timeout(ms === 20000 ? 180 : ms);
  });
  await panel.getByRole('button', { name: '连接测试', exact: true }).click();
  await expect(panel.locator('.basic-status')).toHaveText('连接失败');
  await expect(panel.locator('.basic-test-detail')).toContainText('超时');
  expect(
    await page.evaluate(() => Object.keys(window).filter((key) => key.startsWith('paperBridgeTranslate_'))),
  ).toEqual([]);
  await expect(page.locator('script[src*="/api/trans/vip/"]')).toHaveCount(0);
});
