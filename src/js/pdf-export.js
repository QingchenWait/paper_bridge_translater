import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { mountMarkdown } from './markdown.js';
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
  pdf.registerFontkit(fontkit);
  const active = annotations.filter((a) => !a.deleted);
  let font;
  if (active.some((a) => ['note', 'text'].includes(a.type)))
    font = await pdf.embedFont(await loadFont(), { subset: true });
  for (const annotation of active) {
    const page = pdf.getPage(annotation.page - 1);
    const source = await sourcePdf.getPage(annotation.page);
    const viewport = source.getViewport({ scale: 1 });
    const point = (x, y) => {
      const [px, py] = viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
      return { x: px, y: py };
    };
    if (['highlight', 'underline'].includes(annotation.type))
      for (const rect of annotation.rects) {
        if (annotation.type === 'underline')
          page.drawLine({
            start: point(rect.x, rect.y + rect.h),
            end: point(rect.x + rect.w, rect.y + rect.h),
            color: color(annotation.color),
            thickness: 1,
          });
        else {
          const p1 = point(rect.x, rect.y);
          const p2 = point(rect.x + rect.w, rect.y + rect.h);
          page.drawRectangle({
            x: Math.min(p1.x, p2.x),
            y: Math.min(p1.y, p2.y),
            width: Math.abs(p2.x - p1.x),
            height: Math.abs(p2.y - p1.y),
            color: color(annotation.color),
            opacity: 0.3,
            blendMode: 'Multiply',
          });
        }
      }
    else if (annotation.type === 'pen')
      for (let i = 1; i < annotation.points.length; i++)
        page.drawLine({
          start: point(annotation.points[i - 1].x, annotation.points[i - 1].y),
          end: point(annotation.points[i].x, annotation.points[i].y),
          color: color(annotation.color),
          thickness: 1.6,
        });
    else {
      const size = annotation.fontSize || 12;
      const p = point(annotation.x, annotation.y + size / viewport.height);
      page.drawText(annotation.text, {
        ...p,
        font,
        size,
        color: color(annotation.color),
        rotate: degrees(source.rotate),
        maxWidth: Math.max(40, viewport.width * (1 - annotation.x) - 12),
        lineHeight: size * 1.35,
      });
    }
  }
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
