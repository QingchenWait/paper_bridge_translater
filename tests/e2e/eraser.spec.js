import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
const removed = (page) =>
  page.evaluate(
    async () =>
      (await (await import('/src/js/storage.js')).all('annotations')).filter(
        (a) => a.id.startsWith('erase-') && a.deleted,
      ).length,
  );
async function setup(page, mobile = false) {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]).drawText('Eraser regression', { x: 60, y: 700 });
  await page
    .locator('#pdf-input')
    .setInputFiles({ name: 'Erase.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  await expect(page.locator('#document-tabs')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(async () => {
    const { all, put } = await import('/src/js/storage.js'),
      doc = (await all('documents'))[0];
    const rows = [
      {
        id: 'erase-pen-a',
        type: 'pen',
        points: [
          { x: 0.2, y: 0.25 },
          { x: 0.2, y: 0.4 },
        ],
      },
      {
        id: 'erase-pen-b',
        type: 'pen',
        points: [
          { x: 0.35, y: 0.25 },
          { x: 0.35, y: 0.4 },
        ],
      },
      { id: 'erase-line', type: 'shape', shape: 'line', start: { x: 0.5, y: 0.25 }, end: { x: 0.5, y: 0.4 } },
      {
        id: 'erase-rectangle',
        type: 'shape',
        shape: 'rectangle',
        start: { x: 0.6, y: 0.27 },
        end: { x: 0.65, y: 0.35 },
      },
      {
        id: 'erase-circle',
        type: 'shape',
        shape: 'circle',
        start: { x: 0.7, y: 0.27 },
        end: { x: 0.78, y: 0.35 },
      },
      {
        id: 'erase-arrow',
        type: 'shape',
        shape: 'arrow',
        start: { x: 0.83, y: 0.25 },
        end: { x: 0.83, y: 0.4 },
      },
      {
        id: 'keep-pen',
        type: 'pen',
        points: [
          { x: 0.5, y: 0.6 },
          { x: 0.5, y: 0.7 },
        ],
      },
      { id: 'keep-note', type: 'note', x: 0.3, y: 0.3, text: 'Keep note', rects: [], fontSize: 12 },
      { id: 'keep-text', type: 'text', x: 0.5, y: 0.3, text: 'Keep text', fontSize: 12 },
      { id: 'keep-highlight', type: 'highlight', rects: [{ x: 0.1, y: 0.3, w: 0.8, h: 0.02 }] },
    ];
    for (const row of rows)
      await put('annotations', {
        documentId: doc.id,
        page: 1,
        color: '#665bf2',
        strokeWidth: 2,
        deleted: false,
        ...row,
      });
  });
  await page.reload();
  await expect(page.locator('[data-annotation-id="keep-text"]')).toBeVisible();
  await page.getByRole('button', { name: '手绘橡皮擦', exact: true }).click();
  return page.locator('.ink-layer').first();
}
async function preserved(page) {
  expect(
    await page.evaluate(async () =>
      (await (await import('/src/js/storage.js')).all('annotations'))
        .filter((a) => a.id.startsWith('keep-'))
        .every((a) => !a.deleted),
    ),
  ).toBe(true);
}
test('mouse erases multiple swept objects from empty space while held, saves and undoes each once', async ({
  page,
}) => {
  const ink = await setup(page),
    r = await ink.boundingBox();
  const move = (x, y = 0.3) => page.mouse.move(r.x + r.width * x, r.y + r.height * y, { steps: 1 });
  await move(0.2);
  expect(await removed(page)).toBe(0);
  await move(0.1);
  await page.mouse.down();
  expect(await removed(page)).toBe(0);
  await move(0.9);
  await move(0.1);
  await expect.poll(() => removed(page)).toBe(6); // deletion happens before release
  await page.mouse.up();
  await move(0.5, 0.6);
  await preserved(page);
  for (let count = 5; count >= 0; count--) {
    await page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true }).click();
    await expect.poll(() => removed(page)).toBe(count);
  }
  await expect(page.getByRole('button', { name: '撤销批注 (Ctrl+Z)', exact: true })).toBeDisabled();
  for (let count = 1; count <= 6; count++) {
    await page.getByRole('button', { name: '重做批注 (Ctrl+Shift+Z)', exact: true }).click();
    await expect.poll(() => removed(page)).toBe(count);
  }
  await page.reload();
  await expect(page.locator('.textLayer span').first()).toBeVisible();
  expect(await removed(page)).toBe(6);
  await preserved(page);
});
test('touch eraser follows only its active pointer and stops on cancel or lost capture', async ({ page }) => {
  const ink = await setup(page, true);
  const send = (type, id, x, y = 0.3) =>
    ink.evaluate(
      (canvas, { type, id, x, y }) => {
        canvas.setPointerCapture = () => {};
        const r = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerType: 'touch',
            pointerId: id,
            isPrimary: id === 9,
            button: 0,
            buttons: 1,
            clientX: r.x + r.width * x,
            clientY: r.y + r.height * y,
          }),
        );
      },
      { type, id, x, y },
    );
  await send('pointerdown', 9, 0.05);
  await send('pointermove', 10, 0.9);
  expect(await removed(page)).toBe(0);
  await send('pointermove', 9, 0.95);
  await expect.poll(() => removed(page)).toBe(6);
  await send('pointercancel', 9, 0.5, 0.6);
  await send('pointermove', 9, 0.5, 0.7);
  await preserved(page);
  await send('pointerdown', 9, 0.1, 0.6);
  await send('lostpointercapture', 9, 0.1, 0.6);
  await send('pointermove', 9, 0.5, 0.6);
  await preserved(page);
});
