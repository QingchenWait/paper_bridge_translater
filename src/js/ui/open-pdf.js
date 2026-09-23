import { readLibrary, sortLibraryObjects } from '../library.js';
import { parsePdfLink } from '../pdf-links.js';
import { esc, errorMessage } from '../utils.js';
import { icon, modal, toast } from './components.js';

export class OpenPdfMenu {
  constructor(app) {
    this.app = app;
    this.menu = document.createElement('div');
    this.menu.className = 'open-pdf-menu';
    this.menu.setAttribute('role', 'menu');
    this.menu.setAttribute('aria-label', '打开 PDF 方式');
    this.menu.hidden = true;
    this.menu.innerHTML = [
      ['local', 'upload', '本地文件'],
      ['library', 'folder-open', 'APP 文档库'],
      ['url', 'external-link', '外部链接'],
    ]
      .map(
        ([id, name, label]) =>
          `<button type="button" role="menuitem" data-open-pdf="${id}">${icon(name)}<span>${label}</span></button>`,
      )
      .join('');
    document.body.append(this.menu);
    document.querySelectorAll('[data-action="open-pdf"]').forEach((button) => {
      button.setAttribute('aria-haspopup', 'menu');
      button.setAttribute('aria-expanded', 'false');
    });
    this.menu.onclick = (event) => {
      const item = event.target.closest('[data-open-pdf]');
      if (!item) return;
      this.close();
      if (item.dataset.openPdf === 'local') document.getElementById('pdf-input').click();
      if (item.dataset.openPdf === 'library')
        this.openLibrary().catch((error) => toast(errorMessage(error), 'error'));
      if (item.dataset.openPdf === 'url') this.openLink();
    };
    this.menu.onkeydown = (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...this.menu.querySelectorAll('button')],
        index = items.indexOf(document.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      items[next]?.focus();
    };
    document.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.menu.hidden && !this.menu.contains(event.target) && !this.anchor?.contains(event.target))
          this.close(false);
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && !this.menu.hidden) {
          event.stopPropagation();
          this.close();
        }
      },
      true,
    );
    window.addEventListener('resize', () => this.close(false));
  }
  toggle(anchor) {
    if (!this.menu.hidden && this.anchor === anchor) {
      this.close();
      return;
    }
    this.close(false);
    this.anchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    this.menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    this.menu.style.left = `${Math.max(8, Math.min(innerWidth - this.menu.offsetWidth - 8, rect.right - this.menu.offsetWidth))}px`;
    this.menu.style.top = `${rect.bottom + 6}px`;
    this.menu.querySelector('button')?.focus();
  }
  close(focus = true) {
    this.menu.hidden = true;
    this.anchor?.setAttribute('aria-expanded', 'false');
    if (focus) this.anchor?.focus({ preventScroll: true });
  }
  async openLibrary() {
    const state = await readLibrary();
    const dialog = modal(
      '从 APP 文档库打开',
      `<div class="folder-tree open-document-tree" role="tree" aria-label="文档库文件树"></div>${state.documents.length ? '' : '<p class="note">文档库暂无 PDF</p>'}`,
    );
    const tree = dialog.element.querySelector('.folder-tree'),
      seen = new Set();
    let opening = false;
    const branch = (parent, depth, host) => {
      const folders = sortLibraryObjects(
        state.folders.filter((f) => (f.parentId || null) === parent).map((f) => ({ ...f, kind: 'folder' })),
        'name',
        'asc',
      );
      for (const folder of folders) {
        if (seen.has(folder.id)) continue;
        seen.add(folder.id);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'tree-folder';
        row.style.setProperty('--depth', depth);
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-expanded', 'true');
        row.innerHTML = `${icon('chevron-down')}${icon('folder-open')}<span>${esc(folder.name)}</span>`;
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        row.onclick = () => {
          group.hidden = !group.hidden;
          row.setAttribute('aria-expanded', String(!group.hidden));
        };
        host.append(row, group);
        branch(folder.id, depth + 1, group);
      }
      for (const doc of sortLibraryObjects(
        state.documents
          .filter((d) => (d.folderId || null) === parent)
          .map((d) => ({ ...d, kind: 'document' })),
        'name',
        'asc',
      )) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'tree-document';
        row.style.setProperty('--depth', depth);
        row.setAttribute('role', 'treeitem');
        row.innerHTML = `${icon('file-text')}<span>${esc(doc.name)}</span>`;
        row.onclick = async () => {
          if (opening) return;
          opening = true;
          row.disabled = true;
          row.setAttribute('aria-busy', 'true');
          try {
            await this.app.openDocument(doc.id);
            dialog.close();
          } catch (error) {
            toast(errorMessage(error), 'error');
            opening = false;
            row.disabled = false;
          }
        };
        host.append(row);
      }
    };
    const root = document.createElement('div');
    root.className = 'tree-folder';
    root.innerHTML = `${icon('folder-open')}根目录`;
    tree.append(root);
    branch(null, 1, tree);
    tree.onkeydown = (event) => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const rows = [...tree.querySelectorAll('button')].filter(
        (row) => row.getClientRects().length && !row.disabled,
      );
      const index = rows.indexOf(document.activeElement);
      rows[(index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]?.focus();
    };
  }
  openLink() {
    const controller = new AbortController();
    let handedOff = false;
    const dialog = modal(
      '打开外部 PDF',
      `<form id="external-pdf-form" novalidate><label class="field"><span>PDF 文件链接</span><input name="url" type="url" required placeholder="https://example.com/paper.pdf" autocomplete="url"></label><label class="field"><span>重命名名称（选填）</span><div class="pdf-filename-field"><input name="rename" placeholder="留空沿用链接文件名"><span aria-label="固定文件后缀">.pdf</span></div></label><p class="note external-pdf-status" role="status" aria-live="polite"></p><div class="modal-actions"><button type="submit" class="button primary">${icon('book-open')}打开 PDF</button></div></form>`,
      {
        onClose: () => {
          if (!handedOff) controller.abort();
        },
      },
    );
    const form = dialog.element.querySelector('form'),
      status = form.querySelector('.external-pdf-status'),
      submit = form.querySelector('[type="submit"]');
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      try {
        const { url, filename } = parsePdfLink(form.elements.url.value, form.elements.rename.value);
        submit.disabled = true;
        for (const input of form.querySelectorAll('input')) input.disabled = true;
        status.className = 'note external-pdf-status';
        status.innerHTML = '<span class="spinner small"></span>正在加载 PDF…';
        const response = await fetch(url, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
        });
        if (!response.ok) throw new Error(`PDF 下载失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        controller.signal.throwIfAborted();
        handedOff = true;
        dialog.close();
        await this.app.importFiles([new File([blob], filename, { type: 'application/pdf' })], {
          folderId: null,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          status.className = 'note external-pdf-status error';
          status.textContent = errorMessage(error);
        }
      } finally {
        submit.disabled = false;
        for (const input of form.querySelectorAll('input')) input.disabled = false;
      }
    };
  }
}
