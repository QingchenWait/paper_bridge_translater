import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { unzipSync } from 'fflate';
async function file(name) {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(name, { x: 60, y: 650, font, size: 18 });
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) };
}
async function setup(page, names = ['Original.pdf', 'Translated.pdf', 'Other.pdf']) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  await page.locator('#pdf-input').setInputFiles(await Promise.all(names.map(file)));
  await expect(page.locator('.document-tab')).toHaveCount(names.length);
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
  const docs = await page.evaluate(async () => {
    const { all, patch } = await import('/src/js/storage.js');
    const docs = await all('documents');
    const original = docs.find((d) => d.name === 'Original.pdf'),
      translated = docs.find((d) => d.name === 'Translated.pdf');
    if (original && translated) await patch('documents', translated.id, { rootId: original.id });
    return docs;
  });
  return Object.fromEntries(docs.map((d) => [d.name, d]));
}
const library = (page) => page.locator('.sidebar [data-action="library"]').click();
async function newFolder(page, name) {
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '文件夹名称' }).fill(name);
  await page.locator('#input-form button[type="submit"]').click();
  await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible();
}
const choose = (page, name, folder = false) =>
  page.getByRole('checkbox', { name: `选择${folder ? '文件夹' : '文档'} ${name}`, exact: true }).click();
