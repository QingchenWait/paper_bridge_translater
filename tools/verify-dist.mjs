import { createServer } from 'node:http';
import { readFile, stat, readdir, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, extname, sep } from 'node:path';
import { chromium, webkit } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
const root = resolve('dist');
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/paper-bridge/')) {
      res.writeHead(404);
      res.end();
      return;
    }
    const name = decodeURIComponent(url.pathname.slice('/paper-bridge/'.length)) || 'index.html';
    const target = resolve(root, name);
    const rel = relative(root, target);
    if (rel.startsWith(`..${sep}`) || rel === '..') {
      res.writeHead(403);
      res.end();
      return;
    }
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.mjs': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.wasm': 'application/wasm',
      '.woff2': 'font/woff2',
      '.otf': 'font/otf',
    };
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' });
    res.end(await readFile(target));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const executable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (process.platform === 'win32' && existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined);
let browser, context;
const appleSmoke = process.env.PAPER_BRIDGE_SMOKE_ENGINE === 'webkit';
try {
  if (appleSmoke) {
    await mkdir('.cache', { recursive: true });
    const engine = process.env.PAPER_BRIDGE_WEBKIT_MODULE
      ? (await import(process.env.PAPER_BRIDGE_WEBKIT_MODULE)).webkit
      : webkit;
    context = await engine.launchPersistentContext(await mkdtemp('.cache/production-webkit-'), {
      headless: true,
      executablePath: engine.executablePath(),
      viewport: { width: 1440, height: 1000 },
    });
  } else {
    browser = await chromium.launch({ ...(executable ? { executablePath: executable } : {}) });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  }
  const page = await context.newPage();
  const failures = [];
  page.on('pageerror', (e) => failures.push(e.message));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  await page.route('**/*', (route) =>
    route.request().url().startsWith(base) || route.request().url().startsWith('data:')
      ? route.continue()
      : route.abort(),
  );
  await page.addInitScript(() => {
    window.showSaveFilePicker = undefined;
  });
  await page.goto(`${base}/paper-bridge/`);
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP' }).click();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Static deployment without a backend', { x: 50, y: 700, font, size: 18 });
  await page.locator('#pdf-input').setInputFiles({
    name: 'Static deployment.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  });
  await page.locator('.pdf-page .textLayer span').first().waitFor();
  await page.getByRole('button', { name: '添加文本框', exact: true }).click();
  await page.locator('.pdf-page .ink-layer').click({ position: { x: 100, y: 180 } });
  await page.locator('.annotation-input').fill('静态部署中文批注');
  await page.locator('#document-status').click();
  await page.locator('.annotation-text').waitFor();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载包含批注的 PDF' }).click();
  const downloaded = await downloading;
  const path = await downloaded.path();
  const bytes = await readFile(path);
  const exported = await PDFDocument.load(bytes);
  if (exported.getPageCount() !== 1) throw new Error('Exported PDF has incorrect page count');
  await page.reload();
  await page.locator('.annotation-text').waitFor();
  await page.evaluate(() => {
    const span = document.querySelector('.textLayer span');
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document
      .getElementById('pdf-scroll')
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
  await page.getByRole('button', { name: '文字高亮', exact: true }).click();
  await page.locator('.mark-highlight').waitFor();
  const highlightColor = await page
    .locator('.mark-highlight')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  if (highlightColor !== 'rgb(255, 224, 130)') throw new Error(`Highlight not visible: ${highlightColor}`);
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/production-preview.png', animations: 'disabled' });
  if (failures.length) throw new Error(failures.join('\n'));
  async function total(dir) {
    let size = 0,
      count = 0;
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, item.name);
      if (item.isDirectory()) {
        const nested = await total(path);
        size += nested.size;
        count += nested.count;
      } else {
        size += (await stat(path)).size;
        count++;
      }
    }
    return { size, count };
  }
  const info = await total(root);
  console.log(
    `Production smoke passed (${appleSmoke ? 'WebKit' : 'Chromium'}): nested static path, local worker/assets, PDF upload, Chinese annotation export (${bytes.length} bytes), persistence and highlighting. ${info.count} deployment files, ${(info.size / 1024 / 1024).toFixed(1)} MiB total.`,
  );
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
