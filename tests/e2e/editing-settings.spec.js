import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const sentence = 'Selection continues across drawn elements until release.';
test.use({ hasTouch: true });

async function dismiss(page) {
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
}
async function setup(page, names = ['Edited.pdf']) {
  await page.goto('/');
  await dismiss(page);
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(sentence, { x: 60, y: 650, size: 16, font });
  const files = [];
  for (const name of names) {
    pdf.setTitle(name);
    files.push({ name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  }
  await page.locator('#pdf-input').setInputFiles(files);
  await expect(page.locator('.document-tab')).toHaveCount(names.length);
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.textLayer span').first()).toBeVisible();
}
async function mockSaves(page) {
  await page.evaluate(() => {
    window.savedBlobs = [];
    window.pickerCount = 0;
    window.showSaveFilePicker = async () => {
      window.pickerCount++;
      return {
        createWritable: async () => ({
          write: async (blob) => window.savedBlobs.push(blob),
          close: async () => {},
        }),
      };
    };
  });
}
async function savedText(page, index, zipPath) {
  return page.evaluate(
    async ({ index, zipPath }) => {
      const { loadPdf } = await import('/src/js/pdf.js');
      let blob = window.savedBlobs[index];
      if (zipPath) {
        const { unzipSync } = await import('/node_modules/.vite/deps/fflate.js');
        blob = new Blob([unzipSync(new Uint8Array(await blob.arrayBuffer()))[zipPath]]);
      }
      const pdf = await loadPdf(blob);
      try {
        return (await (await pdf.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
      } finally {
        await pdf.destroy();
      }
    },
    { index, zipPath },
  );
}

test('single, toolbar, folder ZIP and translated-PDF downloads contain edits without changing source files', async ({
  page,
}) => {
  await setup(page, ['Edited.pdf', 'Translated.pdf']);
  const state = await page.evaluate(async () => {
    const { all, put, patch, get } = await import('/src/js/storage.js');
    const { sha256 } = await import('/src/js/utils.js');
    const docs = await all('documents'),
      source = docs.find((d) => d.name === 'Edited.pdf'),
      translated = docs.find((d) => d.name === 'Translated.pdf');
    await patch('documents', translated.id, { rootId: source.id });
    for (const [id, type, text, y] of [
      ['saved-note', 'note', 'Saved note', 0.3],
      ['saved-text', 'text', 'Saved textbox', 0.4],
    ])
      await put('annotations', {
        id,
        documentId: source.id,
        page: 1,
        type,
        text,
        x: 0.12,
        y,
        fontSize: 16,
        color: '#334155',
      });
    await put('annotations', {
      id: 'deleted-text',
      documentId: source.id,
      page: 1,
      type: 'text',
      text: 'Must not export',
      x: 0.1,
      y: 0.5,
      color: '#334155',
      deleted: true,
    });
    await put('annotations', {
      id: 'translated-text',
      documentId: translated.id,
      page: 1,
      type: 'text',
      text: 'Translation edited',
      x: 0.1,
      y: 0.3,
      color: '#334155',
    });
    await put('translations', {
      id: 'translated-record',
      documentId: source.id,
      rootId: source.id,
      generatedDocumentId: translated.id,
      content: '# Saved translation',
      status: 'complete',
      createdAt: Date.now(),
    });
    return { id: source.id, hash: await sha256(await (await get('files', source.id)).blob.arrayBuffer()) };
  });
  await page.reload();
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
  await page.locator(`.tab-main[data-id="${state.id}"]`).click();
  await expect(page.locator('.annotation-text')).toContainText('Saved textbox');
  await mockSaves(page);
  await page.locator('[data-action="download-pdf"]').click();
  await expect.poll(() => page.evaluate(() => window.savedBlobs.length)).toBe(1);
  expect(await savedText(page, 0)).toContain('Saved textbox');
  await page.getByRole('tab', { name: '全文翻译', exact: true }).click();
  await page.getByRole('button', { name: '生成并下载 PDF', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedBlobs.length)).toBe(2);
  expect(await savedText(page, 1)).toContain('Translation edited');
  await page.locator('.sidebar [data-action="library"]').click();
  await page
    .locator('.library-card')
    .filter({ hasText: 'Edited.pdf' })
    .getByRole('button', { name: '下载 PDF', exact: true })
    .click();
  await expect.poll(() => page.evaluate(() => window.savedBlobs.length)).toBe(3);
  const text = await savedText(page, 2);
  expect(text).not.toContain('Saved note');
  expect(
    await page.evaluate(async () => {
      const { loadPdf } = await import('/src/js/pdf.js');
      const pdf = await loadPdf(window.savedBlobs[2]);
      try {
        return (await (await pdf.getPage(1)).getAnnotations()).map((a) => a.contentsObj?.str || '').join(' ');
      } finally {
        await pdf.destroy();
      }
    }),
  ).toContain('Saved note');
  expect(text).toContain('Saved textbox');
  expect(text).not.toContain('Must not export');
  expect(text).not.toContain('Translation edited');
  await page.evaluate(async (id) => {
    const { createFolder, moveSelection, objectKey } = await import('/src/js/library.js');
    const folder = await createFolder('Pack');
    await moveSelection([objectKey('document', id)], folder.id);
  }, state.id);
  await page.locator('.sidebar [data-action="library"]').click();
  await page.getByRole('checkbox', { name: '选择文件夹 Pack', exact: true }).click();
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.savedBlobs.length)).toBe(4);
  expect(await savedText(page, 3, 'Pack/Edited.pdf')).toContain('Saved textbox');
  expect(await savedText(page, 3, 'Pack/Translated.pdf')).toContain('Translation edited');
  expect(await page.evaluate(() => window.pickerCount)).toBe(4);
  expect(
    await page.evaluate(async (id) => {
      const { get } = await import('/src/js/storage.js');
      const { sha256 } = await import('/src/js/utils.js');
      return sha256(await (await get('files', id)).blob.arrayBuffer());
    }, state.id),
  ).toBe(state.hash);
});

test('closing the shape menu on mouse or touch press activates drawing and keeps the first stroke', async ({
  page,
}) => {
  await setup(page);
  const pageBox = await page.locator('.pdf-page').boundingBox();
  const start = { x: pageBox.x + pageBox.width * 0.2, y: pageBox.y + pageBox.height * 0.35 };
  await page.getByRole('button', { name: '形状绘制颜色', exact: true }).click();
  await expect(page.getByRole('button', { name: '形状绘制', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.locator('#color-popover')).toBeHidden();
  await expect(page.getByRole('button', { name: '形状绘制', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.mouse.move(start.x + 80, start.y + 40, { steps: 5 });
  await page.mouse.up();
  const count = () =>
    page.evaluate(
      async () =>
        (await (await import('/src/js/storage.js')).all('annotations')).filter((a) => a.type === 'shape')
          .length,
    );
  await expect.poll(count).toBe(1);
  await page.getByRole('button', { name: '形状绘制', exact: true }).click();
  await page.getByRole('button', { name: '形状绘制颜色', exact: true }).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: start.x, y: start.y + 90 }],
  });
  await expect(page.locator('#color-popover')).toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x + 80, y: start.y + 130 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(count).toBe(2);
});

test('selection passes over notes, text and shapes, with translation only after release', async ({
  page,
}) => {
  await setup(page);
  let requests = 0;
  await page.route('https://api.mymemory.translated.net/**', (route) => {
    requests++;
    return route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '选词完成' } } });
  });
  await page.evaluate(async () => {
    const { all, put } = await import('/src/js/storage.js');
    const doc = (await all('documents'))[0];
    const shell = document.querySelector('.pdf-page'),
      box = shell.getBoundingClientRect(),
      text = shell.querySelector('.textLayer span').getBoundingClientRect();
    const base = {
      documentId: doc.id,
      page: 1,
      color: '#6370ee',
      y: (text.y - box.y) / box.height,
      fontSize: 12,
    };
    for (const [index, type] of ['note', 'text', 'shape'].entries()) {
      const x = (text.x - box.x + text.width * (0.28 + index * 0.22)) / box.width;
      await put('annotations', {
        ...base,
        id: type,
        type,
        text: 'Overlay',
        x,
        shape: 'rectangle',
        start: { x, y: base.y },
        end: { x: x + 0.08, y: base.y + 0.04 },
        strokeWidth: 2,
      });
    }
  });
  await page.reload();
  await expect(page.locator('[data-annotation-id="text"]')).toBeVisible();
  const before = await page.evaluate(async () => (await import('/src/js/storage.js')).all('annotations'));
  const bounds = await page.locator('.textLayer span').first().boundingBox();
  await page.mouse.move(bounds.x + 1, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(page.locator('#pdf-scroll')).toHaveClass(/selecting-text/);
  for (const id of ['note', 'text', 'shape'])
    await expect(page.locator(`[data-annotation-id="${id}"]`).first()).toHaveCSS('pointer-events', 'none');
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, { steps: 15 });
  expect(requests).toBe(0);
  expect(await page.evaluate(() => window.getSelection().toString())).toContain(
    'drawn elements until release',
  );
  await page.mouse.up();
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('#pdf-scroll')).not.toHaveClass(/selecting-text/);
  expect(await page.evaluate(async () => (await import('/src/js/storage.js')).all('annotations'))).toEqual(
    before,
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + 2, y: bounds.y + bounds.height / 2 }],
  });
  await expect(page.locator('#pdf-scroll')).toHaveClass(/selecting-text/);
  await expect(page.locator('[data-annotation-id="text"]')).toHaveCSS('pointer-events', 'none');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#pdf-scroll')).not.toHaveClass(/selecting-text/);
});

