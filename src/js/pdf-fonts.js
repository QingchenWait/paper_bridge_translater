import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFName, PDFArray, PDFRef, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

// Compatibility adapter for @pdf-lib/fontkit CFFSubset (MIT; see
// public/licenses/FONTKIT.txt): preserve original
// glyph programs while correcting offSize and original-FD -> subset-FD indices.
export const notoFontkit = {
  create(data) {
    const font = fontkit.create(data);
    if (font.postscriptName !== 'NotoSansSC-Regular' || !font['CFF ']) return font;
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset(),
        original = subset.cff;
      subset.cff = Object.create(original);
      subset.cff.length = original.offSize; // Upstream writes length into offSize.
      subset.subsetFontdict = function (top) {
        top.FDArray = [];
        top.FDSelect = { version: 0, fds: [] };
        const indices = new Map(),
          used = [];
        for (const gid of this.glyphs) {
          const fd = this.cff.fdForGlyph(gid);
          if (fd == null) throw new Error('原始 Noto 字体的字形字典缺失');
          if (!indices.has(fd)) {
            indices.set(fd, top.FDArray.length);
            top.FDArray.push({ ...this.cff.topDict.FDArray[fd] });
            used.push(Object.create(null));
          }
          const index = indices.get(fd);
          top.FDSelect.fds.push(index);
          const glyph = this.font.getGlyph(gid);
          void glyph.path;
          for (const subr of Object.keys(glyph._usedSubrs || {})) used[index][subr] = true;
        }
        top.FDArray.forEach((dict, index) => {
          delete dict.FontName;
          if (dict.Private?.Subrs)
            dict.Private = { ...dict.Private, Subrs: this.subsetSubrs(dict.Private.Subrs, used[index]) };
        });
      };
      return subset;
    };
    return font;
  },
};
function encodeSubset(subset) {
  return new Promise((resolve, reject) => {
    const parts = [];
    subset
      .encodeStream()
      .on('data', (part) => parts.push(part))
      .on('error', reject)
      .on('end', () => {
        const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
        let offset = 0;
        for (const part of parts) {
          result.set(part, offset);
          offset += part.length;
        }
        resolve(result);
      });
  });
}
// Rebuild legacy malformed app subsets from the SAME original Noto font and in
// the existing CID order. PDF font names, widths and ToUnicode remain unchanged.
export async function repairNotoCffFonts(pdf, originalBytes) {
  const objects = pdf.context.enumerateIndirectObjects();
  let original,
    repaired = 0;
  for (const [descriptorRef, descriptor] of objects) {
    if (
      !(descriptor instanceof PDFDict) ||
      descriptor.get(PDFName.of('Type'))?.toString() !== '/FontDescriptor'
    )
      continue;
    const name = descriptor.get(PDFName.of('FontName'))?.decodeText?.() || '';
    if (!/^(?:[A-Z]{6}\+)?NotoSansSC-Regular(?:[-+].*)?$/.test(name)) continue;
    const ref = descriptor.get(PDFName.of('FontFile3'));
    if (!(ref instanceof PDFRef)) continue;
    const stream = pdf.context.lookup(ref);
    if (
      !(stream instanceof PDFRawStream) ||
      stream.dict.get(PDFName.of('Subtype'))?.toString() !== '/CIDFontType0C'
    )
      continue;
    const data = decodePDFRawStream(stream).decode();
    if (data.length < 8 || data[0] !== 1 || data[1] !== 0 || data[2] < 4 || (data[3] >= 1 && data[3] <= 4))
      continue;
    const descendant = objects.find(
      ([, o]) =>
        o instanceof PDFDict && o.get(PDFName.of('FontDescriptor'))?.toString() === descriptorRef.toString(),
    );
    const parent =
      descendant &&
      objects.find(([, o]) => {
        if (!(o instanceof PDFDict)) return false;
        const fonts = o.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
        return fonts?.asArray().some((f) => f.toString() === descendant[0].toString());
      })?.[1];
    const cmap = parent?.lookup(PDFName.of('ToUnicode'));
    if (!(cmap instanceof PDFRawStream) || parent.get(PDFName.of('Encoding'))?.toString() !== '/Identity-H')
      throw new Error('旧版 Noto 字体缺少可恢复的字符映射，未替换字体');
    const text = new TextDecoder().decode(decodePDFRawStream(cmap).decode()),
      characters = new Map();
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const entry of block[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
        const id = parseInt(entry[1], 16),
          units = entry[2].match(/.{4}/g);
        if (units && units.join('') === entry[2])
          characters.set(id, units.map((unit) => String.fromCharCode(parseInt(unit, 16))).join(''));
      }
    if (!characters.size) throw new Error('旧版 Noto 字体字符映射为空，未替换字体');
    original ||= notoFontkit.create(
      typeof originalBytes === 'function' ? await originalBytes() : originalBytes,
    );
    if (original.postscriptName !== 'NotoSansSC-Regular') throw new Error('原始 Noto 字体不匹配，未替换字体');
    const subset = original.createSubset(),
      maximum = Math.max(...characters.keys());
    for (let id = 1; id <= maximum; id++) {
      const unicode = characters.get(id),
        glyphs = unicode ? original.layout(unicode).glyphs : [];
      if (glyphs.length !== 1 || subset.includeGlyph(glyphs[0]) !== id)
        throw new Error('旧版 Noto 字体字形编号无法安全恢复，未替换字体');
    }
    const attributes = Object.fromEntries(
      stream.dict
        .entries()
        .filter(([key]) => !['/Length', '/Filter', '/DecodeParms'].includes(key.toString()))
        .map(([key, value]) => [key.decodeText(), value]),
    );
    pdf.context.assign(ref, pdf.context.flateStream(await encodeSubset(subset), attributes));
    repaired++;
  }
  return repaired;
}
