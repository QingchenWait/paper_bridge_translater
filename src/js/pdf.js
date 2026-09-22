import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { all, put, patch, get, database } from './storage.js';
import { uid } from './utils.js';
import { planSelectionAction, selectionActionState } from './selection-actions.js';
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
    container.addEventListener('pointerup', (event) => {
      if (event.pointerType !== 'touch') setTimeout(() => this.captureSelection(), 10);
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
  }
  async open(doc, pdf) {
    this.generation++;
    this.observer?.disconnect();
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
    this.rendered.clear();
    this.container.replaceChildren();
    this.selection = null;
    this.callbacks.selectionState?.({});
    this.doc = doc;
    this.pdf = pdf;
    this.page = doc.page || 1;
    this.zoom = doc.zoom || 'fit';
    this.annotations = (await all('annotations')).filter((a) => a.documentId === doc.id);
    await this.layout();
  }
  async layout() {
    this.clearSelection();
    const generation = ++this.generation;
    this.observer?.disconnect();
    for (const task of this.tasks.values()) task.cancel();
    this.tasks.clear();
    this.rendered.clear();
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
  async renderPage(number, generation) {
    if (this.rendered.has(number) || generation !== this.generation) return;
    const shell = this.container.querySelector(`[data-page="${number}"]`);
    if (!shell) return;
    this.rendered.set(number, true);
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
    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.width = Math.ceil(viewport.width * ratio);
    canvas.height = Math.ceil(viewport.height * ratio);
    const text = document.createElement('div');
    text.className = 'textLayer';
    const annotations = document.createElement('div');
    annotations.className = 'annotations';
    const ink = document.createElement('canvas');
    ink.className = 'ink-layer';
    ink.width = canvas.width;
    ink.height = canvas.height;
    shell.replaceChildren(canvas, annotations, text, ink);
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
      this.tasks.delete(number);
    }
    if (generation !== this.generation || !shell.isConnected) return;
    await new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(),
      container: text,
      viewport,
    }).render();
    this.drawAnnotations(number);
    this.bindInk(ink, number);
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
  setTool(tool, color) {
    this.tool = tool;
    this.color = color;
    this.container.dataset.tool = tool;
    this.container
      .querySelectorAll('.ink-layer')
      .forEach((el) => (el.style.pointerEvents = ['pen', 'eraser', 'text'].includes(tool) ? 'auto' : 'none'));
  }
  captureSelection() {
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
    if (this.selection?.text === value && JSON.stringify(this.selection.rects) === JSON.stringify(rects))
      return;
    this.selection = { text: value, rects };
    this.callbacks.selectionState?.(selectionActionState(this.annotations, this.selection));
    this.callbacks.selection(value);
  }
  clearSelection(clearNative = true) {
    this.selection = null;
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
      this.history.set(documentId, [...(this.history.get(documentId) || []), { changes }]);
      this.future.set(documentId, []);
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
    return row;
  }
  async undo(redo = false) {
    const from = redo ? this.future : this.history;
    const to = redo ? this.history : this.future;
    const id = this.doc.id;
    const stack = from.get(id) || [];
    const action = stack.pop();
    if (!action) return;
    if (action.changes) {
      try {
        await this.commitAnnotationChanges(
          action.changes.map((change) =>
            redo ? change.after : change.before || { ...change.after, deleted: true },
          ),
        );
      } catch (error) {
        stack.push(action);
        throw error;
      }
      to.set(id, [...(to.get(id) || []), action]);
      this.callbacks.selectionState?.(selectionActionState(this.annotations, this.selection));
      this.callbacks.saved();
      return;
    }
    const row = await patch('annotations', action.id, { deleted: redo ? action.after : action.before });
    to.set(id, [...(to.get(id) || []), action]);
    this.annotations = this.annotations.map((a) => (a.id === row.id ? row : a));
    this.drawAnnotations(row.page);
    this.callbacks.saved();
  }
  async editAnnotation(annotation) {
    const result = await this.callbacks.editAnnotation(annotation);
    if (!result) return;
    const row = await patch('annotations', annotation.id, result);
    this.annotations = this.annotations.map((a) => (a.id === row.id ? row : a));
    this.drawAnnotations(row.page);
    this.callbacks.saved();
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
      if (annotation.type === 'pen') {
        ctx.strokeStyle = annotation.color;
        ctx.lineWidth = (2 * canvas.width) / shell.clientWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        annotation.points.forEach((point, i) =>
          ctx[i ? 'lineTo' : 'moveTo'](point.x * canvas.width, point.y * canvas.height),
        );
        ctx.stroke();
      } else if (['highlight', 'underline'].includes(annotation.type)) {
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
        element.textContent = annotation.text;
        element.title = '点击编辑批注';
        element.style.left = `${annotation.x * 100}%`;
        element.style.top = `${annotation.y * 100}%`;
        element.style.setProperty('--annotation-color', annotation.color);
        if (annotation.type === 'text')
          element.style.fontSize = `${(annotation.fontSize || 14) * this.scale}px`;
        element.onclick = () => this.editAnnotation(annotation).catch(this.callbacks.error);
        layer.append(element);
      }
    }
  }
  bindInk(canvas, page) {
    let points = null;
    let previous;
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
      if (tool === 'pen') {
        points = [start];
        previous = start;
        canvas.setPointerCapture(event.pointerId);
        event.preventDefault();
      } else if (tool === 'eraser') {
        const hit = this.annotations
          .filter((a) => a.page === page && !a.deleted && a.type === 'pen')
          .reverse()
          .find((a) =>
            a.points.some(
              (p) =>
                Math.hypot((p.x - start.x) * canvas.clientWidth, (p.y - start.y) * canvas.clientHeight) < 18,
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
          this.drawAnnotations(page);
          this.callbacks.saved();
        }
      } else if (tool === 'text') {
        try {
          const text = await this.callbacks.inputText(tool);
          if (text && this.doc.id === documentId)
            await this.addAnnotation({ type: tool, color: this.color, page, ...start, text, fontSize: 14 });
        } catch (error) {
          this.callbacks.error(error);
        }
      }
    };
    canvas.onpointermove = (event) => {
      if (!points) return;
      const next = point(event);
      points.push(next);
      const ctx = canvas.getContext('2d');
      ctx.strokeStyle = this.color;
      ctx.lineWidth = (2 * canvas.width) / canvas.clientWidth;
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
      this.addAnnotation({ type: 'pen', color: this.color, page, points: completed }).catch(
        this.callbacks.error,
      );
    };
    canvas.onpointerup = end;
    canvas.onpointercancel = end;
  }
  async find(query) {
    if (!query.trim()) return null;
    for (let offset = 0; offset < this.pdf.numPages; offset++) {
      const number = ((this.page - 1 + offset) % this.pdf.numPages) + 1;
      const content = await (await this.pdf.getPage(number)).getTextContent();
      if (
        content.items
          .map((item) => item.str || '')
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())
      ) {
        this.goTo(number);
        return number;
      }
    }
    return null;
  }
}
