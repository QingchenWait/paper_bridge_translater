import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
async function choose(page) {
  await page.evaluate(() => {
    document.activeElement?.blur();
    const span = document.querySelector('.textLayer span');
    span.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', pointerId: 1, button: 0 }),
    );
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document
      .getElementById('pdf-scroll')
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', pointerId: 1 }));
  });
}
test('creating and editing drawings clears the PDF selection without repeating translation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  let calls = 0;
  await page.route('https://api.mymemory.translated.net/**', (route) => {
    calls++;
    return route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '唯一翻译' } } });
  });
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Selected words for translation', { x: 60, y: 650, size: 18 });
  await page
    .locator('#pdf-input')
    .setInputFiles({
      name: 'Selection.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await pdf.save()),
    });
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  let expected = 0;
  for (const [tool, type] of [
    ['形状绘制', 'shape'],
    ['手绘笔迹', 'pen'],
    ['添加文本框', 'text'],
  ]) {
    await choose(page);
    await expect.poll(() => calls).toBe(++expected);
    await page.getByRole('button', { name: tool, exact: true }).click();
    expect(await page.evaluate(() => getSelection().toString())).toBe('');
    const canvas = await page.locator('.ink-layer').boundingBox();
    if (type === 'text') {
      await page
        .locator('.ink-layer')
        .click({ position: { x: canvas.width * 0.25, y: canvas.height * 0.45 } });
      await page.locator('.annotation-input').fill('Edited text');
      await page.getByRole('button', { name: '字体变大', exact: true }).click();
      await page.locator('#document-status').click();
    } else {
      await page.mouse.move(canvas.x + canvas.width * 0.25, canvas.y + canvas.height * 0.45);
      await page.mouse.down();
      await page.mouse.move(canvas.x + canvas.width * 0.45, canvas.y + canvas.height * 0.5, { steps: 5 });
      await page.mouse.up();
    }
    await expect
      .poll(() =>
        page.evaluate(
          async (type) =>
            (await (await import('/src/js/storage.js')).all('annotations')).filter(
              (row) => row.type === type && !row.deleted,
            ).length,
          type,
        ),
      )
      .toBe(1);
    await page.getByRole('button', { name: tool, exact: true }).click();
    expect(calls).toBe(expected);
  }
  await choose(page);
  await expect.poll(() => calls).toBe(++expected);
  await page.locator('.annotation-text').click();
  expect(await page.evaluate(() => getSelection().toString())).toBe('');
  const box = await page.locator('.annotation-text').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 45, box.y + 45, { steps: 4 });
  await page.mouse.up();
  await page.locator('.annotation-text').dblclick();
  await page.locator('.annotation-input').fill('More editing');
  await page.getByRole('button', { name: '字体减小', exact: true }).click();
  await page.locator('#document-status').click();
  expect(calls).toBe(expected);
  await choose(page);
  await expect.poll(() => calls).toBe(++expected);
  await page.getByRole('button', { name: '文字高亮', exact: true }).click();
  await expect(page.locator('.mark-highlight')).toBeVisible();
  expect(calls).toBe(expected);
});
