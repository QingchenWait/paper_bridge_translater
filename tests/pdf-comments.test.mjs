import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFNumber } from 'pdf-lib';
import { appendPdfNote, appendPdfMark, wrapAnnotationText } from '../src/js/pdf-comments.js';
const viewport = { width: 612, height: 792, convertToPdfPoint: (x, y) => [x, 792 - y] };
test('notes are standard markup/popups with Unicode Contents and preserve existing annotations', async () => {
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([612, 792]);
  page.drawText('Original page text');
  const contents = page.node.Contents();
  const existing = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [1, 1, 20, 20],
      Contents: PDFHexString.fromText('Existing'),
    }),
  );
  page.node.addAnnot(existing);
  appendPdfNote(
    pdf,
    page,
    {
      id: 'note',
      text: '中文批注\nSecond line',
      color: '#6370ee',
      x: 0.1,
      y: 0.25,
      rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.02 }],
      width: 0.6,
    },
    viewport,
  );
  appendPdfNote(pdf, page, { id: 'legacy', text: 'Free note', color: '#e8ae3e', x: 0.2, y: 0.5 }, viewport);
  assert.equal(page.node.Contents(), contents);
  const loaded = await PDFDocument.load(await pdf.save()),
    annotations = loaded.getPage(0).node.Annots();
  assert.equal(annotations.size(), 5);
  const mark = loaded.context.lookup(annotations.get(1), PDFDict);
  assert.equal(mark.lookup(PDFName.of('Subtype'), PDFName).asString(), '/Underline');
  assert.equal(mark.lookup(PDFName.of('Contents')).decodeText(), '中文批注\nSecond line');
  assert.equal(mark.lookup(PDFName.of('QuadPoints'), PDFArray).size(), 8);
  assert.equal(mark.lookup(PDFName.of('F'), PDFNumber).asNumber(), 4);
  const popup = loaded.context.lookup(mark.get(PDFName.of('Popup')), PDFDict);
  assert.equal(popup.get(PDFName.of('Parent')).toString(), annotations.get(1).toString());
  assert.equal(popup.lookup(PDFName.of('Subtype'), PDFName).asString(), '/Popup');
  assert.ok(mark.has(PDFName.of('AP')));
  assert.equal(
    loaded.context.lookup(annotations.get(3), PDFDict).lookup(PDFName.of('Subtype'), PDFName).asString(),
    '/Text',
  );
});
test('textbox wrapping preserves explicit newlines and every Unicode codepoint', () => {
  const text = 'longUnbrokenWord 中文换行 😀\nsecond line\n';
  const lines = wrapAnnotationText(text, (s) => [...s].length, 7);
  assert.ok(lines.every((line) => [...line].length <= 7));
  assert.equal(lines.join(''), text.replaceAll('\n', ''));
  assert.equal(lines.at(-1), '');
});
test('underline, strike, highlight and each pen stroke remain independent native annotations', async () => {
  const pdf = await PDFDocument.create(),
    page = pdf.addPage([612, 792]);
  page.drawText('Keep page text unchanged');
  const content = page.node.Contents();
  const rects = [
    { x: 0.1, y: 0.2, w: 0.3, h: 0.02 },
    { x: 0.1, y: 0.24, w: 0.2, h: 0.02 },
  ];
  for (const type of ['underline', 'strike', 'highlight'])
    appendPdfMark(pdf, page, { id: type, type, color: '#e8ae3e', rects }, viewport);
  appendPdfMark(
    pdf,
    page,
    {
      id: 'stroke',
      type: 'pen',
      color: '#6370ee',
      strokeWidth: 3,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.2, y: 0.7 },
        { x: 0.4, y: 0.6 },
      ],
    },
    viewport,
  );
  assert.equal(page.node.Contents(), content);
  const loaded = await PDFDocument.load(await pdf.save()),
    rows = loaded
      .getPage(0)
      .node.Annots()
      .asArray()
      .map((ref) => loaded.context.lookup(ref, PDFDict));
  assert.deepEqual(
    rows.map((row) => row.get(PDFName.of('Subtype')).toString()),
    ['/Underline', '/StrikeOut', '/Highlight', '/Ink'],
  );
  assert.ok(rows.slice(0, 3).every((row) => row.lookup(PDFName.of('QuadPoints'), PDFArray).size() === 16));
  const ink = rows[3].lookup(PDFName.of('InkList'), PDFArray);
  assert.equal(ink.size(), 1);
  assert.equal(ink.lookup(0, PDFArray).size(), 6);
  assert.ok(rows.every((row) => row.has(PDFName.of('AP'))));
});