test('nested folders, multi-select move tree, view switch and folder-first sorting work', async ({
  page,
}) => {
  const docs = await setup(page);
  await library(page);
  await newFolder(page, 'Papers');
  await page.locator('.library-document-name').filter({ hasText: 'Papers' }).click();
  await newFolder(page, 'Subfolder');
  await page.getByRole('button', { name: '全部文档', exact: true }).click();
  await choose(page, 'Original.pdf');
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await page.getByRole('treeitem', { name: 'Papers', exact: true }).click();
  await page.getByRole('textbox', { name: '新子文件夹名称' }).fill('New target');
  await page.getByRole('dialog').getByRole('button', { name: '新建文件夹', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'New target', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: '移动到所选目录' }).click();
  const state = await page.evaluate(async () => {
    const { all } = await import('/src/js/storage.js');
    return { docs: await all('documents'), folders: await all('folders') };
  });
  const target = state.folders.find((f) => f.name === 'New target');
  expect(state.docs.find((d) => d.id === docs['Original.pdf'].id).folderId).toBe(target.id);
  expect(state.docs.find((d) => d.id === docs['Translated.pdf'].id).folderId).toBe(target.id);
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(page.locator('#document-grid')).toHaveClass(/library-list/);
  expect(await page.locator('.library-card').first().getAttribute('class')).toContain('folder-card');
  await page.getByRole('button', { name: '文档排序' }).click();
  await page.getByRole('option', { name: '按名称排序', exact: true }).click();
  await page.getByRole('button', { name: '倒序排列', exact: true }).click();
  expect(await page.locator('.library-card').first().getAttribute('class')).toContain('folder-card');
  await page.screenshot({ path: 'test-results/library-list.png', animations: 'disabled' });
  await page.reload();
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
  await library(page);
  await expect(page.locator('#document-grid')).toHaveClass(/library-list/);
  await page.locator('.library-document-name').filter({ hasText: 'Papers' }).click();
  await expect(page.locator('.folder-card')).toHaveCount(2);
});
test('delete confirmation affects only selected PDF; surviving translation keeps and continues its conversation', async ({
  page,
}) => {
  const docs = await setup(page);
  await page.evaluate(async (id) => {
    const { put } = await import('/src/js/storage.js');
    const { saveSettings } = await import('/src/js/settings.js');
    await put('conversations', { id: 'kept-thread', rootId: id, title: '保留的对话', createdAt: 1 });
    await put('messages', {
      id: 'kept-message',
      conversationId: 'kept-thread',
      role: 'user',
      content: 'previous question',
      createdAt: 2,
      status: 'complete',
    });
    await saveSettings({
      chatProviders: [
        { id: 'test', name: 'Test', baseUrl: 'https://llm.test/v1', model: 'model', protocol: 'chat' },
      ],
      defaultChatProviderId: 'test',
    });
  }, docs['Original.pdf'].id);
  await library(page);
  await choose(page, 'Original.pdf');
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.locator('.delete-object-list')).toContainText('Original.pdf');
  await expect(page.locator('.delete-object-list')).not.toContainText('Translated.pdf');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(3);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Translated.pdf', exact: true })).toBeVisible();
  let body;
  await page.route('https://llm.test/**', (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      json: { choices: [{ message: { content: '继续回答' }, finish_reason: 'stop' }] },
    });
  });
  await page.getByRole('button', { name: 'Translated.pdf', exact: true }).click();
  await page.locator('[data-assistant-tab="chat"]').click();
  await expect(page.locator('.chat-messages')).toContainText('previous question');
  await page.locator('#chat-input').fill('continue');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.chat-message.assistant')).toContainText('继续回答');
  expect(body.messages.some((m) => m.content === 'previous question')).toBe(true);
  expect(
    body.messages.some((m) => typeof m.content === 'string' && m.content.includes('Translated.pdf')),
  ).toBe(true);
});
test('selected folder downloads preserve ZIP tree and only selected PDFs are included', async ({ page }) => {
  const docs = await setup(page);
  await page.evaluate(async (ids) => {
    const { createFolder, moveSelection, objectKey } = await import('/src/js/library.js');
    const folder = await createFolder('Pack'),
      child = await createFolder('Child', folder.id);
    await moveSelection([objectKey('document', ids['Original.pdf'].id)], child.id);
    await createFolder('Empty', folder.id);
  }, docs);
  await page.evaluate(() => {
    window.saved = [];
    window.pickerCount = 0;
    window.showSaveFilePicker = async (options) => {
      pickerCount++;
      return {
        createWritable: async () => ({
          write: async (blob) => {
            saved.push({
              name: options.suggestedName,
              data: Array.from(new Uint8Array(await blob.arrayBuffer())),
            });
          },
          close: async () => {},
        }),
      };
    };
  });
  await library(page);
  await choose(page, 'Pack', true);
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.saved.length)).toBe(1);
  const saved = await page.evaluate(() => window.saved[0]);
  const entries = unzipSync(Uint8Array.from(saved.data));
  expect(Object.keys(entries)).toContain('Pack/Child/Original.pdf');
  expect(Object.keys(entries)).toContain('Pack/Child/Translated.pdf');
  expect(Object.keys(entries)).toContain('Pack/Empty/');
  expect(Object.keys(entries).some((k) => k.includes('Other.pdf'))).toBe(false);
  expect(await page.evaluate(() => window.pickerCount)).toBe(1);
});
test('two PDFs use one directory picker; unsupported browsers download to their default destination', async ({
  page,
}) => {
  await setup(page);
  await library(page);
  await choose(page, 'Original.pdf');
  await choose(page, 'Other.pdf');
  await page.evaluate(() => {
    window.dirCount = 0;
    window.outputs = {};
    window.showDirectoryPicker = async () => {
      dirCount++;
      return {
        getFileHandle: async (name, options) => {
          if (!options?.create) throw new DOMException('missing', 'NotFoundError');
          return {
            createWritable: async () => ({
              write: async (blob) => (outputs[name] = await blob.slice(0, 5).text()),
              close: async () => {},
            }),
          };
        },
      };
    };
  });
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(outputs).length)).toBe(2);
  expect(await page.evaluate(() => dirCount)).toBe(1);
  await page.evaluate(() => {
    window.showDirectoryPicker = undefined;
    window.showSaveFilePicker = undefined;
  });
  await choose(page, 'Other.pdf');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Original.pdf');
  await expect(page.locator('.toast.error')).toHaveCount(0);
});
test('tab switching keeps the first click until complete and shape selection activates its matching icon', async ({
  page,
}) => {
  const docs = await setup(page);
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    Blob.prototype.arrayBuffer = async function () {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return original.call(this);
    };
  });
  await page.locator(`.tab-main[data-id="${docs['Original.pdf'].id}"]`).click();
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'true');
  for (let i = 0; i < 5; i++)
    await page.locator(`.tab-main[data-id="${docs['Translated.pdf'].id}"]`).dispatchEvent('click');
  await expect(page.locator('.document-tab.active')).toContainText('Original.pdf');
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
  await page.locator(`.tab-main[data-id="${docs['Translated.pdf'].id}"]`).click();
  await expect(page.locator('.document-tab.active')).toContainText('Translated.pdf');
  await page.getByRole('button', { name: '形状绘制颜色', exact: true }).click();
  const source = await page
    .getByRole('button', { name: '箭头', exact: true })
    .locator('img')
    .getAttribute('src');
  await page.getByRole('button', { name: '箭头', exact: true }).click();
  const shape = page.getByRole('button', { name: '形状绘制', exact: true });
  await expect(shape).toHaveAttribute('aria-pressed', 'true');
  await expect(shape.locator('img')).toHaveAttribute('src', source);
  await shape.click();
  await expect(shape).toHaveAttribute('aria-pressed', 'false');
});
test('cold PDF export chooses its destination before lazy loading or conversion and never twice', async ({
  page,
}) => {
  await setup(page, ['Cold.pdf']);
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  await page.locator('.pdf-page[data-page="1"] .ink-layer').click({ position: { x: 100, y: 160 } });
  await page.locator('.annotation-input').fill('Cold export');
  await page.locator('#document-status').click();
  let release;
  await page.route('**/src/js/pdf-export.js*', async (route) => {
    await new Promise((resolve) => (release = resolve));
    await route.continue();
  });
  await page.evaluate(() => {
    window.picks = 0;
    window.written = false;
    window.activation = false;
    window.showSaveFilePicker = async () => {
      picks++;
      activation = navigator.userActivation.isActive;
      return {
        createWritable: async () => ({
          write: async (blob) => {
            written = (await blob.slice(0, 5).text()) === '%PDF-';
          },
          close: async () => {},
        }),
      };
    };
  });
  await page.getByRole('button', { name: '下载包含批注的 PDF' }).click();
  await expect.poll(() => page.evaluate(() => window.picks)).toBe(1);
  expect(await page.evaluate(() => window.activation)).toBe(true);
  await expect.poll(() => Boolean(release)).toBe(true);
  release();
  await expect.poll(() => page.evaluate(() => window.written)).toBe(true);
  expect(await page.evaluate(() => window.picks)).toBe(1);
});
test('mobile library selection, list layout and nested folder UI stay within screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator('.mobile-nav [data-action="library"]').click();
  await newFolder(page, 'Mobile folder');
  await choose(page, 'Original.pdf');
  await choose(page, 'Mobile folder', true);
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/library-mobile.png', animations: 'disabled' });
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '根目录', exact: true })).toBeVisible();
  const box = await page.getByRole('dialog').boundingBox();
  expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/library-move-mobile.png', animations: 'disabled' });
});
test('database v1 upgrades additively and preserves an existing PDF and its annotations', async ({
  page,
}) => {
  const legacy = await file('Legacy.pdf');
  await page.route('**/__legacy_seed', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Temporary test setup</title>' }),
  );
  await page.goto('/__legacy_seed');
  await page.evaluate(async (bytes) => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('paper-bridge', 1);
      request.onupgradeneeded = () => {
        for (const name of [
          'documents',
          'files',
          'annotations',
          'conversations',
          'messages',
          'translations',
          'settings',
        ])
          request.result.createObjectStore(name, { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(['documents', 'files', 'annotations', 'settings'], 'readwrite');
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
        tx.objectStore('documents').put({
          id: 'legacy-doc',
          rootId: 'legacy-doc',
          name: 'Legacy.pdf',
          pages: 1,
          size: blob.size,
          page: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        tx.objectStore('files').put({ id: 'legacy-doc', blob, updatedAt: 1 });
        tx.objectStore('annotations').put({
          id: 'legacy-note',
          documentId: 'legacy-doc',
          page: 1,
          type: 'text',
          text: 'Keep existing annotation',
          x: 0.1,
          y: 0.2,
          color: '#123456',
          fontSize: 12,
          createdAt: 1,
          updatedAt: 1,
        });
        tx.objectStore('settings').put({
          id: 'app',
          value: { onboardingDone: true, hideOnboarding: true },
          updatedAt: 1,
        });
        tx.objectStore('settings').put({
          id: 'workspace',
          value: { openIds: ['legacy-doc'], activeId: 'legacy-doc' },
          updatedAt: 1,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, Array.from(legacy.buffer));
  await page.goto('/');
  await expect(page.locator('.annotation-text')).toHaveText('Keep existing annotation');
  await library(page);
  await expect(page.locator('.library-card')).toHaveCount(1);
  await newFolder(page, 'Migrated folder');
  const state = await page.evaluate(async () => {
    const { database, get } = await import('/src/js/storage.js');
    return { version: (await database()).version, bytes: (await get('files', 'legacy-doc')).blob.size };
  });
  expect(state.version).toBe(2);
  expect(state.bytes).toBe(legacy.buffer.length);
});
