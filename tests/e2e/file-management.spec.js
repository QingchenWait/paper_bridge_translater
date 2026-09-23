import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
async function file(name = 'Paper.pdf') {
  const pdf = await PDFDocument.create();
  pdf.setTitle(name);
  pdf.addPage().drawText(`Original ${name}`, { x: 50, y: 650, size: 16 });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function setup(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const start = page.getByRole('button', { name: '直接进入 APP', exact: true });
  if (await start.isVisible()) {
    await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
    await start.click();
  }
  await expect(page.locator('#pdf-input')).toBeAttached();
}
const documents = (page) => page.evaluate(async () => (await import('/src/js/storage.js')).all('documents'));
const duplicate = (page) => page.getByRole('dialog', { name: '重复的 PDF 文件' });
const reading = (page, mobile) =>
  page
    .locator(mobile ? '.mobile-nav [data-mobile-pane="reader"]' : '.sidebar [data-action="reader"]')
    .click();
const library = (page, mobile) =>
  page.locator(`${mobile ? '.mobile-nav' : '.sidebar'} [data-action="library"]`).click();
async function imported(page, count) {
  await expect(page.locator('.document-tab')).toHaveCount(count);
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
}

test('identical original bytes prompt after edits, no/close cancel, and yes creates an independent copy', async ({
  page,
}) => {
  await setup(page);
  const pdf = await file();
  await page.locator('#pdf-input').setInputFiles(pdf);
  await imported(page, 1);
  const original = (await documents(page))[0];
  expect(original.initialMd5).toBe(createHash('md5').update(pdf.buffer).digest('hex'));
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  await page.locator('.ink-layer').click({ position: { x: 100, y: 150 } });
  await page.locator('.annotation-input').fill('原文件的编辑');
  await page.locator('#document-status').click();
  await page.evaluate(async (id) => {
    const { put, database } = await import('/src/js/storage.js');
    await put('conversations', { id: 'original-thread', rootId: id, title: '原文件问答', createdAt: 1 });
    await put('messages', {
      id: 'original-message',
      conversationId: 'original-thread',
      role: 'user',
      content: '原文件的历史提问',
      status: 'complete',
      createdAt: 1,
    });
    const db = await database(),
      row = await db.get('documents', id);
    delete row.initialMd5;
    await db.put('documents', row);
  }, original.id);
  await page.reload();
  await expect(page.locator('.annotation-text')).toContainText('原文件的编辑');
  const renamed = { ...pdf, name: 'Renamed.PDF' };
  await page.locator('#pdf-input').setInputFiles(renamed);
  await expect(duplicate(page)).toContainText('该文件已经存在于文件库中，是否继续上传？');
  await duplicate(page).getByRole('button', { name: '否', exact: true }).click();
  expect(await documents(page)).toHaveLength(1);
  expect((await documents(page))[0].initialMd5).toBe(original.initialMd5);
  await page.locator('#pdf-input').setInputFiles(renamed);
  await duplicate(page).getByRole('button', { name: '关闭', exact: true }).click();
  expect(await documents(page)).toHaveLength(1);
  await page.locator('#pdf-input').setInputFiles(renamed);
  await duplicate(page).getByRole('button', { name: '是', exact: true }).click();
  await imported(page, 2);
  const copy = (await documents(page)).find((doc) => doc.id !== original.id);
  expect(copy.name).toBe('Renamed副本.PDF');
  expect(copy.initialMd5).toBe(original.initialMd5);
  expect(copy.rootId).toBe(copy.id);
  expect(copy.rootId).not.toBe(original.rootId);
  await expect(page.locator('.annotation-text')).toHaveCount(0);
  await page.getByRole('tab', { name: 'AI 问答', exact: true }).click();
  await expect(page.locator('#chat-messages')).not.toContainText('原文件的历史提问');
  const state = await page.evaluate(async () => {
    const { all } = await import('/src/js/storage.js');
    return {
      annotations: await all('annotations'),
      conversations: await all('conversations'),
      messages: await all('messages'),
    };
  });
  expect(state.annotations.every((row) => row.documentId === original.id)).toBe(true);
  expect(state.conversations.every((row) => row.rootId === original.id)).toBe(true);
  expect(state.messages[0].content).toBe('原文件的历史提问');
  await page.locator(`.tab-main[data-id="${original.id}"]`).click();
  await expect(page.locator('.annotation-text')).toContainText('原文件的编辑');
  await page.reload();
  expect((await documents(page)).map((doc) => doc.initialMd5)).toEqual([
    original.initialMd5,
    original.initialMd5,
  ]);
});

test('declining a duplicate in a batch skips only that file and same-named different bytes still import', async ({
  page,
}) => {
  await setup(page);
  const first = await file('Same.pdf'),
    different = await file('Different.pdf');
  await page
    .locator('#pdf-input')
    .setInputFiles([first, { ...first, name: 'Another name.pdf' }, { ...different, name: 'Same.pdf' }]);
  await expect(duplicate(page)).toBeVisible();
  expect(await documents(page)).toHaveLength(1);
  await duplicate(page).getByRole('button', { name: '否', exact: true }).click();
  await imported(page, 2);
  const rows = await documents(page);
  expect(rows.every((row) => row.name === 'Same.pdf')).toBe(true);
  expect(new Set(rows.map((row) => row.initialMd5)).size).toBe(2);
});

test('concurrent drops without Web Locks still serialize duplicate confirmation on mobile', async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await setup(page, true);
  const pdf = await file('Drop.pdf');
  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], 'Drop.pdf', { type: 'application/pdf' });
      for (let i = 0; i < 2; i++) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        document
          .querySelector('.reader-body')
          .dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
      }
    },
    [...pdf.buffer],
  );
  await expect(duplicate(page)).toBeVisible();
  expect(await documents(page)).toHaveLength(1);
  await page.screenshot({ path: 'test-results/duplicate-mobile.png', animations: 'disabled' });
  await duplicate(page).getByRole('button', { name: '是', exact: true }).click();
  await imported(page, 2);
  expect((await documents(page)).map((row) => row.name).sort()).toEqual(['Drop.pdf', 'Drop副本.pdf'].sort());
});

