import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts, PDFDict, PDFName, decodePDFRawStream } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';
async function fixture(name = 'Local.pdf') {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText('Original PDF for version 0.3.1', { x: 60, y: 650, size: 16, font });
  pdf.setTitle(name);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function setup(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function openMenu(page, mobileHeader = false) {
  await page.locator(`${mobileHeader ? '.mobile-header' : '.document-bar'} [data-action="open-pdf"]`).click();
}
const docs = (page) => page.evaluate(async () => (await import('/src/js/storage.js')).all('documents'));
for (const mobile of [false, true])
  test(`PDF source menu opens local files and nested library PDFs on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    await expect(page).toHaveTitle('纸间 · 文献翻译');
    await openMenu(page);
    const menu = page.getByRole('menu', { name: '打开 PDF 方式' });
    await expect(menu.getByRole('menuitem')).toHaveCount(3);
    const anchor = await page.locator('.document-bar [data-action="open-pdf"]').boundingBox(),
      popup = await menu.boundingBox();
    expect(popup.y).toBeCloseTo(anchor.y + anchor.height + 6, 0);
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('menuitem', { name: '本地文件', exact: true }).click();
    await (await choosing).setFiles(await fixture());
    await expect(page.locator('.textLayer span').first()).toBeVisible();
    await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
    await page.locator('#pdf-input').setInputFiles(await fixture('Nested.pdf'));
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
    const local = await page.evaluate(async () => {
      const { all } = await import('/src/js/storage.js'),
        { createFolder, moveSelection, objectKey } = await import('/src/js/library.js');
      const list = await all('documents'),
        a = await createFolder('一级文件夹'),
        b = await createFolder('二级文件夹', a.id);
      await moveSelection([objectKey('document', list.find((d) => d.name === 'Nested.pdf').id)], b.id);
      return list.find((d) => d.name === 'Local.pdf').id;
    });
    await page.locator(`.tab-main[data-id="${local}"]`).click();
    await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
    await openMenu(page);
    await page.getByRole('menuitem', { name: 'APP 文档库', exact: true }).click();
    await expect(page.getByRole('treeitem', { name: '一级文件夹', exact: true })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: '二级文件夹', exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/open-pdf-library-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
    await page.getByRole('treeitem', { name: 'Nested.pdf', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.document-tab.active')).toContainText('Nested.pdf');
    expect(await docs(page)).toHaveLength(2);
  });

test('external PDFs validate the link, fix the suffix, and import into root even from a nested library', async ({
  page,
}) => {
  await setup(page, true);
  const remote = await fixture('Remote.PDF');
  let downloads = 0;
  await page.route('https://files.test/**', (route) => {
    downloads++;
    return route.fulfill({ body: remote.buffer, contentType: 'application/pdf' });
  });
  await page.locator('.mobile-nav [data-action="library"]').click();
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '文件夹名称' }).fill('当前目录');
  await page.locator('#input-form [type="submit"]').click();
  await page.getByRole('button', { name: '当前目录', exact: true }).first().click();
  await openMenu(page, true);
  await page.getByRole('menuitem', { name: '外部链接', exact: true }).click();
  const form = page.locator('#external-pdf-form');
  await form.locator('[type="submit"]').click();
  await expect(form.locator('[role="status"]')).toContainText('请填写');
  await form.locator('[name="url"]').fill('https://files.test/a.pdf?x=1');
  await form.locator('[type="submit"]').click();
  await expect(form.locator('[role="status"]')).toContainText('以 .pdf 结尾');
  expect(downloads).toBe(0);
  await form.locator('[name="url"]').fill('https://files.test/Remote.PDF');
  await form.locator('[name="rename"]').fill('重命名论文.PDF');
  await expect(form.locator('[aria-label="固定文件后缀"]')).toHaveText('.pdf');
  await page.screenshot({ path: 'test-results/open-pdf-link-mobile.png' });
  await form.locator('[type="submit"]').click();
  await expect(page.locator('.document-tab.active')).toContainText('重命名论文.pdf');
  expect((await docs(page))[0].folderId).toBeNull();
  expect(downloads).toBe(1);
  await page.reload();
  await expect(page.locator('.document-tab')).toContainText('重命名论文.pdf');
});

test('closing an external download cancels it and invalid PDF bytes never enter the library', async ({
  page,
}) => {
  await setup(page);
  let release;
  const held = new Promise((resolve) => (release = resolve));
  await page.route('https://files.test/wait.pdf', async (route) => {
    await held;
    await route.fulfill({ body: (await fixture()).buffer, contentType: 'application/pdf' }).catch(() => {});
  });
  await openMenu(page);
  await page.getByRole('menuitem', { name: '外部链接', exact: true }).click();
  await page.locator('[name="url"]').fill('https://files.test/wait.pdf');
  await page.locator('#external-pdf-form [type="submit"]').click();
  await expect(page.locator('.external-pdf-status .spinner')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  release();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await docs(page)).toHaveLength(0);
  await page.route('https://files.test/bad.pdf', (route) =>
    route.fulfill({ body: 'This is not a PDF', contentType: 'text/plain' }),
  );
  await openMenu(page);
  await page.getByRole('menuitem', { name: '外部链接', exact: true }).click();
  await page.locator('[name="url"]').fill('https://files.test/bad.pdf');
  await page.locator('#external-pdf-form [type="submit"]').click();
  await expect(page.locator('.toast.error').last()).toContainText('导入失败');
  expect(await docs(page)).toHaveLength(0);
});

for (const mobile of [false, true])
  test(`editing toolbar keeps three actions and follows dragging in the same frame on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    await page.locator('#pdf-input').setInputFiles(await fixture());
    await expect(page.locator('.textLayer span').first()).toBeVisible();
    await page.getByRole('button', { name: '添加文本框', exact: true }).click();
    const ink = await page.locator('.ink-layer').boundingBox();
    await page.locator('.ink-layer').click({ position: { x: ink.width * 0.25, y: ink.height * 0.4 } });
    const input = page.getByRole('textbox', { name: '文本框内容' }),
      box = page.locator('.annotation-text'),
      bar = page.locator('.annotation-tools');
    await input.fill('第一段');
    await expect(bar.getByRole('button')).toHaveCount(3);
    await page.getByRole('button', { name: '字体变大', exact: true }).click();
    await expect(input).toBeFocused();
    await input.press('End');
    await page.keyboard.insertText(' 后续文字');
    await page.getByRole('button', { name: '删除该对象', exact: true }).click();
    await expect(box).toHaveCount(0);
    await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
    await expect(box).toContainText('第一段 后续文字');
    await box.click();
    await expect(bar.getByRole('button')).toHaveCount(5);
    expect(await bar.evaluate((el) => el.parentElement.classList.contains('annotation-box'))).toBe(true);
    await page.evaluate(() => {
      window.followErrors = [];
      document.addEventListener('pointermove', () => {
        const box = document.querySelector('.annotation-text.is-selected'),
          bar = box?.querySelector('.annotation-tools');
        if (!box || !bar) return;
        const a = box.getBoundingClientRect(),
          b = bar.getBoundingClientRect();
        window.followErrors.push({ x: b.x - a.x, y: b.y - a.bottom });
      });
    });
    const before = await box.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 35, { steps: 8 });
    await page.mouse.up();
    const offsets = await page.evaluate(() => window.followErrors);
    expect(offsets.length).toBeGreaterThan(3);
    expect(Math.max(...offsets.map((p) => p.y)) - Math.min(...offsets.map((p) => p.y))).toBeLessThan(0.5);
    expect(Math.max(...offsets.map((p) => p.x)) - Math.min(...offsets.map((p) => p.x))).toBeLessThan(0.5);
    await box.dblclick();
    await expect(bar.getByRole('button')).toHaveCount(3);
    await page.screenshot({ path: `test-results/text-toolbar-${mobile ? 'mobile' : 'desktop'}.png` });
  });

