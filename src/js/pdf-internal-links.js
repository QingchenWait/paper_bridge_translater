// Native PDF link destinations only. Text selection owns pointer gestures;
// links activate on a short click/tap, not on drag-selection or editing tools.
export function linkRects(annotation, viewport) {
  const rects = [];
  const quads = annotation.quadPoints;
  if (quads?.length)
    for (let i = 0; i + 7 < quads.length; i += 8) {
      const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]];
      const ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
      rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
  else if (annotation.rect?.length === 4) rects.push(annotation.rect);
  return rects
    .map(([x1, y1, x2, y2]) => [
      ...viewport.convertToViewportPoint(x1, y1),
      ...viewport.convertToViewportPoint(x2, y2),
    ])
    .map(([x1, y1, x2, y2]) => ({
      x: Math.max(0, Math.min(x1, x2)),
      y: Math.max(0, Math.min(y1, y2)),
      right: Math.min(viewport.width, Math.max(x1, x2)),
      bottom: Math.min(viewport.height, Math.max(y1, y2)),
    }))
    .filter((r) => r.right > r.x && r.bottom > r.y);
}
export async function resolvePdfDestination(pdf, dest) {
  const value = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(value) || value.length < 2) return null;
  const index = Number.isInteger(value[0]) ? value[0] : await pdf.getPageIndex(value[0]);
  if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return null;
  const page = await pdf.getPage(index + 1),
    viewport = page.getViewport({ scale: 1 });
  const [left, , , top] = page.view;
  const mode = value[1]?.name;
  let x = left,
    y = top;
  if (mode === 'XYZ') {
    x = Number.isFinite(value[2]) ? value[2] : left;
    y = Number.isFinite(value[3]) ? value[3] : top;
  } else if (mode === 'FitH' || mode === 'FitBH') y = Number.isFinite(value[2]) ? value[2] : top;
  else if (mode === 'FitV' || mode === 'FitBV') x = Number.isFinite(value[2]) ? value[2] : left;
  else if (mode === 'FitR') {
    x = Number.isFinite(value[2]) ? value[2] : left;
    y = Number.isFinite(value[5]) ? value[5] : top;
  }
  const point = viewport.convertToViewportPoint(x, y);
  return {
    page: index + 1,
    rect: {
      x: Math.max(0, Math.min(1, point[0] / viewport.width)),
      y: Math.max(0, Math.min(1, point[1] / viewport.height)),
    },
  };
}
export function mountInternalLinks(viewer, shell, annotations, viewport, generation) {
  shell.clearInternalLinks?.();
  const pdf = viewer.pdf,
    entries = [],
    layer = document.createElement('div');
  layer.className = 'pdf-internal-links';
  const current = () => viewer.pdf === pdf && viewer.generation === generation && layer.isConnected;
  for (const annotation of annotations) {
    if (annotation.subtype !== 'Link' || !annotation.dest || annotation.url || annotation.action) continue;
    for (const rect of linkRects(annotation, viewport)) {
      const link = document.createElement('a');
      link.className = 'pdf-internal-link';
      link.href = '#';
      link.title = '跳转到文档内引用';
      link.setAttribute('aria-label', '跳转到文档内引用');
      Object.assign(link.style, {
        left: `${(rect.x / viewport.width) * 100}%`,
        top: `${(rect.y / viewport.height) * 100}%`,
        width: `${((rect.right - rect.x) / viewport.width) * 100}%`,
        height: `${((rect.bottom - rect.y) / viewport.height) * 100}%`,
      });
      const activate = async () => {
        const target = await resolvePdfDestination(pdf, annotation.dest);
        if (target && current()) await viewer.goToLocation(target.page, target.rect);
      };
      link.onclick = (event) => {
        event.preventDefault();
        if (viewer.tool === 'select' && !viewer.textAnnotations.active)
          activate().catch(viewer.callbacks.error);
      };
      entries.push({ rect, link, activate });
      layer.append(link);
    }
  }
  shell.append(layer);
  let start;
  let hovered;
  const eligible = (event) =>
    viewer.tool === 'select' &&
    !viewer.textAnnotations.active &&
    !event.target.closest('[data-annotation-id],.annotation-tools,[data-resize]');
  const down = (event) => {
    start =
      eligible(event) && event.button === 0
        ? { x: event.clientX, y: event.clientY, time: Date.now(), id: event.pointerId }
        : null;
  };
  const cancel = () => {
    start = null;
  };
  const hitAt = (event) => {
    const bounds = shell.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) * viewport.width) / bounds.width;
    const y = ((event.clientY - bounds.top) * viewport.height) / bounds.height;
    return entries.find(({ rect }) => x >= rect.x && x <= rect.right && y >= rect.y && y <= rect.bottom);
  };
  const hover = (event) => {
    const hit = event && !event.buttons && eligible(event) ? hitAt(event) : null;
    if (hit === hovered) return;
    hovered?.link.classList.remove('is-hovered');
    hovered = hit;
    hovered?.link.classList.add('is-hovered');
    shell.classList.toggle('over-pdf-link', Boolean(hit));
  };
  const leave = () => hover();
  const click = (event) => {
    const pressed = start;
    start = null;
    if (
      !pressed ||
      !current() ||
      !eligible(event) ||
      event.target.closest('.pdf-internal-link') ||
      Date.now() - pressed.time > 500 ||
      Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 5 ||
      !window.getSelection()?.isCollapsed
    )
      return;
    const hit = hitAt(event);
    if (hit) {
      event.preventDefault();
      hit.activate().catch(viewer.callbacks.error);
    }
  };
  shell.addEventListener('pointerdown', down);
  shell.addEventListener('pointercancel', cancel);
  shell.addEventListener('click', click);
  shell.addEventListener('pointermove', hover, { passive: true });
  shell.addEventListener('pointerleave', leave);
  shell.clearInternalLinks = () => {
    shell.removeEventListener('pointerdown', down);
    shell.removeEventListener('pointercancel', cancel);
    shell.removeEventListener('click', click);
    shell.removeEventListener('pointermove', hover);
    shell.removeEventListener('pointerleave', leave);
    leave();
  };
}