test('two browser tabs share the import lock and do not silently admit a simultaneous duplicate', async ({
  page,
  context,
}) => {
  await setup(page);
  const other = await context.newPage();
  await setup(other);
  const pdf = await file('Concurrent.pdf');
  await Promise.all([
    page.locator('#pdf-input').setInputFiles(pdf),
    other.locator('#pdf-input').setInputFiles(pdf),
  ]);
  await expect
    .poll(async () => Number(await duplicate(page).isVisible()) + Number(await duplicate(other).isVisible()))
    .toBe(1);
  const pending = (await duplicate(page).isVisible()) ? page : other;
  expect(await documents(page)).toHaveLength(1);
  await duplicate(pending).getByRole('button', { name: '否', exact: true }).click();
  await expect(duplicate(pending)).toHaveCount(0);
  expect(await documents(page)).toHaveLength(1);
  await other.close();
});

test('external link imports use the same fingerprint confirmation and keep copies independent at root', async ({
  page,
}) => {
  await setup(page);
  const pdf = await file('Source.pdf');
  await page.locator('#pdf-input').setInputFiles(pdf);
  await imported(page, 1);
  const original = (await documents(page))[0];
  await page.evaluate(async (id) => {
    const { createFolder, moveSelection, objectKey } = await import('/src/js/library.js');
    const folder = await createFolder('已有文档目录');
    await moveSelection([objectKey('document', id)], folder.id);
  }, original.id);
  await page.route('https://files.test/remote.pdf', (route) =>
    route.fulfill({ contentType: 'application/pdf', body: pdf.buffer }),
  );
  await page.locator('.document-bar [data-action="open-pdf"]').click();
  await page.getByRole('menuitem', { name: '外部链接', exact: true }).click();
  await page.locator('#external-pdf-form [name="url"]').fill('https://files.test/remote.pdf');
  await page.locator('#external-pdf-form [name="rename"]').fill('链接副本');
  await page.locator('#external-pdf-form [type="submit"]').click();
  await duplicate(page).getByRole('button', { name: '是', exact: true }).click();
  await imported(page, 2);
  const copy = (await documents(page)).find((doc) => doc.id !== original.id);
  expect(copy.name).toBe('链接副本副本.pdf');
  expect(copy.folderId).toBeNull();
  expect(copy.rootId).toBe(copy.id);
  expect(copy.initialMd5).toBe(original.initialMd5);
});

for (const mobile of [false, true])
  test(`library opens the latest active-document folder and no-document root on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    await setup(page, mobile);
    await page.locator('#pdf-input').setInputFiles([await file('A.pdf'), await file('B.pdf')]);
    await imported(page, 2);
    const folders = await page.evaluate(async () => {
      const { all } = await import('/src/js/storage.js'),
        { createFolder, moveSelection, objectKey } = await import('/src/js/library.js');
      const parent = await createFolder('文献'),
        child = await createFolder('子目录', parent.id),
        second = await createFolder('另一个目录');
      const docs = await all('documents');
      const a = docs.find((doc) => doc.name === 'A.pdf'),
        b = docs.find((doc) => doc.name === 'B.pdf');
      await moveSelection([objectKey('document', a.id)], child.id);
      await moveSelection([objectKey('document', b.id)], second.id);
      return { a: a.id, b: b.id, child: child.id };
    });
    await library(page, mobile);
    await expect(page.locator('.library-header h1')).toHaveText('另一个目录');
    await expect(page.locator('.library-document-name')).toHaveText('B.pdf');
    await page.locator('#library-search').fill('不匹配任何文件');
    await reading(page, mobile);
    await page.locator(`.tab-main[data-id="${folders.a}"]`).click();
    await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
    await library(page, mobile);
    await expect(page.locator('.library-header h1')).toHaveText('子目录');
    await expect(page.locator('#library-search')).toHaveValue('');
    await expect(page.locator('.library-document-name')).toHaveText('A.pdf');
    await page.screenshot({
      path: `test-results/library-active-folder-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
    await page.reload();
    await expect(page.locator('.document-tab')).toHaveCount(2);
    await library(page, mobile);
    await expect(page.locator('.library-header h1')).toHaveText('子目录');
    await reading(page, mobile);
    await page.locator(`.tab-close[data-id="${folders.b}"]`).click();
    await imported(page, 1);
    await page.locator(`.tab-close[data-id="${folders.a}"]`).click();
    await expect(page.locator('#reader-empty')).toBeVisible();
    await library(page, mobile);
    await expect(page.locator('.library-header h1')).toHaveText('我的文档');
    await expect(page.locator('.library-breadcrumbs button')).toHaveCount(1);
    expect(await documents(page)).toHaveLength(2);
  });