test('welcome repeats by default including legacy users and hides only after explicit opt out', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('checkbox', { name: '不再显示', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  await page.reload();
  await expect(page.getByRole('dialog', { name: '欢迎来到纸间' })).toBeVisible();
  await page.getByRole('button', { name: '配置我的 AI' }).click();
  await expect(page.getByRole('checkbox', { name: '不再显示', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await dismiss(page);
  await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(async () => {
    const { put } = await import('/src/js/storage.js');
    await put('settings', {
      id: 'app',
      value: {
        onboardingDone: true,
        chatProviders: [
          {
            id: 'legacy',
            name: 'Keep',
            baseUrl: 'https://legacy.test/v1',
            model: 'original',
            apiKey: 'kept',
          },
        ],
      },
    });
  });
  await page.reload();
  await expect(page.getByRole('dialog', { name: '欢迎来到纸间' })).toBeVisible();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  expect(
    await page.evaluate(
      async () => (await (await import('/src/js/settings.js')).getSettings()).chatProviders[0].apiKey,
    ),
  ).toBe('kept');
});

for (const mobile of [false, true])
  test(`provider presets, key visibility and unsaved website links work on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await dismiss(page);
    await page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action="settings"]`).click();
    const presets = [
      ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-v4-flash'],
      ['MiMO', 'https://api.xiaomimimo.com/v1', 'mimo-v2.6-flash'],
      ['Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-flash'],
      ['OpenAI', 'https://api.openai.com/v1', 'gpt-5.6-luna'],
      ['GLM', 'https://open.bigmodel.cn/api/paas/v4', 'glm-5.3-flash'],
      ['Kimi', 'https://api.moonshot.cn/v1', 'kimi-k3'],
      ['LM Studio', 'http://localhost:1234/v1', ''],
      ['自定义', '', ''],
    ];
    for (const [name, baseUrl, model] of presets) {
      await page.getByRole('button', { name: '添加', exact: true }).click();
      await expect(page.getByRole('listbox', { name: '选择服务商' }).getByRole('option')).toHaveCount(8);
      expect(
        await page
          .getByRole('option', { name, exact: true })
          .locator('img')
          .evaluate((img) => img.complete && img.naturalWidth > 0),
      ).toBe(true);
      await page.getByRole('option', { name, exact: true }).click();
      await expect(page.locator('[name="name"]')).toHaveValue(name);
      await expect(page.locator('[name="baseUrl"]')).toHaveValue(baseUrl);
      await expect(page.locator('[name="model"]')).toHaveValue(model);
      if (['LM Studio', '自定义'].includes(name))
        await expect(page.getByRole('button', { name: '获取', exact: true })).toBeDisabled();
      else await expect(page.getByRole('button', { name: '获取', exact: true })).toBeEnabled();
    }
    const key = page.getByLabel('API Key', { exact: true });
    await key.fill('test-key');
    await expect(key).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: '显示 API Key', exact: true }).click();
    await expect(key).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: '隐藏 API Key', exact: true }).click();
    await expect(key).toHaveValue('test-key');
    await expect(key).toHaveAttribute('type', 'password');
    await page.locator('[name="baseUrl"]').fill('https://api.xiaomimimo.com/v1');
    await expect(page.getByRole('button', { name: '获取', exact: true })).toBeEnabled();
    await page
      .context()
      .route('https://platform.xiaomimimo.com/**', (route) =>
        route.fulfill({ body: 'Official site fixture' }),
      );
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: '获取', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    expect(popup.url()).toBe('https://platform.xiaomimimo.com/console/api-keys');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await popup.close();
    await page.locator('[name="baseUrl"]').fill('https://api.openai.com.evil.test/v1');
    await expect(page.getByRole('button', { name: '获取', exact: true })).toBeDisabled();
    await page.screenshot({ path: `test-results/api-settings-${mobile ? 'mobile' : 'desktop'}.png` });
    const overflow = await page
      .locator('.modal')
      .evaluate((el) => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().right > innerWidth);
    expect(overflow).toBe(false);
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    expect(
      await page.evaluate(
        async () => (await (await import('/src/js/settings.js')).getSettings()).chatProviders.length,
      ),
    ).toBe(8);
  });
