import { PDFName, PDFHexString, PDFString } from 'pdf-lib';

export function appendPdfMark(pdf, page, annotation, viewport) {
  const point = (p) => viewport.convertToPdfPoint(p.x * viewport.width, p.y * viewport.height);
  const color = [1, 3, 5].map((i) => parseInt(annotation.color.slice(i, i + 2), 16) / 255);
  const ink = annotation.type === 'pen';
  const subtype = { underline: 'Underline', strike: 'StrikeOut', highlight: 'Highlight', pen: 'Ink' }[
    annotation.type
  ];
  if (!subtype) return;
  const quads = ink
    ? []
    : (annotation.rects || []).flatMap((r) => [
        ...point(r),
        ...point({ x: r.x + r.w, y: r.y }),
        ...point({ x: r.x, y: r.y + r.h }),
        ...point({ x: r.x + r.w, y: r.y + r.h }),
      ]);
  const path = ink ? (annotation.points || []).map(point) : [];
  if (ink && path.length === 1) path.push([...path[0]]);
  const coordinates = ink ? path.flat() : quads;
  if (!coordinates.length) return;
  const thickness = (ink ? annotation.strokeWidth || 1.6 : 1) / (viewport.userUnit || 1);
  let left = Infinity,
    bottom = Infinity,
    right = -Infinity,
    top = -Infinity;
  for (let i = 0; i < coordinates.length; i += 2) {
    left = Math.min(left, coordinates[i]);
    right = Math.max(right, coordinates[i]);
    bottom = Math.min(bottom, coordinates[i + 1]);
    top = Math.max(top, coordinates[i + 1]);
  }
  const pad = thickness / 2 + 1;
  const bounds = [left - pad, bottom - pad, right + pad, top + pad];
  const local = (p) => `${p[0] - bounds[0]} ${p[1] - bounds[1]}`;
  const commands = [];
  if (ink) {
    commands.push(`${local(path[0])} m`);
    for (let i = 1; i < path.length; i++) commands.push(`${local(path[i])} l`);
    commands.push('S');
  } else
    for (const r of annotation.rects) {
      if (annotation.type === 'highlight') {
        commands.push(
          `${local(point(r))} m`,
          `${local(point({ x: r.x + r.w, y: r.y }))} l`,
          `${local(point({ x: r.x + r.w, y: r.y + r.h }))} l`,
          `${local(point({ x: r.x, y: r.y + r.h }))} l h f`,
        );
      } else {
        const y = r.y + r.h * (annotation.type === 'strike' ? 0.5 : 1);
        commands.push(`${local(point({ x: r.x, y }))} m ${local(point({ x: r.x + r.w, y }))} l S`);
      }
    }
  const highlight = annotation.type === 'highlight';
  const appearance = pdf.context.flateStream(
    `q ${highlight ? '/GS gs' : ''} ${color.join(' ')} ${highlight ? 'rg' : 'RG'} ${thickness} w 1 J 1 j\n${commands.join('\n')}\nQ`,
    {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, bounds[2] - bounds[0], bounds[3] - bounds[1]],
      Resources: highlight
        ? { ExtGState: { GS: { Type: 'ExtGState', ca: 0.3, CA: 0.3, BM: 'Multiply' } } }
        : {},
    },
  );
  const dict = pdf.context.obj({
    Type: 'Annot',
    Subtype: subtype,
    P: page.ref,
    Rect: bounds,
    C: color,
    F: 4,
    NM: PDFHexString.fromText(`paper-bridge-${annotation.id}`),
    T: PDFHexString.fromText('Paper Bridge'),
    M: PDFString.fromDate(new Date(annotation.updatedAt || annotation.createdAt || Date.now())),
    AP: { N: pdf.context.register(appearance) },
    ...(ink
      ? { InkList: [path.flat()], BS: { Type: 'Border', W: thickness, S: 'S' }, Border: [0, 0, thickness] }
      : { QuadPoints: quads }),
    ...(highlight ? { CA: 0.3 } : {}),
  });
  page.node.addAnnot(pdf.context.register(dict));
}

// ISO 32000-1 §12.5.6: markup annotations own their Contents and linked Popup.
// The appearance paints only the underline; the comment is never page text.
export function appendPdfNote(pdf, page, note, viewport) {
  const point = (x, y) => viewport.convertToPdfPoint(x * viewport.width, y * viewport.height);
  const rectangle = (x, y, w, h) => {
    const a = point(x, y),
      b = point(x + w, y + h);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  };
  const color = [1, 3, 5].map((i) => parseInt(note.color.slice(i, i + 2), 16) / 255);
  const rects = note.rects?.filter((r) => r.w > 0 && r.h > 0) || [];
  const dict = pdf.context.obj({
    Type: 'Annot',
    Subtype: rects.length ? 'Underline' : 'Text',
    P: page.ref,
    Contents: PDFHexString.fromText(note.text),
    T: PDFHexString.fromText('纸间 · Paper Bridge'),
    NM: PDFHexString.fromText(`paper-bridge-${note.id}`),
    M: PDFString.fromDate(new Date(note.updatedAt || note.createdAt || Date.now())),
    C: color,
    F: 4,
  });
  if (rects.length) {
    const quads = rects.flatMap((r) => [
      ...point(r.x, r.y),
      ...point(r.x + r.w, r.y),
      ...point(r.x, r.y + r.h),
      ...point(r.x + r.w, r.y + r.h),
    ]);
    const xs = quads.filter((_, i) => i % 2 === 0),
      ys = quads.filter((_, i) => i % 2);
    const bounds = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
    dict.set(PDFName.of('Rect'), pdf.context.obj(bounds));
    dict.set(PDFName.of('QuadPoints'), pdf.context.obj(quads));
    const lines = rects.map((r) => {
      const a = point(r.x, r.y + r.h),
        b = point(r.x + r.w, r.y + r.h);
      return `${a[0] - bounds[0]} ${a[1] - bounds[1]} m ${b[0] - bounds[0]} ${b[1] - bounds[1]} l S`;
    });
    const appearance = pdf.context.flateStream(`q ${color.join(' ')} RG 1 w\n${lines.join('\n')}\nQ`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, bounds[2] - bounds[0], bounds[3] - bounds[1]],
      Resources: {},
    });
    dict.set(PDFName.of('AP'), pdf.context.obj({ N: pdf.context.register(appearance) }));
  } else {
    dict.set(
      PDFName.of('Rect'),
      pdf.context.obj(rectangle(note.x, note.y, 18 / viewport.width, 18 / viewport.height)),
    );
    dict.set(PDFName.of('Name'), PDFName.of('Comment'));
    dict.set(PDFName.of('Open'), pdf.context.obj(false));
  }
  const parent = pdf.context.register(dict);
  const popup = pdf.context.register(
    pdf.context.obj({
      Type: 'Annot',
      Subtype: 'Popup',
      Parent: parent,
      P: page.ref,
      Open: false,
      Rect: rectangle(
        note.x,
        note.y,
        Math.max(40 / viewport.width, note.width || note.boxWidth || 0.3),
        Math.max(40 / viewport.height, note.boxHeight || 0.12),
      ),
    }),
  );
  dict.set(PDFName.of('Popup'), popup);
  page.node.addAnnot(parent);
  page.node.addAnnot(popup);
}

export function wrapAnnotationText(text, measure, width) {
  const lines = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const character of paragraph) {
      if (line && measure(line + character) > width) {
        const space = line.search(/\s+\S*$/u);
        if (space > 0) {
          lines.push(line.slice(0, space + 1));
          line = line.slice(space + 1);
        } else {
          lines.push(line);
          line = '';
        }
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}
