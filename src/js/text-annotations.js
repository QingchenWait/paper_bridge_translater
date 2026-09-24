import { uid } from './utils.js';
import { icon } from './ui/components.js';
import { writeAnnotations, flushAnnotations } from './annotation-writes.js';

// Owns only note/text interaction; page rendering and other tools remain in PdfViewer.
export class TextAnnotations {
  constructor(viewer) {
    this.viewer = viewer;
    this.active = null;
    this.measure = document.createElement('canvas').getContext('2d');
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'annotation-tools';
    this.toolbar.hidden = true;
    this.toolbar.setAttribute('role', 'toolbar');
    this.toolbar.setAttribute('aria-label', '批注与文本框操作');
    this.toolbar.onpointerdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    this.toolbar.onfocusout = (event) => {
      if (this.active?.mode === 'text' && !this.element()?.contains(event.relatedTarget))
        this.finish().catch(viewer.callbacks.error);
    };
    this.toolbar.onclick = (event) => {
      const action = event.target.closest('[data-text-action]')?.dataset.textAction;
      if (action) this.action(action);
    };
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.active || this.toolbar.contains(event.target) || this.element()?.contains(event.target))
          return;
        this.finishedPointer = event;
        this.finish().catch(viewer.callbacks.error);
      },
      true,
    );
    document.addEventListener('keydown', (event) => {
      if (!this.active) return;
      if (event.key === 'Escape') this.finish().catch(viewer.callbacks.error);
      else if (
        this.active.mode === 'size' &&
        ['Delete', 'Backspace'].includes(event.key) &&
        !event.target.closest('input,textarea,[contenteditable="true"]')
      ) {
        event.preventDefault();
        this.action('delete');
      }
    });
    viewer.container.addEventListener('scroll', () => this.positionToolbar(), { passive: true });
    viewer.container.addEventListener('pointermove', (event) => this.emphasize(event), { passive: true });
    viewer.container.addEventListener('pointerleave', () => this.emphasize());
    window.addEventListener('resize', () => this.positionToolbar());
  }
  row(id = this.active?.id) {
    return this.viewer.annotations?.find((row) => row.id === id);
  }
  element(id = this.active?.id) {
    return [...this.viewer.container.querySelectorAll('.annotation-box')].find(
      (el) => el.dataset.annotationId === id,
    );
  }
  editing(id) {
    return this.active?.mode === 'text' && (!id || this.active.ids.includes(id));
  }
  begin(rows) {
    this.finish().catch(this.viewer.callbacks.error);
    const now = Date.now();
    rows = rows.map((row) => ({
      id: uid(),
      documentId: this.viewer.doc.id,
      createdAt: now,
      deleted: false,
      text: '',
      ...row,
    }));
    this.viewer.annotations.push(...rows);
    this.activate(
      rows,
      rows.map(() => null),
    );
  }
  edit(annotation) {
    if (this.editing(annotation.id)) return;
    this.finish().catch(this.viewer.callbacks.error);
    this.activate([this.row(annotation.id)], [structuredClone(this.row(annotation.id))]);
  }
  activate(rows, before) {
    this.viewer.clearSelection();
    this.active = {
      id: rows[0].id,
      page: rows[0].page,
      ids: rows.map((row) => row.id),
      mode: 'text',
      before,
      action: null,
    };
    for (const page of new Set(rows.map((row) => row.page))) this.viewer.drawAnnotations(page);
    const input = this.element()?.querySelector('textarea');
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
    this.showToolbar();
  }
  select(annotation, event) {
    if (
      event?.pointerType === 'touch' &&
      this.lastTap?.pointerType === 'touch' &&
      this.lastTap?.id === annotation.id &&
      Date.now() - this.lastTap.time < 350
    ) {
      this.lastTap = null;
      this.edit(annotation);
      return;
    }
    this.lastTap = { id: annotation.id, time: Date.now(), pointerType: event?.pointerType };
    if (this.active?.id === annotation.id && this.active.mode === 'size') return;
    this.finish().catch(this.viewer.callbacks.error);
    this.viewer.clearSelection();
    this.active = { id: annotation.id, page: annotation.page, ids: [annotation.id], mode: 'size' };
    this.viewer.drawAnnotations(annotation.page);
    this.showToolbar();
  }
  showToolbar() {
    const annotation = this.row();
    if (!annotation || !this.active) return;
    const sizing = this.active.mode === 'size';
    const actions = [
      ['larger', 'a-arrow-up', '字体变大'],
      ['smaller', 'a-arrow-down', '字体减小'],
      ...(sizing && annotation.type === 'text' ? [['border', 'rectangle-horizontal', '添加/去除边框']] : []),
      ...(sizing ? [['reset', 'rotate-ccw', '尺寸变更重置']] : []),
      ['delete', 'trash-2', '删除该对象'],
    ];
    this.toolbar.innerHTML = actions
      .map(
        ([key, name, label]) =>
          `<button type="button" class="icon-button ${key === 'delete' ? 'danger' : ''}" data-text-action="${key}" title="${label}" aria-label="${label}">${icon(name)}</button>`,
      )
      .join('');
    this.toolbar.hidden = false;
    this.positionToolbar();
  }
  finish() {
    this.endResize?.();
    const active = this.active;
    if (!active) return flushAnnotations();
    this.active = null;
    this.toolbar.hidden = true;
    this.toolbar.remove();
    for (const id of active.ids) {
      const row = this.row(id);
      if (row && !row.text.trim()) row.deleted = true;
    }
    // Starting and abandoning an empty object is not a document operation.
    if (active.before?.every((row) => !row) && active.ids.every((id) => this.row(id)?.deleted)) {
      const history = this.viewer.history.get(this.viewer.doc.id) || [];
      this.viewer.history.set(
        this.viewer.doc.id,
        history.filter((action) => action !== active.action),
      );
      this.viewer.notifyHistory();
    }
    for (const page of new Set(active.ids.map((id) => this.row(id)?.page).filter(Boolean)))
      this.viewer.drawAnnotations(page);
    if (active.mode === 'text' && active.action)
      this.persist(
        active.ids.map((id) => this.row(id)),
        active.before,
        active.action,
      );
    return flushAnnotations();
  }
  persist(rows, before, action) {
    if (!action && before.every((row) => !row) && rows.every((row) => row.deleted)) return null;
    if (!action) {
      action = { changes: rows.map((row, i) => ({ before: before[i], after: structuredClone(row) })) };
      const id = rows[0].documentId;
      this.viewer.history.set(id, [...(this.viewer.history.get(id) || []), action]);
      this.viewer.future.set(id, []);
    } else
      action.changes.forEach((change, i) => {
        change.after = structuredClone(rows[i]);
      });
    this.viewer.notifyHistory();
    writeAnnotations(rows)
      .then(() => this.viewer.callbacks.saved())
      .catch(this.viewer.callbacks.error);
    return action;
  }
  input(value) {
    const active = this.active;
    if (!active || active.mode !== 'text') return;
    const rows = active.ids.map((id) => this.row(id));
    for (const row of rows) {
      row.text = value;
      row.deleted = !value.trim();
    }
    for (const page of new Set(rows.map((row) => row.page))) this.viewer.drawAnnotations(page);
    active.action = this.persist(rows, active.before, active.action);
  }
  rememberFontSize(type, size) {
    const value = Math.max(6, Math.min(48, size));
    this.viewer.callbacks.annotationFontSize?.(type, value);
    return value;
  }
  action(type) {
    const row = this.row();
    if (!row || !this.active) return;
    this.viewer.clearSelectionForEditing();
    this.endResize?.();
    if (this.active.mode === 'text') {
      if (type === 'delete') {
        this.finish().catch(this.viewer.callbacks.error);
        if (row.deleted) return;
      } else if (type === 'larger' || type === 'smaller') {
        const active = this.active,
          rows = active.ids.map((id) => this.row(id));
        for (const item of rows) {
          item.deleted = !item.text.trim();
          item.fontSize = this.rememberFontSize(
            item.type,
            (item.fontSize || (item.type === 'note' ? 12 : 14)) + (type === 'larger' ? 1 : -1),
          );
        }
        for (const page of new Set(rows.map((item) => item.page))) this.viewer.drawAnnotations(page);
        active.action = this.persist(rows, active.before, active.action);
        return;
      } else return;
    }
    const before = structuredClone(row);
    const fontSize = row.fontSize || (row.type === 'note' ? 12 : 14);
    if (type === 'larger') row.fontSize = this.rememberFontSize(row.type, fontSize + 1);
    if (type === 'smaller') row.fontSize = this.rememberFontSize(row.type, fontSize - 1);
    if (type === 'border' && row.type === 'text') row.border = !row.border;
    if (type === 'reset') delete row.width;
    if (type === 'delete') {
      row.deleted = true;
      this.active = null;
      this.toolbar.hidden = true;
      this.toolbar.remove();
    }
    this.viewer.drawAnnotations(row.page);
    if (JSON.stringify(before) !== JSON.stringify(row)) this.persist([row], [before]);
  }
  render(row, layer) {
    let element = [...layer.children].find(
      (el) => el.classList.contains('annotation-box') && el.dataset.annotationId === row.id,
    );
    if (!element) {
      element = document.createElement('div');
      element.className = `annotation-box annotation-${row.type}`;
      element.dataset.annotationId = row.id;
      element.tabIndex = 0;
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', row.type === 'note' ? '批注' : '文本框');
      element.innerHTML = `<div class="annotation-content"></div><button type="button" class="annotation-move" aria-label="移动对象">${icon('move')}</button><button type="button" class="annotation-resize left" data-resize="left" aria-label="调整左侧宽度"></button><button type="button" class="annotation-resize right" data-resize="right" aria-label="调整右侧宽度"></button>`;
      element.ondblclick = (event) => {
        if (event.target.closest('textarea,[data-resize],.annotation-move,.annotation-tools')) return;
        event.preventDefault();
        this.edit(this.row(row.id));
      };
      element.onkeydown = (event) => {
        if (event.target.closest('.annotation-tools,[data-resize],.annotation-move')) return;
        if (event.target.tagName !== 'TEXTAREA' && (event.key === 'Enter' || event.key === 'F2')) {
          event.preventDefault();
          this.edit(this.row(row.id));
        }
      };
      for (const handle of element.querySelectorAll('[data-resize]'))
        handle.onpointerdown = (event) => this.resize(event, this.row(row.id), handle.dataset.resize);
      layer.append(element);
    }
    const selected = this.active?.id === row.id,
      editing = selected && this.editing(row.id);
    element.classList.toggle('is-selected', selected);
    element.classList.toggle('is-editing', editing);
    element.classList.toggle('has-border', row.type === 'text' && row.border === true);
    element.style.left = `${row.x * 100}%`;
    element.style.top = `${row.y * 100}%`;
    element.style.setProperty('--annotation-color', row.color);
    element.style.setProperty('--annotation-stroke', `${this.viewer.scale}px`);
    element.style.padding =
      row.type === 'note'
        ? `${8 * this.viewer.scale}px ${11 * this.viewer.scale}px`
        : `${2 * this.viewer.scale}px`;
    element.style.fontSize = `${(row.fontSize || (row.type === 'note' ? 12 : 14)) * this.viewer.scale}px`;
    const content = element.querySelector('.annotation-content');
    let input = content.querySelector('textarea');
    if (editing) {
      if (!input) {
        input = document.createElement('textarea');
        input.className = 'annotation-input';
        input.rows = 1;
        input.spellcheck = false;
        input.setAttribute('aria-label', row.type === 'note' ? '批注内容' : '文本框内容');
        input.value = row.text;
        input.oninput = () => this.input(input.value);
        input.onblur = (event) => {
          if (this.editing(row.id) && !this.toolbar.contains(event.relatedTarget))
            this.finish().catch(this.viewer.callbacks.error);
        };
        content.replaceChildren(input);
      }
    } else if (input || content.textContent !== row.text) content.textContent = row.text;
    this.fit(row, element, input);
    if (selected) this.positionToolbar();
    return element;
  }
  fit(row, element, input) {
    const shell = element.closest('.pdf-page'),
      style = getComputedStyle(element);
    const pageWidth = shell.getBoundingClientRect().width;
    const inset =
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      parseFloat(style.borderLeftWidth) +
      parseFloat(style.borderRightWidth);
    this.measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const natural = row.text
      .split('\n')
      .reduce(
        (width, line) => Math.max(width, this.measure.measureText(line).width + inset + 3),
        48 * this.viewer.scale,
      );
    const available = Math.max(1, pageWidth * (1 - row.x));
    element.style.width = `${Math.min(available, row.width ? row.width * pageWidth : Math.min(pageWidth * 0.45, natural))}px`;
    if (input) {
      input.style.height = '0px';
      input.style.height = `${input.scrollHeight + 1}px`;
    }
    const bounds = element.getBoundingClientRect();
    row.boxWidth = bounds.width / pageWidth;
    row.boxHeight = bounds.height / shell.getBoundingClientRect().height;
  }
  resize(event, row, side) {
    if (event.button !== 0) return;
    this.viewer.clearSelectionForEditing();
    event.preventDefault();
    event.stopPropagation();
    this.lastTap = null;
    const handle = event.currentTarget,
      element = this.element(row.id),
      shell = element.closest('.pdf-page');
    const width = shell.getBoundingClientRect().width,
      before = structuredClone(row),
      start = event.clientX;
    const initialWidth = element.getBoundingClientRect().width / width,
      minimum = Math.min(1, (24 * this.viewer.scale) / width);
    let action;
    handle.setPointerCapture(event.pointerId);
    const move = (e) => {
      if (e.pointerId !== event.pointerId || Math.abs(e.clientX - start) < 1) return;
      const dx = (e.clientX - start) / width;
      if (side === 'left') {
        row.x = Math.max(0, Math.min(before.x + initialWidth - minimum, before.x + dx));
        row.width = Math.min(1 - row.x, before.x + initialWidth - row.x);
      } else row.width = Math.min(1 - row.x, Math.max(minimum, initialWidth + dx));
      this.viewer.drawAnnotations(row.page);
      action = this.persist([row], [before], action);
    };
    const end = (e) => {
      if (e.pointerId !== event.pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', cancel);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      this.endResize = null;
    };
    const cancel = (e) => {
      if (e.pointerId !== event.pointerId) return;
      end(e);
      if (!action) return;
      this.viewer.annotations = this.viewer.annotations.map((a) => (a.id === before.id ? before : a));
      this.viewer.history.set(
        row.documentId,
        this.viewer.history.get(row.documentId).filter((a) => a !== action),
      );
      writeAnnotations([before]).catch(this.viewer.callbacks.error);
      this.viewer.drawAnnotations(row.page);
      this.viewer.notifyHistory();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', cancel);
    this.endResize = () => end({ pointerId: event.pointerId });
  }
  positionToolbar() {
    if (!this.active) return;
    const element = this.element();
    if (!element?.isConnected) {
      this.toolbar.hidden = true;
      return;
    }
    if (this.toolbar.parentElement !== element) element.append(this.toolbar);
    const box = element.getBoundingClientRect(),
      viewport = this.viewer.container.getBoundingClientRect();
    this.toolbar.hidden = box.bottom < viewport.top || box.top > viewport.bottom;
    if (this.toolbar.hidden) return;
    this.toolbar
      .querySelector('[data-text-action="border"]')
      ?.setAttribute('aria-pressed', String(Boolean(this.row()?.border)));
    const width = this.toolbar.offsetWidth,
      height = this.toolbar.offsetHeight;
    // Local offsets move with the same DOM object/compositor update; no separate
    // fixed-position follower or animated catch-up while dragging.
    const border = parseFloat(getComputedStyle(element).borderLeftWidth) || 0;
    this.toolbar.style.left = `${Math.max(viewport.left + 4 - box.left, Math.min(viewport.right - width - 4 - box.left, (box.width - width) / 2)) - border}px`;
    this.toolbar.style.top = `${Math.max(viewport.top + 4 - box.top, Math.min(viewport.bottom - height - 4 - box.top, box.height + 7)) - border}px`;
  }
  emphasize(event) {
    const shell = event?.target.closest('.pdf-page'),
      box = shell?.getBoundingClientRect();
    const x = box ? (event.clientX - box.left) / box.width : -1,
      y = box ? (event.clientY - box.top) / box.height : -1;
    for (const element of this.viewer.container.querySelectorAll('.annotation-note')) {
      const row = this.row(element.dataset.annotationId);
      element.classList.toggle(
        'is-emphasized',
        Boolean(
          row?.page === Number(shell?.dataset.page) &&
          row.rects?.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
        ),
      );
    }
  }
}
