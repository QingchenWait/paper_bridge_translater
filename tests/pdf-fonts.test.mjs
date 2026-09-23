import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { notoFontkit, repairNotoCffFonts } from '../src/js/pdf-fonts.js';
const original = await readFile('public/fonts/NotoSansSC-Regular.otf');
function fonts(pdf) {
  return pdf.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/FontDescriptor')
    .map(([ref, dict]) => {
      const stream = pdf.context.lookup(
        dict.get(PDFName.of('FontFile3')) || dict.get(PDFName.of('FontFile2')),
      );
      return {
        ref: ref.toString(),
        name: dict.get(PDFName.of('FontName')).decodeText(),
        bytes: decodePDFRawStream(stream).decode().slice(),
        dict,
      };
    });
}
async function make(text, kit = fontkit) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(kit);
  const font = await pdf.embedFont(original, { subset: true });
  pdf.addPage().drawText(text, { font, size: 18 });
  await pdf.flush();
  return pdf;
}
test('legacy Noto repair restores a valid subset while preserving PDF font names and mappings', async () => {
  const pdf = await make('原始字体修复 Test αβ 123'),
    before = fonts(pdf)[0];
  assert.ok(before.bytes[3] > 4);
  const metadata = pdf.context
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFDict)
    .map(([r, o]) => [r.toString(), o.toString()]);
  assert.equal(await repairNotoCffFonts(pdf, original), 1);
  assert.deepEqual(
    pdf.context
      .enumerateIndirectObjects()
      .filter(([, o]) => o instanceof PDFDict)
      .map(([r, o]) => [r.toString(), o.toString()]),
    metadata,
  );
  const after = fonts(pdf)[0];
  assert.equal(after.name, before.name);
  assert.ok(after.bytes[3] >= 1 && after.bytes[3] <= 4);
  assert.deepEqual(after.bytes.slice(0, 3), before.bytes.slice(0, 3));
  assert.equal(await repairNotoCffFonts(pdf, original), 0);
});
test('editing an exported PDF again keeps the first Noto subset unchanged and embeds the second correctly', async () => {
  const first = await make('首次编辑中文', notoFontkit);
  assert.equal(await repairNotoCffFonts(first, original), 0);
  const originalSubset = fonts(first)[0];
  const second = await PDFDocument.load(await first.save());
  second.registerFontkit(notoFontkit);
  const font = await second.embedFont(original, { subset: true });
  second.getPage(0).drawText('第二轮新增汉字 Ω', { font, size: 18, y: 200 });
  await second.flush();
  assert.equal(await repairNotoCffFonts(second, original), 0);
  const all = fonts(await PDFDocument.load(await second.save()));
  assert.equal(all.length, 2);
  assert.deepEqual(all[0].bytes, originalSubset.bytes);
  assert.ok(all.every((f) => f.name.startsWith('NotoSansSC-Regular') && f.bytes[3] >= 1 && f.bytes[3] <= 4));
});
test('pre-existing malformed app exports are repaired without replacing unrelated fonts', async () => {
  const pdf = await make('修复旧文件');
  const old = await PDFDocument.load(await pdf.save());
  const before = fonts(old)[0];
  assert.equal(await repairNotoCffFonts(old, original), 1);
  assert.equal(fonts(old)[0].name, before.name);
  const unrelated = await make('其他字体记录');
  fonts(unrelated)[0].dict.set(PDFName.of('FontName'), PDFName.of('UnrelatedFont'));
  assert.equal(await repairNotoCffFonts(unrelated, original), 0);
});
