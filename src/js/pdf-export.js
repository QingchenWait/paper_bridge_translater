import { PDFDocument, rgb, degrees } from 'pdf-lib';
import { mountMarkdown } from './markdown.js';
import { shapeGeometry } from './shapes.js';
import { appendPdfNote, appendPdfMark, wrapAnnotationText } from './pdf-comments.js';
import { notoFontkit, repairNotoCffFonts } from './pdf-fonts.js';
const color = (value) => {
  const hex = value.replace('#', '');
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
};
let fontBytes;
async function loadFont() {
  if (!fontBytes) {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/NotoSansSC-Regular.otf`);
    if (!response.ok) throw new Error('中文字体未加载，请重新构建应用');
    fontBytes = new Uint8Array(await response.arrayBuffer());
  }
  return fontBytes;
}
export async function exportAnnotatedPdf(blob, annotations, sourcePdf) {
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  pdf.registerFontkit(notoFontkit);
  const active = annotations.filter(
    (a) => !a.deleted && (!['note', 'text'].includes(a.type) || a.text?.trim()),
  );
  let font;
  if (active.some((a) => a.type === 'text')) font = await pdf.embedFont(await loadFont(), { subset: true });
  for (const annotation of active) {
    const page = pdf.getPage(annotation.page - 1);
    const source = await sourcePdf.getPage(annotation.page);
    const viewport = source.getViewport({ scale: 1 });
    const point = (x, y) => {
      const [px, py] = viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
      return { x: px, y: py };
    };
    if (annotation.type === 'note') appendPdfNote(pdf, page, annotation, viewport);
    else if (['highlight', 'underline', 'strike', 'pen'].includes(annotation.type))
      appendPdfMark(pdf, page, annotation, viewport);
    else if (annotation.type === 'shape') {
      const geometry = shapeGeometry(annotation, viewport.width, viewport.height);
      const convert = (p) => point(p.x / viewport.width, p.y / viewport.height);
      const borderColor = color(annotation.color),
        borderWidth = annotation.strokeWidth || 2;
      if (geometry.type === 'rectangle') {
        const p1 = convert(geometry),
          p2 = convert({ x: geometry.x + geometry.width, y: geometry.y + geometry.height });
        page.drawRectangle({
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          width: Math.abs(p2.x - p1.x),
          height: Math.abs(p2.y - p1.y),
          borderColor,
          borderWidth,
        });
      } else if (geometry.type === 'circle') {
        const center = convert(geometry),
          edge = convert({ x: geometry.x + geometry.radius, y: geometry.y });
        page.drawCircle({
          ...center,
          size: Math.hypot(edge.x - center.x, edge.y - center.y),
          borderColor,
          borderWidth,
        });
      } else
        for (const [start, end] of geometry.segments)
          page.drawLine({
            start: convert(start),
            end: convert(end),
            color: borderColor,
            thickness: borderWidth,
          });
    } else {
      const size = annotation.fontSize || 14;
      const unit = source.userUnit || 1,
        padding = annotation.border ? 3 : 2;
      const natural = annotation.text
        .split('\n')
        .reduce(
          (width, line) =>
            Math.max(width, font.widthOfTextAtSize(line, size / unit) * unit + padding * 2 + 1),
          48,
        );
      const width = Math.min(
        (1 - annotation.x) * viewport.width,
        annotation.width ? annotation.width * viewport.width : Math.min(0.45 * viewport.width, natural),
      );
      const lines = wrapAnnotationText(
        annotation.text,
        (text) => font.widthOfTextAtSize(text, size / unit),
        Math.max(1, (width - padding * 2) / unit),
      );
      if (annotation.border) {
        const height = lines.length * size * 1.45 + padding * 2;
        const a = point(annotation.x, annotation.y),
          b = point(annotation.x + width / viewport.width, annotation.y + height / viewport.height);
        page.drawRectangle({
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
          borderColor: color(annotation.color),
          borderWidth: 1 / unit,
        });
      }
      lines.forEach((line, index) => {
        const p = point(
          annotation.x + padding / viewport.width,
          annotation.y + (padding + size + index * size * 1.45) / viewport.height,
        );
        if (line)
          page.drawText(line, {
            ...p,
            font,
            size: size / unit,
            color: color(annotation.color),
            rotate: degrees(source.rotate),
          });
      });
    }
  }
  await pdf.flush();
  await repairNotoCffFonts(pdf, loadFont);
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
export async function markdownToPdf(text, onProgress = () => {}) {
  const { default: html2canvas } = await import('html2canvas');
  const host = document.createElement('article');
  host.className = 'markdown export-page';
  mountMarkdown(host, text);
  document.body.append(host);
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595.28, 841.89]);
  let y = 803;
  const width = 519;
  const bottom = 38;
  try {
    await document.fonts.ready;
    const children = [...host.children];
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      const canvas = await html2canvas(node, {
        scale: 1.5,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: false,
      });
      if (!canvas.width || !canvas.height) continue;
      const ratio = width / canvas.width;
      let offset = 0;
      const blockHeight = canvas.height * ratio;
      if (blockHeight < 720 && blockHeight > y - bottom) {
        page = pdf.addPage([595.28, 841.89]);
        y = 803;
      }
      while (offset < canvas.height) {
        if (y - bottom < 18) {
          page = pdf.addPage([595.28, 841.89]);
          y = 803;
        }
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.min(canvas.height - offset, Math.floor((y - bottom) / ratio));
        slice
          .getContext('2d')
          .drawImage(canvas, 0, offset, canvas.width, slice.height, 0, 0, canvas.width, slice.height);
        const bytes = await (
          await new Promise((resolve) => slice.toBlob(resolve, 'image/png'))
        ).arrayBuffer();
        const image = await pdf.embedPng(bytes);
        const height = slice.height * ratio;
        page.drawImage(image, { x: 38, y: y - height, width, height });
        y -= height;
        offset += slice.height;
      }
      y -= 10;
      canvas.width = 0;
      canvas.height = 0;
      onProgress(i + 1, children.length);
    }
    return new Blob([await pdf.save()], { type: 'application/pdf' });
  } finally {
    host.remove();
  }
}
