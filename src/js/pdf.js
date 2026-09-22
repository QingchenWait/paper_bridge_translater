import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { all, put, patch, get, database } from './storage.js';
import { uid } from './utils.js';
import { planSelectionAction, selectionActionState } from './selection-actions.js';
import { drawShape, shapeGeometry, hitShape, translateAnnotation, distanceToSegment } from './shapes.js';
import { renderAlignedText } from './pdf-text.js';
import { indexPageText, findPageMatches } from './pdf-search.js';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const base = import.meta.env.BASE_URL;
export async function loadPdf(blob, onPassword) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: `${base}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}pdfjs/standard_fonts/`,
    wasmUrl: `${base}pdfjs/wasm/`,
    isEvalSupported: false,
  });
  task.onPassword = async (update, reason) => {
    try {
      const password = await onPassword?.(reason);
      if (password == null) await task.destroy();
      else update(password);
    } catch {
      await task.destroy();
    }
  };
  const pdf = await task.promise;
  // PDF.js 6 exposes destruction on the loading task, not PDFDocumentProxy.
  pdf.destroy = () => task.destroy();
  return pdf;
}
export async function extractPdfText(pdf, onProgress = () => {}) {
  const pages = [];
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (item.str === undefined) continue;
      const x = item.transform[4];
      if (/^\d{1,4}$/.test(item.str.trim()) && (x < viewport.width * 0.07 || x > viewport.width * 0.92))
        continue;
      line += item.str + (item.hasEOL ? '\n' : ' ');
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line) lines.push(line);
    pages.push(`[第 ${index} 页]\n${lines.join('')}`);
    onProgress(index, pdf.numPages);
  }
  return pages.join('\n\n');
}
export class PdfViewer {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.generation = 0;
    this.tool = 'select';
    this.color = '#ffe082';
    this.tasks = new Map();
    this.rendered = new Map();
    this.history = new Map();
    this.future = new Map();
    this.scale = 1;
    this.textLayers = new Map();
    this.pageContents = new Map();
    this.searchMatches = new Map();
    this.drawingOptions = { noteSize: 12, textSize: 14, penWidth: 2, shape: 'rectangle' };
    this.pointers = new Set();
    this.selectionPointers = new Set();
    this.touchCount = 0;
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (container.contains(event.target)) {
          this.pointers.add(event.pointerId);
          clearTimeout(this.releaseTimer);
          this.selectionPointers.add(event.pointerId);
          this.translatedSelectionKey = '';
        }
      },
      true,
    );
    document.addEventListener(
      'pointerup',
      (event) => {
        this.pointers.delete(event.pointerId);
        const fromPdf = this.selectionPointers.delete(event.pointerId) || container.contains(event.target);
        if (fromPdf) this.queueSelectionTranslation(event.pointerType === 'touch' ? 60 : 0);
      },
      true,
    );
    document.addEventListener(
      'pointercancel',
      (event) => {
        this.pointers.delete(event.pointerId);
        this.selectionPointers.delete(event.pointerId);
        clearTimeout(this.releaseTimer);
      },
      true,
    );
    document.addEventListener(
      'touchstart',
      (event) => {
        if (container.contains(event.target) || this.pdfTouch) {
          this.touchCount = event.touches.length;
          this.pdfTouch = true;
          clearTimeout(this.releaseTimer);
        }
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'touchend',
      (event) => {
        this.touchCount = event.touches.length;
        if (!this.touchCount && this.pdfTouch) {
          this.pdfTouch = false;
          this.queueSelectionTranslation(60);
        }
      },
      { capture: true, passive: true },
    );
    document.addEventListener(
      'touchcancel',
      () => {
        this.touchCount = 0;
        this.pdfTouch = false;
        clearTimeout(this.releaseTimer);
      },
      { capture: true, passive: true },
    );
    window.addEventListener('blur', () => {
      this.pointers.clear();
      this.selectionPointers.clear();
      this.touchCount = 0;
      clearTimeout(this.releaseTimer);
    });
    document.addEventListener('selectionchange', () => {
      clearTimeout(this.selectionTimer);
      this.selectionTimer = setTimeout(
        () => {
          if (!document.activeElement?.closest('#pdf-toolbar, #overlay-root, #color-popover'))
            this.captureSelection();
        },
        matchMedia('(pointer: coarse)').matches ? 250 : 60,
      );
    });
    document.addEventListener('keyup', (event) => {
      if (
        ['Shift', 'Control', 'Meta'].includes(event.key) ||
        (!event.shiftKey &&
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
      )
        this.queueSelectionTranslation();
    });
  }
  queueSelectionTranslation(delay = 0) {
    clearTimeout(this.releaseTimer);
    if (this.pointers.size || this.touchCount || this.annotationDrag) return;
    if (delay) this.releaseTimer = setTimeout(() => this.captureSelection({ translate: true }), delay);
    else this.captureSelection({ translate: true });
  }
  setDrawingOptions(options) {
    this.drawingOptions = { ...this.drawingOptions, ...options };
  }
  async open(doc, pdf) {
    this.cancelAnnotationDrag?.();
    this.generation++;
    this.observer?.disconnect();
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
    this.rendered.clear();
    this.textLayers.clear();
    this.pageContents.clear();
    this.searchMatches.clear();
    this.container.replaceChildren();
    this.selection = null;
    this.callbacks.selectionState?.({});
    this.doc = doc;
    this.pdf = pdf;
    this.page = doc.page || 1;
    this.zoom = doc.zoom || 'fit';
    this.annotations = (await all('annotations')).filter((a) => a.documentId === doc.id);
    await this.layout();
    this.notifyHistory();
  }
  async layout() {
    this.cancelAnnotationDrag?.();
    this.clearSelection();
    const generation = ++this.generation;
    this.observer?.disconnect();
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
    this.rendered.clear();
    this.textLayers.clear();
    const first = await this.pdf.getPage(1);
    if (generation !== this.generation) return;
    const vp = first.getViewport({ scale: 1 });
    this.layoutWidth = this.container.clientWidth;
    this.layoutDpr = window.devicePixelRatio || 1;
    this.scale =
      this.zoom === 'fit' ? Math.max(0.25, (this.container.clientWidth - 44) / vp.width) : Number(this.zoom);
    this.container.replaceChildren();
    this.container.style.setProperty('--scale-factor', this.scale);
    this.container.style.setProperty('--total-scale-factor', this.scale);
    for (let index = 1; index <= this.pdf.numPages; index++) {
      const shell = document.createElement('div');
      shell.className = 'pdf-page';
      shell.dataset.page = index;
      shell.style.width = `${vp.width * this.scale}px`;
      shell.style.height = `${vp.height * this.scale}px`;
      shell.setAttribute('aria-label', `PDF 第 ${index} 页`);
      this.container.append(shell);
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const number = Number(entry.target.dataset.page);
          if (entry.isIntersecting)
            this.renderPage(number, generation).catch((error) => this.callbacks.error(error));
          else if (this.rendered.has(number)) {
            this.tasks.get(number)?.cancel();
            entry.target.replaceChildren();
            this.rendered.delete(number);
            this.textLayers.delete(number);
          }
        }
      },
      { root: this.container, rootMargin: '650px 0px' },
    );
    [...this.container.children].forEach((page) => this.observer.observe(page));
    this.container.onscroll = () => {
      cancelAnimationFrame(this.scrollFrame);
      this.scrollFrame = requestAnimationFrame(() => {
        const top = this.container.getBoundingClientRect().top;
        const pages = [...this.container.children];
        const current = pages.find(
          (el) => el.getBoundingClientRect().bottom > top + this.container.clientHeight * 0.25,
        );
        if (current && this.page !== Number(current.dataset.page)) {
          this.page = Number(current.dataset.page);
          this.callbacks.page(this.page);
        }
      });
    };
    this.goTo(this.page);
    this.setTool(this.tool, this.color);
  }
  renderPage(number, generation = this.generation) {
    if (generation !== this.generation) return Promise.resolve();
    if (this.rendered.has(number)) return this.rendered.get(number);
    const pending = this.paintPage(number, generation);
    this.rendered.set(number, pending);
    return pending;
  }
  async paintPage(number, generation) {
    const shell = this.container.querySelector(`[data-page="${number}"]`);
    if (!shell) return;
    const page = await this.pdf.getPage(number);
    if (generation !== this.generation) return;
    const viewport = page.getViewport({ scale: this.scale });
    // Bound each rendered page to six million pixels, including 4K/high-DPI screens.
    const ratio = Math.min(
      Math.max(devicePixelRatio || 1, 2, 1.5 / this.scale),
      Math.sqrt(6000000 / (viewport.width * viewport.height)),
    );
    shell.style.width = `${viewport.width}px`;
    shell.style.height = `${viewport.height}px`;
    shell.dataset.baseWidth = viewport.width / this.scale;
    shell.dataset.baseHeight = viewport.height / this.scale;
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    const text = document.createElement('div');
    text.className = 'textLayer';
    const annotations = document.createElement('div');
    annotations.className = 'annotations';
    const search = document.createElement('div');
    search.className = 'search-highlights';
    const ink = document.createElement('canvas');
    ink.className = 'ink-layer';
    ink.width = canvas.width;
    ink.height = canvas.height;
    shell.replaceChildren(canvas, annotations, search, text, ink);
    const task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: [canvas.width / viewport.width, 0, 0, canvas.height / viewport.height, 0, 0],
    });
    this.tasks.set(number, task);
    try {
      await task.promise;
    } catch (error) {
      if (error.name !== 'RenderingCancelledException') throw error;
      return;
    } finally {
      if (this.tasks.get(number) === task) this.tasks.delete(number);
    }
    if (generation !== this.generation || !canvas.isConnected) return;
    const content = await this.getPageContent(number);
    const layer = await renderAlignedText(page, content, text, viewport);
    if (generation !== this.generation || !canvas.isConnected) return;
    this.textLayers.set(number, layer);
    this.drawSearchMatches(number);
    this.drawAnnotations(number);
    this.bindInk(ink, number);
    shell.onpointerdown = (event) => this.startAnnotationDrag(event, number);
    this.setTool(this.tool, this.color);
  }
  goTo(page) {
    this.page = Math.min(this.pdf.numPages, Math.max(1, Number(page) || 1));
    const shell = this.container.querySelector(`[data-page="${this.page}"]`);
    if (shell) this.container.scrollTop = shell.offsetTop - 18;
    this.callbacks.page(this.page);
  }
  async setZoom(zoom) {
    this.zoom = zoom;
    await this.layout();
  }
  getPageContent(number) {
    if (!this.pageContents.has(number))
      this.pageContents.set(
        number,
        this.pdf.getPage(number).then((page) => page.getTextContent()),
      );
    return this.pageContents.get(number);
  }
  async search(query, options = {}, { signal, onProgress = () => {} } = {}) {
    const pdf = this.pdf;
    this.searchMatches.clear();
    for (const page of this.textLayers.keys()) this.drawSearchMatches(page);
    const results = [];
    if (!query.trim()) return results;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted();
      if (this.pdf !== pdf) throw new DOMException('文档已切换', 'AbortError');
      const content = await this.getPageContent(number);
      signal?.throwIfAborted();
      const matches = findPageMatches(indexPageText(content.items), query, options).map((match, index) => ({
        ...match,
        page: number,
        id: `${number}-${index}`,
      }));
      this.searchMatches.set(number, matches);
      results.push(...matches);
      this.drawSearchMatches(number);
      onProgress(number, pdf.numPages, results.length);
    }
    return results;
  }
  matchRects(match) {
    const layer = this.textLayers.get(match.page),
      shell = this.container.querySelector(`[data-page="${match.page}"]`);
    if (!layer || !shell) return [];
    const bounds = shell.getBoundingClientRect();
    return match.parts.flatMap((part) => {
      const span = layer.byItem.get(part.itemIndex);
      if (!span?.firstChild) return [];
      const range = document.createRange();
      range.setStart(span.firstChild, Math.min(part.start, span.textContent.length));
      range.setEnd(span.firstChild, Math.min(part.end, span.textContent.length));
      return [...range.getClientRects()]
        .filter((r) => r.width && r.height)
        .map((r) => ({
          x: (r.left - bounds.left) / bounds.width,
          y: (r.top - bounds.top) / bounds.height,
          w: r.width / bounds.width,
          h: r.height / bounds.height,
        }));
    });
  }
  drawSearchMatches(page) {
    const layer = this.container.querySelector(`[data-page="${page}"] .search-highlights`);
    if (!layer) return;
    layer.replaceChildren();
    for (const match of this.searchMatches.get(page) || [])
      for (const rect of this.matchRects(match)) {
        const mark = document.createElement('span');
        mark.className = 'search-hit';
        mark.dataset.matchId = match.id;
        Object.assign(mark.style, {
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
        });
        layer.append(mark);
      }
  }
  async revealSearchMatch(match) {
    await this.renderPage(match.page);
    const rect = this.matchRects(match)[0];
    if (rect) await this.goToLocation(match.page, rect);
    else this.goTo(match.page);
  }
  async goToLocation(page, rect) {
    const generation = this.generation;
    await this.renderPage(page);
    if (generation !== this.generation) return;
    const shell = this.container.querySelector(`[data-page="${page}"]`);
    if (!shell) return;
    this.container.scrollTop = Math.max(
      0,
      shell.offsetTop + (rect?.y || 0) * shell.clientHeight - this.container.clientHeight * 0.25,
    );
    this.container.scrollLeft = Math.max(
      0,
      shell.offsetLeft + (rect?.x || 0) * shell.clientWidth - this.container.clientWidth * 0.35,
    );
    this.page = page;
    this.callbacks.page(page);
  }
  setTool(tool, color) {
    this.tool = tool;
    this.color = color;
    this.container.dataset.tool = tool;
    this.container
      .querySelectorAll('.ink-layer')
      .forEach(
        (el) =>
          (el.style.pointerEvents = ['pen', 'eraser', 'text', 'shape'].includes(tool) ? 'auto' : 'none'),
      );
  }
  captureSelection({ translate = false } = {}) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) {
      this.clearSelection(false);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!this.container.contains(range.commonAncestorContainer)) {
      this.clearSelection(false);
      return;
    }
    const value = selection.toString().trim();
    if (!value) return;
    const rects = [];
    for (const page of this.container.querySelectorAll('.pdf-page')) {
      const bounds = page.getBoundingClientRect();
      const selectedRects = [];
      for (const span of page.querySelectorAll('.textLayer span:not(.markedContent)')) {
        if (!range.intersectsNode(span) || !span.textContent) continue;
        const part = document.createRange();
        part.selectNodeContents(span);
        if (span.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
        if (span.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
        if (part.collapsed) continue;
        selectedRects.push(...part.getClientRects());
      }
      for (const rect of selectedRects) {
        if (
          rect.width < 1 ||
          rect.height < 1 ||
          rect.bottom <= bounds.top ||
          rect.top >= bounds.bottom ||
          rect.right <= bounds.left ||
          rect.left >= bounds.right
        )
          continue;
        const r = {
          page: Number(page.dataset.page),
          x: Math.max(0, (rect.left - bounds.left) / bounds.width),
          y: Math.max(0, (rect.top - bounds.top) / bounds.height),
          w: Math.min(1, rect.width / bounds.width),
          h: Math.min(1, rect.height / bounds.height),
        };
        if (
          !rects.some(
            (old) =>
              old.page === r.page &&
              Math.abs(old.x - r.x) < 0.001 &&
              Math.abs(old.y - r.y) < 0.001 &&
              Math.abs(old.w - r.w) < 0.001,
          )
        )
          rects.push(r);
      }
    }
    const key = JSON.stringify({ documentId: this.doc.id, text: value, rects });
    this.selection = { text: value, rects };
    this.callbacks.selectionState?.(selectionActionState(this.annotations, this.selection));
    if (
      translate &&
      !this.pointers.size &&
      !this.touchCount &&
      rects.length &&
      key !== this.translatedSelectionKey
    ) {
      this.translatedSelectionKey = key;
      this.callbacks.selection(value);
    }
  }
  clearSelection(clearNative = true) {
    this.selection = null;
    this.translatedSelectionKey = '';
    clearTimeout(this.releaseTimer);
    if (clearNative) window.getSelection()?.removeAllRanges();
    this.callbacks.selectionState?.({});
  }
  async applySelectionAction(type, color) {
    if (this.selectionBusy || !this.selection?.rects.length) return false;
    this.selectionBusy = true;
    const documentId = this.doc.id;
    const selection = structuredClone(this.selection);
    try {
      const changes = await planSelectionAction(type, this.annotations, selection, {
        color,
        inputText: this.callbacks.inputText,
        fontSize: this.drawingOptions.noteSize,
      });
      if (!changes.length || this.doc.id !== documentId) return false;
      const now = Date.now();
      for (const change of changes) {
        change.after = {
          id: uid(),
          documentId,
          createdAt: now,
          deleted: false,
          ...change.after,
          updatedAt: now,
        };
      }
      await this.commitAnnotationChanges(changes.map((c) => c.after));
      this.history.set(documentId, [
        ...(this.history.get(documentId) || []),
        { changes, location: selection.rects[0] },
      ]);
      this.future.set(documentId, []);
      this.notifyHistory();
      this.clearSelection();
      this.callbacks.saved();
      return true;
    } finally {
      this.selectionBusy = false;
    }
  }
  async commitAnnotationChanges(rows) {
    const tx = (await database()).transaction('annotations', 'readwrite');
    for (const row of rows) await tx.store.put({ ...row, updatedAt: Date.now() });
    await tx.done;
    for (const row of rows) {
      if (row.documentId !== this.doc.id) continue;
      const i = this.annotations.findIndex((a) => a.id === row.id);
      if (i < 0) this.annotations.push(row);
      else this.annotations[i] = row;
    }
    for (const page of new Set(rows.map((r) => r.page))) this.drawAnnotations(page);
  }
  async addAnnotation(value) {
    const documentId = this.doc.id;
    const row = await put('annotations', {
      id: uid(),
      documentId,
      ...value,
      createdAt: Date.now(),
      deleted: false,
    });
    this.history.set(documentId, [
      ...(this.history.get(documentId) || []),
      { id: row.id, before: true, after: false },
    ]);
    this.future.set(documentId, []);
    if (this.doc.id === documentId) {
      this.annotations.push(row);
      this.drawAnnotations(row.page);
    }
    this.callbacks.saved();
    this.notifyHistory();
    return row;
  }
  historyState() {
    return {
      undo: !this.historyBusy && Boolean(this.history.get(this.doc?.id)?.length),
      redo: !this.historyBusy && Boolean(this.future.get(this.doc?.id)?.length),
    };
  }
  notifyHistory() {
    this.callbacks.historyState?.(this.historyState());
  }
  annotationLocation(annotation) {
    const point = ['note', 'text'].includes(annotation.type)
      ? annotation
      : annotation.rects?.[0] || annotation.points?.[0] || annotation.start || annotation;
    return { page: annotation.page, x: point.x || 0, y: point.y || 0 };
  }
  async undo(redo = false) {
    if (this.historyBusy || !this.doc) return;
    this.cancelAnnotationDrag?.();
    const from = redo ? this.future : this.history;
    const to = redo ? this.history : this.future;
    const id = this.doc.id;
    const stack = from.get(id) || [];
    const action = stack.pop();
    if (!action) return;
    this.historyBusy = true;
    this.notifyHistory();
    try {
      let focused;
      if (action.changes) {
        await this.commitAnnotationChanges(
          action.changes.map((change) =>
            redo ? change.after : change.before || { ...change.after, deleted: true },
          ),
        );
        const change = action.changes[0];
        focused = redo ? change.after : change.before || change.after;
      } else {
        focused = await patch('annotations', action.id, { deleted: redo ? action.after : action.before });
        if (this.doc.id === id) {
          this.annotations = this.annotations.map((a) => (a.id === focused.id ? focused : a));
          this.drawAnnotations(focused.page);
        }
      }
      to.set(id, [...(to.get(id) || []), action]);
      if (this.doc.id === id) {
        this.callbacks.selectionState?.(selectionActionState(this.annotations, this.selection));
        const location = action.location || this.annotationLocation(focused);
        await this.goToLocation(location.page, location);
      }
      this.callbacks.saved();
    } catch (error) {
      if (!(to.get(id) || []).includes(action)) stack.push(action);
      throw error;
    } finally {
      this.historyBusy = false;
      this.notifyHistory();
    }
  }
  async editAnnotation(annotation) {
    const result = await this.callbacks.editAnnotation(annotation);
    if (!result) return;
    const row = await patch('annotations', annotation.id, result);
    this.history.set(annotation.documentId, [
      ...(this.history.get(annotation.documentId) || []),
      { changes: [{ before: structuredClone(annotation), after: row }] },
    ]);
    this.future.set(annotation.documentId, []);
    this.notifyHistory();
    this.annotations = this.annotations.map((a) => (a.id === row.id ? row : a));
    this.drawAnnotations(row.page);
    this.callbacks.saved();
  }
  startAnnotationDrag(event, page) {
    if (event.button !== 0 || this.annotationDrag || this.tool === 'eraser') return;
    const shell = this.container.querySelector(`[data-page="${page}"]`);
    if (!shell) return;
    const bounds = shell.getBoundingClientRect(),
      point = {
        x: (event.clientX - bounds.left) / bounds.width,
        y: (event.clientY - bounds.top) / bounds.height,
      };
    const element = event.target.closest('[data-annotation-id]');
    const annotation = element
      ? this.annotations.find((a) => a.id === element.dataset.annotationId && !a.deleted)
      : this.tool === 'select'
        ? this.annotations
            .filter((a) => a.page === page && a.type === 'shape' && !a.deleted)
            .reverse()
            .find((a) =>
              hitShape(
                a,
                point,
                Number(shell.dataset.baseWidth),
                Number(shell.dataset.baseHeight),
                8 / this.scale,
              ),
            )
        : null;
    if (!annotation) return;
    event.preventDefault();
    event.stopPropagation();
    this.clearSelection();
    const before = structuredClone(annotation),
      start = { x: event.clientX, y: event.clientY };
    const elementBounds = element?.getBoundingClientRect();
    const box = {
      w: (elementBounds?.width || 0) / bounds.width,
      h: (elementBounds?.height || 0) / bounds.height,
    };
    const drag = (this.annotationDrag = { before, after: before, moved: false });
    shell.setPointerCapture(event.pointerId);
    shell.classList.add('annotation-dragging');
    const cleanup = () => {
      shell.removeEventListener('pointermove', move);
      shell.removeEventListener('pointerup', end);
      shell.removeEventListener('pointercancel', cancel);
      shell.classList.remove('annotation-dragging');
      if (shell.hasPointerCapture(event.pointerId)) shell.releasePointerCapture(event.pointerId);
      this.annotationDrag = null;
      this.cancelAnnotationDrag = null;
    };
    const move = (e) => {
      if (e.pointerId !== event.pointerId) return;
      const dx = e.clientX - start.x,
        dy = e.clientY - start.y;
      if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true;
      drag.after = translateAnnotation(before, dx / bounds.width, dy / bounds.height, box);
      this.annotations = this.annotations.map((a) => (a.id === before.id ? drag.after : a));
      this.drawAnnotations(page);
    };
    const cancel = () => {
      cleanup();
      this.annotations = this.annotations.map((a) => (a.id === before.id ? before : a));
      this.drawAnnotations(page);
    };
    const end = async (e) => {
      if (e.pointerId !== event.pointerId) return;
      cleanup();
      if (!drag.moved) {
        if (before.type !== 'shape') this.editAnnotation(before).catch(this.callbacks.error);
        return;
      }
      try {
        await this.commitAnnotationChanges([drag.after]);
        this.history.set(before.documentId, [
          ...(this.history.get(before.documentId) || []),
          { changes: [{ before, after: drag.after }] },
        ]);
        this.future.set(before.documentId, []);
        this.notifyHistory();
        this.callbacks.saved();
      } catch (error) {
        this.annotations = this.annotations.map((a) => (a.id === before.id ? before : a));
        this.drawAnnotations(page);
        this.callbacks.error(error);
      }
    };
    this.cancelAnnotationDrag = cancel;
    shell.addEventListener('pointermove', move);
    shell.addEventListener('pointerup', end);
    shell.addEventListener('pointercancel', cancel);
  }
  drawAnnotations(pageNumber) {
    const shell = this.container.querySelector(`[data-page="${pageNumber}"]`);
    const layer = shell?.querySelector('.annotations');
    const canvas = shell?.querySelector('.ink-layer');
    if (!layer || !canvas) return;
    layer.replaceChildren();
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const annotation of this.annotations.filter((a) => a.page === pageNumber && !a.deleted)) {
      if (annotation.type === 'pen' || annotation.type === 'shape') {
        const width = Number(shell.dataset.baseWidth),
          height = Number(shell.dataset.baseHeight);
        ctx.save();
        ctx.scale(canvas.width / width, canvas.height / height);
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = annotation.strokeWidth || 1.6;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        if (annotation.type === 'shape') drawShape(ctx, annotation, width, height);
        else {
          annotation.points.forEach((point, i) =>
            ctx[i ? 'lineTo' : 'moveTo'](point.x * width, point.y * height),
          );
          ctx.stroke();
        }
        ctx.restore();
        if (annotation.type === 'shape') {
          const geometry = shapeGeometry(annotation, width, height);
          const handle = (x, y, w, h, angle = 0, round = false) => {
            const element = document.createElement('button');
            element.className = 'annotation-shape-handle';
            element.dataset.annotationId = annotation.id;
            element.setAttribute('aria-label', '拖动形状');
            Object.assign(element.style, {
              left: `${(x / width) * 100}%`,
              top: `${(y / height) * 100}%`,
              width: `${(w / width) * 100}%`,
              height: `${(h / height) * 100}%`,
              transform: `rotate(${angle}rad)`,
              borderRadius: round ? '50%' : '0',
            });
            layer.append(element);
          };
          if (geometry.type === 'rectangle') handle(geometry.x, geometry.y, geometry.width, geometry.height);
          else if (geometry.type === 'circle')
            handle(
              geometry.x - geometry.radius,
              geometry.y - geometry.radius,
              geometry.radius * 2,
              geometry.radius * 2,
              0,
              true,
            );
          else {
            const thickness = Math.max(annotation.strokeWidth || 2, 12 / this.scale);
            for (const [start, end] of geometry.segments)
              handle(
                start.x,
                start.y - thickness / 2,
                Math.hypot(end.x - start.x, end.y - start.y),
                thickness,
                Math.atan2(end.y - start.y, end.x - start.x),
              );
          }
        }
      } else if (['highlight', 'underline', 'strike'].includes(annotation.type)) {
        for (const rect of annotation.rects) {
          const element = document.createElement('span');
          element.className = `mark mark-${annotation.type}`;
          Object.assign(element.style, {
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          });
          element.style.setProperty('--mark-color', annotation.color);
          layer.append(element);
        }
      } else {
        const element = document.createElement('button');
        element.className = `annotation-${annotation.type}`;
        element.dataset.annotationId = annotation.id;
        element.textContent = annotation.text;
        element.title = '点击编辑批注';
        element.style.left = `${annotation.x * 100}%`;
        element.style.top = `${annotation.y * 100}%`;
        element.style.setProperty('--annotation-color', annotation.color);
        if (annotation.type === 'text' || annotation.fontSize)
          element.style.fontSize = `${(annotation.fontSize || 14) * this.scale}px`;
        element.onclick = (event) => {
          if (event.detail === 0) this.editAnnotation(annotation).catch(this.callbacks.error);
        };
        layer.append(element);
      }
    }
  }
  bindInk(canvas, page) {
    let points = null;
    let previous;
    let gesture;
    const point = (event) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (event.clientY - r.top) / r.height)),
      };
    };
    canvas.onpointerdown = async (event) => {
      const start = point(event);
      const tool = this.tool;
      const documentId = this.doc.id;
      if (tool === 'pen' || tool === 'shape') {
        gesture = {
          tool,
          color: this.color,
          strokeWidth: tool === 'pen' ? this.drawingOptions.penWidth : 2,
          shape: this.drawingOptions.shape,
          documentId,
        };
        points = [start];
        previous = start;
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      } else if (tool === 'eraser') {
        const hit = this.annotations
          .filter((a) => a.page === page && !a.deleted && ['pen', 'shape'].includes(a.type))
          .reverse()
          .find((a) =>
            a.type === 'shape'
              ? hitShape(
                  a,
                  start,
                  Number(canvas.parentElement.dataset.baseWidth),
                  Number(canvas.parentElement.dataset.baseHeight),
                  18 / this.scale,
                )
              : a.points.some(
                  (p, i) =>
                    distanceToSegment(
                      { x: start.x * canvas.clientWidth, y: start.y * canvas.clientHeight },
                      { x: p.x * canvas.clientWidth, y: p.y * canvas.clientHeight },
                      {
                        x: (a.points[i + 1] || p).x * canvas.clientWidth,
                        y: (a.points[i + 1] || p).y * canvas.clientHeight,
                      },
                    ) < 18,
                ),
          );
        if (hit) {
          await patch('annotations', hit.id, { deleted: true });
          hit.deleted = true;
          this.history.set(documentId, [
            ...(this.history.get(documentId) || []),
            { id: hit.id, before: false, after: true },
          ]);
          this.future.set(documentId, []);
          this.notifyHistory();
          this.drawAnnotations(page);
          this.callbacks.saved();
        }
      } else if (tool === 'text') {
        const fontSize = this.drawingOptions.textSize,
          color = this.color;
        try {
          const text = await this.callbacks.inputText(tool);
          if (text && this.doc.id === documentId)
            await this.addAnnotation({ type: tool, color, page, ...start, text, fontSize });
        } catch (error) {
          this.callbacks.error(error);
        }
      }
    };
    canvas.onpointermove = (event) => {
      if (!points) return;
      const next = point(event);
      if (gesture.tool === 'shape') {
        points = [points[0], next];
        this.drawAnnotations(page);
        const shell = canvas.parentElement,
          width = Number(shell.dataset.baseWidth),
          height = Number(shell.dataset.baseHeight);
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.scale(canvas.width / width, canvas.height / height);
        ctx.strokeStyle = gesture.color;
        ctx.lineWidth = gesture.strokeWidth;
        ctx.lineCap = 'round';
        drawShape(ctx, { ...gesture, start: points[0], end: next }, width, height);
        ctx.restore();
        return;
      }
      points.push(next);
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = gesture.color;
      ctx.lineWidth = (gesture.strokeWidth * canvas.width) / Number(canvas.parentElement.dataset.baseWidth);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(previous.x * canvas.width, previous.y * canvas.height);
      ctx.lineTo(next.x * canvas.width, next.y * canvas.height);
      ctx.stroke();
      previous = next;
    };
    const end = () => {
      if (!points) return;
      const completed = points;
      points = null;
      if (this.doc.id !== gesture.documentId) return;
      const annotation =
        gesture.tool === 'shape'
          ? { type: 'shape', shape: gesture.shape, start: completed[0], end: completed.at(-1) }
          : { type: 'pen', points: completed };
      if (completed.length < 2) {
        this.drawAnnotations(page);
        return;
      }
      this.addAnnotation({
        ...annotation,
        color: gesture.color,
        strokeWidth: gesture.strokeWidth,
        page,
      }).catch(this.callbacks.error);
    };
    canvas.onpointerup = end;
    canvas.onpointercancel = end;
  }
}