test('two edit-export rounds preserve Noto glyphs without font warnings and retain native mark/Ink objects', async ({
  page,
}) => {
  await setup(page);
  await page.locator('#pdf-input').setInputFiles(await fixture());
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  const warnings = [];
  page.on('console', (message) => {
    if (message.type() === 'warning' && /font|CFF|subrIndex/i.test(message.text()))
      warnings.push(message.text());
  });
  const result = await page.evaluate(async () => {
    const { all, get } = await import('/src/js/storage.js'),
      { loadPdf } = await import('/src/js/pdf.js'),
      { exportAnnotatedPdf } = await import('/src/js/pdf-export.js');
    const doc = (await all('documents'))[0],
      original = (await get('files', doc.id)).blob,
      source = await loadPdf(original);
    const common = { page: 1, color: '#6370ee', createdAt: Date.now() },
      rects = [{ x: 0.1, y: 0.17, w: 0.35, h: 0.025 }];
    const rows = [
      ...['underline', 'strike', 'highlight'].map((type) => ({ ...common, id: type, type, rects })),
      {
        ...common,
        id: 'stroke',
        type: 'pen',
        strokeWidth: 3,
        points: [
          { x: 0.1, y: 0.65 },
          { x: 0.2, y: 0.8 },
          { x: 0.35, y: 0.68 },
        ],
      },
      {
        ...common,
        id: 'first-font',
        type: 'text',
        x: 0.1,
        y: 0.3,
        fontSize: 18,
        text: '第一轮 Noto 字体研究 β',
      },
    ];
    const first = await exportAnnotatedPdf(original, rows, source);
    await source.destroy();
    const firstPdf = await loadPdf(first);
    async function read(pdf) {
      const p = await pdf.getPage(1),
        vp = p.getViewport({ scale: 1 }),
        canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      return {
        text: (await p.getTextContent()).items.map((i) => i.str).join(''),
        annotations: await p.getAnnotations(),
      };
    }
    const a = await read(firstPdf);
    const second = await exportAnnotatedPdf(
      first,
      [
        {
          ...common,
          id: 'second-font',
          type: 'text',
          x: 0.1,
          y: 0.45,
          fontSize: 18,
          text: '第二轮新增汉字 Ω',
        },
      ],
      firstPdf,
    );
    await firstPdf.destroy();
    const secondPdf = await loadPdf(second);
    const b = await read(secondPdf);
    await secondPdf.destroy();
    return {
      a,
      b,
      first: Array.from(new Uint8Array(await first.arrayBuffer())),
      second: Array.from(new Uint8Array(await second.arrayBuffer())),
    };
  });
  expect(result.a.text.replace(/\s/g, '')).toContain('第一轮Noto字体研究β');
  expect(result.b.text.replace(/\s/g, '')).toContain('第二轮新增汉字Ω');
  expect(result.b.text.replace(/\s/g, '')).toContain('第一轮Noto字体研究β');
  expect(result.b.annotations.map((a) => a.subtype)).toEqual(['Underline', 'StrikeOut', 'Highlight', 'Ink']);
  expect(result.b.annotations.find((a) => a.subtype === 'Ink').inkLists).toHaveLength(1);
  expect(warnings).toEqual([]);
  const a = await PDFDocument.load(Uint8Array.from(result.first)),
    b = await PDFDocument.load(Uint8Array.from(result.second));
  const fonts = (pdf) =>
    pdf.context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/FontDescriptor')
      .map(([, o]) => ({
        name: o.get(PDFName.of('FontName')).decodeText(),
        bytes: decodePDFRawStream(pdf.context.lookup(o.get(PDFName.of('FontFile3')))).decode(),
      }));
  expect(fonts(b)).toHaveLength(2);
  expect(Buffer.from(fonts(b)[0].bytes)).toEqual(Buffer.from(fonts(a)[0].bytes));
  expect(
    fonts(b).every((f) => f.name.startsWith('NotoSansSC-Regular') && f.bytes[3] >= 1 && f.bytes[3] <= 4),
  ).toBe(true);
  await mkdir('.cache/fonts', { recursive: true });
  await writeFile('.cache/fonts/v031-round-1.pdf', Buffer.from(result.first));
  await writeFile('.cache/fonts/v031-round-2.pdf', Buffer.from(result.second));
});
