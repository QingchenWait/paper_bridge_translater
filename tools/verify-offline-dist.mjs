import { createServer } from 'node:http';
import { readFile, stat, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { existsSync } from 'node:fs';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const root = resolve('dist');
let releaseModelAssets;
const modelGate = new Promise((done) => {
  releaseModelAssets = done;
});
const modelRequests = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (/\/offline\/(?:lite|bergamot|onnx)\//.test(url.pathname)) {
      modelRequests.push(url.pathname);
      await modelGate;
    }
    if (!url.pathname.startsWith('/paper-bridge/')) throw new Error('Path');
    const target = resolve(
      root,
      decodeURIComponent(url.pathname.slice('/paper-bridge/'.length)) || 'index.html',
    );
    if (relative(root, target).startsWith('..') || !(await stat(target)).isFile()) throw new Error('Path');
    const mime = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.json': 'application/json',
      '.css': 'text/css',
      '.wasm': 'application/wasm',
      '.svg': 'image/svg+xml',
    };
    response.writeHead(200, {
      'Content-Type': mime[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(await readFile(target));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const name = process.env.PAPER_BRIDGE_SMOKE_ENGINE || 'chromium';
const engine =
  name === 'webkit' && process.env.PAPER_BRIDGE_WEBKIT_MODULE
    ? (await import(process.env.PAPER_BRIDGE_WEBKIT_MODULE)).webkit
    : { chromium, firefox, webkit }[name];
const chrome =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined);
await mkdir('.cache', { recursive: true });
const context = await engine.launchPersistentContext(await mkdtemp(`.cache/offline-production-${name}-`), {
  headless: true,
  executablePath: name === 'chromium' ? chrome : engine.executablePath(),
  viewport: { width: 1440, height: 1000 },
});
try {
  // Firefox headless cannot answer its persistent-storage permission prompt.
  if (name === 'firefox')
    await context.addInitScript(() => {
      navigator.storage.persist = async () => false;
    });
  const page = await context.newPage(),
    errors = [],
    external = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    console.error('Page error:', error.message);
  });
  page.on('console', (message) => {
    if (message.text().startsWith('Offline test:')) console.log(message.text());
  });
  await context.route('https://**/*', (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${origin}/paper-bridge/`);
  await page.evaluate(() =>
    new MutationObserver(() => {
      for (const toast of document.querySelectorAll('.toast.error:not([data-test-seen])')) {
        toast.dataset.testSeen = 'true';
        console.log('Offline test: ' + toast.textContent);
      }
    }).observe(document.body, { childList: true, subtree: true }),
  );
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  // A cold visit using an online engine must cache the UI without any model traffic.
  await page.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active && navigator.serviceWorker.controller;
    },
    null,
    { timeout: 30000 },
  );
  if (modelRequests.length)
    throw new Error(`Startup unexpectedly requested model assets: ${modelRequests.join(', ')}`);
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText('This paper presents a new method for machine translation.', { x: 50, y: 700, font, size: 16 });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Offline production.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.locator('.textLayer span').first().waitFor();
  await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
  await page.getByRole('option', { name: '本地引擎 · 中英翻译 Lite', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise((done, reject) => {
          const request = indexedDB.open('paper-bridge');
          request.onsuccess = () => done(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise((done, reject) => {
            const request = db.transaction('settings').objectStore('settings').get('app');
            request.onsuccess = () => done(request.result?.value?.basicTranslation?.defaultProvider);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }),
    )
    .toBe('offline-lite');
  await expect.poll(() => modelRequests.length, { timeout: 15000 }).toBeGreaterThan(0);
  await page.locator('.sidebar [data-action=settings]').click();
  await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
  await expect(page.getByRole('button', { name: '默认基础翻译模型', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  releaseModelAssets();
  const translate = async (expectedEngine) => {
    await page.evaluate(() => {
      const span = document.querySelector('.textLayer span');
      span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
      const range = document.createRange();
      range.selectNodeContents(span);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      span.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    });
    if (expectedEngine) {
      await expect(page.locator('.translation-section .section-tag').last()).toHaveText(expectedEngine);
      await expect(page.locator('.inline-loading')).toHaveCount(0, { timeout: 60000 });
    }
    await expect
      .poll(() => page.locator('#selection-result').innerText(), { timeout: 60000 })
      .toContain('机器翻译');
  };
  await translate();
  const optional = process.env.PAPER_BRIDGE_TEST_MODEL_DIR
    ? JSON.parse(await readFile('public/offline/manifest.json')).models.filter((model) => !model.bundled)
    : [];
  if (optional.length) {
    await page.locator('.sidebar [data-action=settings]').click();
    await page.getByRole('button', { name: '基础翻译功能', exact: true }).click();
    await page.locator('.offline-provider .basic-summary').click();
    for (const model of optional) {
      console.log(`Importing ${model.id} into production test profile`);
      const chooser = page.waitForEvent('filechooser');
      await page.locator(`[data-offline-model=${model.id}] [data-offline-action=import]`).click();
      await (
        await chooser
      ).setFiles(
        model.files.map((file) => `${process.env.PAPER_BRIDGE_TEST_MODEL_DIR}/${model.id}/${file.path}`),
      );
      await expect(page.locator(`[data-offline-model=${model.id}] [data-offline-action=delete]`)).toBeVisible(
        { timeout: 180000 },
      );
    }
    await page.keyboard.press('Escape');
  }
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((done) =>
        navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }),
      );
  });
  // Shut down the origin as well as blocking external hosts. WebKit's emulated
  // offline toggle on Windows fails navigation before consulting its SW cache.
  if (name === 'chromium') await context.setOffline(true);
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
  await page.reload();
  await page.locator('.textLayer span').first().waitFor();
  await translate();
  for (const model of optional) {
    await page.getByRole('button', { name: '翻译引擎', exact: true }).click();
    const engineName = `本地引擎 · ${model.name}`;
    await page.getByRole('option', { name: engineName, exact: true }).click();
    await expect(page.locator('#selection-engine .select-trigger')).toHaveAttribute('title', engineName);
    await page.getByRole('button', { name: '翻译设置', exact: true }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await translate(model.name);
    console.log(
      `Offline ${model.id} result: ${(await page.locator('#selection-result').innerText()).trim()}`,
    );
  }
  await page.screenshot({ path: `test-results/offline-production-${name}.png` });
  if (errors.length || external.length) throw new Error(JSON.stringify({ errors, external }));
  console.log(
    `Offline production passed (${name}): UI/SW ready with model requests blocked, model assets only after selection, real ${optional.length ? 'Lite/Plus/Pro' : 'Lite'} translation, origin shut down before reload, preserved PDF and engine preference; no external requests.`,
  );
} finally {
  releaseModelAssets();
  await context.close();
  if (server.listening) await new Promise((done) => server.close(done));
}
