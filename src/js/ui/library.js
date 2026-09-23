import {
  readLibrary,
  createFolder,
  expandSelection,
  moveSelection,
  planDeletion,
  deleteSelection,
  sortLibraryObjects,
  objectKey,
  downloadPlan,
  buildLibraryZip,
} from '../library.js';
import { get, put, patch } from '../storage.js';
import { esc, sizeLabel, dateLabel, chooseSaveTarget, saveFile, errorMessage } from '../utils.js';
import {
  icon,
  button,
  iconButton,
  select,
  selected,
  bindSelects,
  modal,
  inputDialog,
  toast,
} from './components.js';

export class LibraryView {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.folderId = null;
    this.selection = new Set();
    this.mode = 'cards';
    this.sort = 'createdAt';
    this.direction = 'desc';
    this.query = '';
  }
  async open({ folderId } = {}) {
    if (!this.loaded) {
      const value = (await get('settings', 'library-view'))?.value || {};
      this.folderId = typeof value.folderId === 'string' ? value.folderId : null;
      this.mode = value.mode === 'list' ? 'list' : 'cards';
      this.sort = value.sort === 'name' ? 'name' : 'createdAt';
      this.direction = value.direction === 'asc' ? 'asc' : 'desc';
      this.selection = new Set();
      this.loaded = true;
    }
    if (folderId !== undefined) {
      this.folderId = folderId;
      this.query = '';
    }
    this.state = await readLibrary();
    if (this.folderId && !this.state.folders.some((f) => f.id === this.folderId)) this.folderId = null;
    this.app.documents = this.state.documents;
    this.selection.clear();
    this.render();
    if (folderId !== undefined) await this.persist();
  }
  persist() {
    return put('settings', {
      id: 'library-view',
      value: { folderId: this.folderId, mode: this.mode, sort: this.sort, direction: this.direction },
    }).catch((error) => toast(errorMessage(error), 'error'));
  }
  breadcrumbs(id = this.folderId) {
    const path = [],
      seen = new Set();
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = this.state.folders.find((f) => f.id === id);
      if (!folder) break;
      path.unshift(folder);
      id = folder.parentId;
    }
    return path;
  }
  render() {
    const current = this.state.folders.find((f) => f.id === this.folderId);
    this.root.innerHTML = `<header class="library-header"><div><p class="eyebrow">YOUR PERSONAL LIBRARY</p><h1>${esc(current?.name || '我的文档')}</h1></div><div class="library-actions">${button('library-new-folder', 'folder-plus', '新建文件夹')}<span class="batch-actions" hidden>${button('library-move', 'folder-input', '移动')}${button('library-download', 'download', '下载')}${button('library-delete', 'trash-2', '删除', 'danger')}</span>${button('upload', 'plus', '导入 PDF', 'primary')}</div></header><nav class="library-breadcrumbs" aria-label="文件夹路径"><button data-folder="">${icon('folder-open')}全部文档</button>${this.breadcrumbs()
      .map(
        (folder) =>
          `${icon('chevron-right')}<button data-folder="${esc(folder.id)}">${esc(folder.name)}</button>`,
      )
      .join(
        '',
      )}</nav><div class="library-tools"><label class="search-field">${icon('search')}<input id="library-search" placeholder="搜索当前目录" aria-label="搜索文档" value="${esc(this.query)}"></label><div class="library-view-tools">${select(
      'library-sort',
      [
        ['name', '按名称排序'],
        ['createdAt', '按导入时间'],
      ],
      this.sort,
      '文档排序',
    )}${iconButton('library-direction', this.direction === 'asc' ? 'arrow-up' : 'arrow-down', this.direction === 'asc' ? '正序排列' : '倒序排列')}<div class="segmented">${iconButton('library-cards', 'layout-grid', '卡片视图', this.mode === 'cards' ? 'active' : '')}${iconButton('library-list', 'list', '列表视图', this.mode === 'list' ? 'active' : '')}</div></div></div><div class="library-selection-status" role="status"></div><div id="document-grid" class="document-grid ${this.mode === 'list' ? 'library-list' : ''}"></div>`;
    bindSelects(this.root);
    this.root.querySelector('[data-select="library-sort"]').addEventListener('valuechange', (event) => {
      this.sort = event.detail;
      this.persist();
      this.renderObjects();
    });
    this.root.querySelector('#library-search').oninput = (event) => {
      this.query = event.target.value;
      this.selection.clear();
      this.renderObjects();
    };
    this.root.onclick = (event) => {
      const selectedObject = event.target.closest('[data-select-object]');
      if (selectedObject) {
        event.stopPropagation();
        const key = selectedObject.dataset.selectObject;
        this.selection.has(key) ? this.selection.delete(key) : this.selection.add(key);
        this.updateSelection();
        return;
      }
      const folder = event.target.closest('[data-folder]');
      if (folder) {
        event.stopPropagation();
        this.folderId = folder.dataset.folder || null;
        this.query = '';
        this.selection.clear();
        this.persist();
        this.render();
        return;
      }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (!action?.startsWith('library-')) return;
      event.stopPropagation();
      this.action(action).catch((error) => toast(errorMessage(error), 'error'));
    };
    this.renderObjects();
  }
  renderObjects() {
    const objects = sortLibraryObjects(
      [
        ...this.state.folders
          .filter((f) => (f.parentId || null) === this.folderId)
          .map((f) => ({ ...f, kind: 'folder' })),
        ...this.state.documents
          .filter((d) => (d.folderId || null) === this.folderId)
          .map((d) => ({ ...d, kind: 'document' })),
      ].filter((item) => item.name.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())),
      this.sort,
      this.direction,
    );
    this.root.querySelector('#document-grid').innerHTML = objects.length
      ? objects
          .map((item) => {
            const folder = item.kind === 'folder',
              key = objectKey(item.kind, item.id),
              checked = this.selection.has(key);
            const open = folder
              ? `data-folder="${esc(item.id)}"`
              : `data-action="open-document" data-id="${esc(item.id)}"`;
            return `<article class="library-card ${folder ? 'folder-card' : ''} ${checked ? 'selected' : ''}" data-object-key="${esc(key)}"><button class="library-check" role="checkbox" aria-checked="${checked}" aria-label="选择${folder ? '文件夹' : '文档'} ${esc(item.name)}" data-select-object="${esc(key)}">${checked ? icon('check') : ''}</button><button class="document-cover" ${open}>${icon(folder ? 'folder-open' : 'file-text')}${folder ? '' : '<span>PDF</span>'}${!folder && item.rootId !== item.id ? '<small>译文</small>' : ''}</button><div class="library-card-body"><button class="library-document-name" ${open}>${esc(item.name)}</button><p>${folder ? '文件夹' : `${item.pages} 页 · ${sizeLabel(item.size)}`}</p><footer><span>${dateLabel(item.createdAt)}</span><div><button class="icon-button" data-action="library-rename" data-object="${esc(key)}" aria-label="重命名 ${esc(item.name)}" title="重命名">${icon('pencil')}</button>${folder ? '' : `<button class="icon-button" data-action="library-download-one" data-object="${esc(key)}" aria-label="下载 PDF" title="下载 PDF">${icon('download')}</button>`}</div></footer></div></article>`;
          })
          .join('')
      : `<div class="library-empty">${icon('folder-open')}<h2>${this.query ? '没有匹配的对象' : '这个文件夹还是空的'}</h2><p>可以新建文件夹或导入 PDF。</p></div>`;
    this.root.querySelectorAll('[data-action="library-rename"],[data-action="library-download-one"]').forEach(
      (button) =>
        (button.onclick = (event) => {
          event.stopPropagation();
          const key = button.dataset.object;
          const run = button.dataset.action === 'library-rename' ? this.rename(key) : this.download([key]);
          run.catch((error) => toast(errorMessage(error), 'error'));
        }),
    );
    this.updateSelection();
  }
  updateSelection() {
    this.root.querySelector('.batch-actions').hidden = !this.selection.size;
    this.root.querySelector('.library-selection-status').textContent = this.selection.size
      ? `已选择 ${this.selection.size} 项`
      : `${this.state.documents.filter((d) => (d.folderId || null) === this.folderId).length} 份 PDF · ${this.state.folders.filter((f) => (f.parentId || null) === this.folderId).length} 个文件夹`;
    this.root.querySelectorAll('[data-object-key]').forEach((card) => {
      const active = this.selection.has(card.dataset.objectKey);
      card.classList.toggle('selected', active);
      const button = card.querySelector('.library-check');
      button.setAttribute('aria-checked', String(active));
      button.innerHTML = active ? icon('check') : '';
    });
  }
  async action(action) {
    if (action === 'library-new-folder') {
      const name = await inputDialog('新建文件夹', { label: '文件夹名称' });
      if (name) {
        await createFolder(name, this.folderId);
        await this.open();
      }
    }
    if (action === 'library-direction') {
      this.direction = this.direction === 'asc' ? 'desc' : 'asc';
      this.persist();
      this.render();
    }
    if (action === 'library-cards' || action === 'library-list') {
      this.mode = action === 'library-cards' ? 'cards' : 'list';
      this.persist();
      this.render();
    }
    if (action === 'library-move') await this.move();
    if (action === 'library-delete') await this.remove();
    if (action === 'library-download') await this.download([...this.selection]);
  }
  async rename(key) {
    const folder = key.startsWith('folder:'),
      id = key.slice(key.indexOf(':') + 1),
      item = (folder ? this.state.folders : this.state.documents).find((row) => row.id === id);
    if (!item) return;
    const name = await inputDialog(folder ? '重命名文件夹' : '重命名文档', {
      value: item.name,
      label: '名称',
    });
    if (!name?.trim()) return;
    if (folder && (/[\\/\u0000]/.test(name) || /^[. ]+$/.test(name))) throw new Error('文件夹名称不合法');
    await patch(folder ? 'folders' : 'documents', id, { name: name.trim() });
    if (!folder && this.app.activeId === id) this.app.active.name = name.trim();
    await this.open();
    this.app.renderTabs();
  }
  async move() {
    const keys = [...this.selection];
    if (!keys.length) return;
    let state = await readLibrary(),
      target = null;
    const blocked = expandSelection(state, keys).folderIds;
    const dialog = modal(
      '移动到文件夹',
      `<p class="note">移动原文时，其关联译文也会跟随；文件夹内的层级将保留。</p><div class="folder-tree" role="tree" aria-label="目标文件树"></div><div class="folder-create-row"><input aria-label="新子文件夹名称" placeholder="新文件夹名称">${button('move-new-folder', 'folder-plus', '新建文件夹')}</div><div class="modal-actions">${button('confirm-move', 'folder-input', '移动到所选目录', 'primary')}</div>`,
    );
    const tree = dialog.element.querySelector('.folder-tree');
    const render = () => {
      tree.innerHTML = `<button class="tree-folder ${target === null ? 'active' : ''}" data-target="" role="treeitem" aria-selected="${target === null}">${icon('folder-open')}根目录</button>`;
      const add = (parent, depth) => {
        for (const folder of sortLibraryObjects(
          state.folders.filter((f) => (f.parentId || null) === parent).map((f) => ({ ...f, kind: 'folder' })),
          'name',
          'asc',
        )) {
          const row = document.createElement('button');
          row.className = `tree-folder ${target === folder.id ? 'active' : ''}`;
          row.dataset.target = folder.id;
          row.style.setProperty('--depth', depth);
          row.disabled = blocked.has(folder.id);
          row.setAttribute('role', 'treeitem');
          row.setAttribute('aria-selected', String(target === folder.id));
          row.innerHTML = `${icon('folder-open')}${esc(folder.name)}`;
          tree.append(row);
          add(folder.id, depth + 1);
        }
        for (const doc of state.documents.filter((d) => (d.folderId || null) === parent)) {
          const row = document.createElement('div');
          row.className = 'tree-document';
          row.style.setProperty('--depth', depth);
          row.innerHTML = `${icon('file-text')}<span>${esc(doc.name)}</span>`;
          tree.append(row);
        }
      };
      add(null, 1);
      tree.querySelectorAll('[data-target]').forEach(
        (button) =>
          (button.onclick = () => {
            target = button.dataset.target || null;
            render();
          }),
      );
    };
    render();
    dialog.element.querySelector('[data-action="move-new-folder"]').onclick = async () => {
      try {
        const input = dialog.element.querySelector('input');
        const folder = await createFolder(input.value, target);
        state = await readLibrary();
        target = folder.id;
        input.value = '';
        render();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    };
    dialog.element.querySelector('[data-action="confirm-move"]').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await moveSelection(keys, target);
        dialog.close();
        await this.open();
        this.app.renderTabs();
        toast('已移动');
      } catch (error) {
        toast(errorMessage(error), 'error');
        button.disabled = false;
      }
    };
  }
  async remove() {
    const plan = planDeletion(await readLibrary(), [...this.selection]);
    if (!plan.documentIds.length && !plan.folderIds.length) return;
    const dialog = modal(
      '确认删除所选对象',
      `<div class="error-card">将删除 ${plan.documents.length} 份 PDF、${plan.folders.length} 个文件夹及所选 PDF 的编辑记录。仅当同组文件全部被删除时，才会删除共享的 LLM 对话和全文译文历史。未选中的原文或译文不会联动删除。</div><ul class="delete-object-list">${[...plan.folders, ...plan.documents].map((item) => `<li>${esc(item.displayPath)}</li>`).join('')}</ul><p class="note">此操作不可撤销。确认期间新加入的内容或已移出选中目录的对象不会被额外删除。</p><div class="modal-actions">${button('cancel-delete', 'x', '取消')}${button('confirm-delete', 'trash-2', '确认', 'danger')}</div>`,
    );
    dialog.element.querySelector('[data-action="cancel-delete"]').onclick = dialog.close;
    dialog.element.querySelector('[data-action="confirm-delete"]').onclick = async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await this.app.prepareLibraryDeletion(plan);
        const result = await deleteSelection(plan);
        dialog.close();
        await this.app.afterLibraryDeletion(result);
        await this.open();
        toast(
          result.retainedFolders.length ? '所选文件已删除，含新增或未选内容的文件夹已保留' : '所选对象已删除',
        );
      } catch (error) {
        toast(errorMessage(error), 'error');
        button.disabled = false;
      }
    };
  }
  async download(keys) {
    if (this.downloading) return;
    const plan = downloadPlan(this.state, keys);
    if (!plan.files.length && !plan.folders.length) return;
    this.downloading = true;
    try {
      const name = plan.zip ? '纸间文档.zip' : plan.files[0].name;
      const target = await chooseSaveTarget(name, { directory: !plan.zip && plan.files.length === 2 });
      if (!target) return;
      if (plan.zip) {
        await saveFile(await buildLibraryZip(plan), name, { target });
        return;
      }
      const rows = [];
      const { editedDocumentBlob } = await import('../document-download.js');
      for (const file of plan.files) {
        rows.push({ file, blob: await editedDocumentBlob(file.id) });
      }
      if (rows.length === 1) {
        await saveFile(rows[0].blob, name, { target });
        return;
      }
      if (target.defaultDownload) {
        for (const { file, blob } of rows) await saveFile(blob, file.path, { target });
        return;
      }
      for (const { file, blob } of rows) {
        let filename = file.path,
          n = 2;
        while (true) {
          try {
            await target.getFileHandle(filename);
            const dot = file.path.lastIndexOf('.');
            filename =
              dot > 0
                ? `${file.path.slice(0, dot)} (${n++})${file.path.slice(dot)}`
                : `${file.path} (${n++})`;
          } catch (error) {
            if (error.name === 'NotFoundError') break;
            throw error;
          }
        }
        const handle = await target.getFileHandle(filename, { create: true });
        await saveFile(blob, filename, { target: handle });
      }
    } finally {
      this.downloading = false;
    }
  }
}
