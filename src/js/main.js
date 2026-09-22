import '../styles/base.css';
import '../styles/desktop.css';
import '../styles/mobile.css';
import { all, get, put, patch, addDocument, requestPersistence } from './storage.js';
import { getSettings } from './settings.js';
import { scheduleSync, syncWebDav } from './archive.js';
import { loadPdf, extractPdfText, PdfViewer } from './pdf.js';
import { esc, sizeLabel, dateLabel, saveFile, errorMessage } from './utils.js';
import {
  icon,
  iconButton,
  button,
  select,
  bindSelects,
  toast,
  illustration,
  inputDialog,
  modal,
} from './ui/components.js';
import { initDesktopLayout } from './ui/desktop.js';
import { initMobileLayout, setMobilePane } from './ui/mobile.js';
import { openSettings, onboarding } from './ui/settings-panel.js';
import { Assistant } from './ui/assistant.js';
const TOOLS = [
  ['underline', 'underline', '文字下划线'],
  ['highlight', 'highlighter', '文字高亮'],
  ['note', 'message-square', '批注'],
  ['text', 'type', '添加文本框'],
  ['pen', 'pencil', '手绘笔迹'],
  ['eraser', 'eraser', '手绘橡皮擦'],
];
class App {
  constructor() {
    this.documents = [];
    this.openIds = [];
    this.activeId = null;
    this.active = null;
    this.pdf = null;
    this.tool = 'select';
    this.colors = {
      underline: '#6370ee',
      highlight: '#ffe082',
      note: '#e8ae3e',
      text: '#334155',
      pen: '#ef6380',
    };
    this.openGeneration = 0;
    this.textCache = new Map();
  }
  async init() {
    this.mount();
    this.viewer = new PdfViewer(document.getElementById('pdf-scroll'), {
      error: (error) => toast(errorMessage(error), 'error'),
      selection: (text) => this.assistant.translateSelection(text).catch((e) => toast(e.message, 'error')),
      page: (page) => this.setPage(page),
      saved: () => this.updateSaved(),
      inputText: (type) =>
        inputDialog(type === 'note' ? '添加批注' : '添加文本框', { multiline: true, label: '输入内容' }),
      editAnnotation: async (annotation) => {
        const value = await inputDialog('编辑批注', {
          value: annotation.text,
          multiline: true,
          remove: true,
        });
        return value === null ? null : typeof value === 'object' ? value : { text: value };
      },
    });
    this.assistant = new Assistant(this);
    initDesktopLayout();
    initMobileLayout();
    this.bind();
    this.documents = await all('documents');
    const workspace = (await get('settings', 'workspace'))?.value;
    this.assistant.currentThreads = new Map(workspace?.currentThreads || []);
    this.openIds = (workspace?.openIds || []).filter((id) => this.documents.some((d) => d.id === id));
    const recoverable = (await all('messages')).filter((m) => m.status === 'streaming');
    // A prior tab may still be streaming: never rewrite its rows during startup.
    if (recoverable.length)
      document.getElementById('save-status').title = '先前未完成的回复已保存在各自对话中';
    this.renderTabs();
    this.renderToolbar();
    await this.assistant.render();
    if (this.openIds.length)
      await this.openDocument(
        this.openIds.includes(workspace?.activeId) ? workspace.activeId : this.openIds[0],
      );
    const persistence = await requestPersistence();
    document.getElementById('save-status').title = persistence
      ? '浏览器已允许持久存储'
      : '本地自动保存；建议定期备份，以应对浏览器数据清理';
    scheduleSync(
      (message) => this.setSyncStatus(message),
      (e) => this.setSyncStatus(errorMessage(e)),
    );
    document.addEventListener('settings-changed', () =>
      scheduleSync(
        (message) => this.setSyncStatus(message),
        (e) => this.setSyncStatus(errorMessage(e)),
      ),
    );
    await onboarding(this);
  }
  mount() {
    document.getElementById('app').innerHTML =
      `<aside class="sidebar"><a class="brand" href="#" aria-label="纸间主页"><span class="brand-symbol">${icon('book-open')}</span><span class="brand-name">纸间<span>PAPER BRIDGE</span></span></a><nav class="main-nav">${button('reader', 'book-open', 'PDF 翻译', 'nav-item active')}${button('library', 'folder-open', '文档管理', 'nav-item')}${button('records', 'history', '翻译记录', 'nav-item')}</nav><div class="sidebar-bottom">${button('cloud', 'cloud', '云同步', 'nav-item')}${button('settings', 'settings-2', '设置', 'nav-item')}${button('help', 'circle-help', '使用帮助', 'nav-item')}<span class="version">v0.1.0</span></div></aside><main class="main-shell"><header class="mobile-header"><span>${icon('book-open')}纸间</span>${iconButton('upload', 'plus', '打开 PDF')}</header><div class="workspace" id="workspace"><section class="reader-panel" aria-label="PDF 阅读区"><div class="document-bar"><div id="document-tabs" class="document-tabs"></div>${button('upload', 'plus', '打开 PDF', 'open-pdf')}</div><div class="toolbar" id="pdf-toolbar"></div><div class="reader-body"><div class="pdf-scroll" id="pdf-scroll"></div><div class="reader-empty" id="reader-empty"><div class="empty-book"><img src="${illustration('open-book')}" alt="打开的书"></div><div class="empty-caption">YOUR NEXT GREAT IDEA STARTS HERE</div><h1>翻开一页，<br>遇见更大的世界。</h1><p>将 PDF 拖到这里，开始一场没有语言边界的阅读。</p>${button('upload', 'upload', '打开本地 PDF', 'primary large')}<span class="upload-hint">支持多份文档 · 自动保存阅读进度</span><div class="empty-features"><span>${icon('highlighter')}随手批注</span><span>${icon('languages')}划词即译</span><span>${icon('sparkles')}AI 问答</span></div></div></div><footer class="reader-status"><span id="document-status">一张书桌，无限可能</span><span id="save-status">${icon('shield-check')}本地自动保存</span></footer></section><div class="split-handle" id="split-handle" role="separator" aria-label="调整左右栏宽度" aria-orientation="vertical" tabindex="0"></div><section class="assistant-panel" aria-label="翻译与 AI 助手"><header class="assistant-header"><div class="segmented" role="tablist"><button data-assistant-tab="selection" class="active" role="tab" aria-selected="true">划词翻译</button><button data-assistant-tab="full" role="tab" aria-selected="false">全文翻译</button><button data-assistant-tab="chat" role="tab" aria-selected="false">AI 问答</button></div><button id="translation-settings" class="translation-settings" title="翻译设置" aria-label="翻译设置">${icon('settings-2')}<span>翻译设置</span>${icon('chevron-down')}</button></header><div id="assistant-content" class="assistant-content"></div></section></div><section id="library-view" class="library-view" hidden></section><nav class="mobile-nav"><button class="active" data-mobile-pane="reader">${icon('book-open')}阅读</button><button data-mobile-pane="assistant">${icon('languages')}翻译 / AI</button>${button('library', 'folder-open', '文档')}${button('settings', 'settings-2', '设置')}</nav></main><div id="color-popover" class="color-popover" hidden></div>`;
  }
  bind() {
    document.getElementById('app').addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target || target.disabled) return;
      const action = target.dataset.action;
      Promise.resolve(this.action(action, target)).catch((error) => toast(errorMessage(error), 'error'));
    });
    document.querySelector('.brand').onclick = (event) => {
      event.preventDefault();
      this.showReader();
    };
    document.getElementById('pdf-input').onchange = async (event) => {
      await this.importFiles(event.target.files);
      event.target.value = '';
    };
    const reader = document.querySelector('.reader-body');
    reader.addEventListener('dragover', (event) => {
      if (event.dataTransfer.types.includes('Files')) {
        event.preventDefault();
        reader.classList.add('drag-over');
      }
    });
    reader.addEventListener('dragleave', (event) => {
      if (!reader.contains(event.relatedTarget)) reader.classList.remove('drag-over');
    });
    reader.addEventListener('drop', (event) => {
      event.preventDefault();
      reader.classList.remove('drag-over');
      this.importFiles(event.dataTransfer.files);
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        document.getElementById('pdf-input').click();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'z' &&
        !/INPUT|TEXTAREA/.test(event.target.tagName) &&
        this.active
      ) {
        event.preventDefault();
        this.viewer.undo(event.shiftKey).catch((e) => toast(e.message, 'error'));
      }
      if (event.key === 'Escape') {
        document.getElementById('color-popover').hidden = true;
        this.tool = 'select';
        this.viewer.setTool('select', this.colors.highlight);
        this.renderToolbar();
      }
    });
    let resizeTimer;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (this.pdf && this.viewer.zoom === 'fit' && document.getElementById('pdf-scroll').clientWidth > 0)
          this.viewer.layout().catch((e) => toast(e.message, 'error'));
      }, 150);
    };
    window.addEventListener('resize', resize);
    document.addEventListener('reader-resize', resize);
    document.addEventListener('click', (event) => {
      if (!event.target.closest('[data-action^="color-"]') && !event.target.closest('#color-popover'))
        document.getElementById('color-popover').hidden = true;
    });
  }
  async action(action, target) {
    if (action === 'upload') document.getElementById('pdf-input').click();
    else if (action === 'reader') this.showReader();
    else if (action === 'library') await this.showLibrary();
    else if (action === 'records') await this.showRecords();
    else if (action === 'settings' || action === 'help' || action === 'cloud')
      await openSettings(this, action === 'help' ? 'about' : action === 'cloud' ? 'cloud' : 'api');
    else if (action === 'open-document') await this.openDocument(target.dataset.id);
    else if (action === 'close-document') await this.closeDocument(target.dataset.id);
    else if (action === 'zoom-in' || action === 'zoom-out') {
      if (this.pdf)
        await this.changeZoom(
          Math.max(0.25, Math.min(4, this.viewer.scale + (action === 'zoom-in' ? 0.15 : -0.15))),
        );
    } else if (action === 'prev-page' || action === 'next-page') {
      if (this.pdf) this.viewer.goTo(this.viewer.page + (action === 'next-page' ? 1 : -1));
    } else if (action === 'undo' || action === 'redo') {
      if (this.pdf) await this.viewer.undo(action === 'redo');
    } else if (action === 'download-pdf') await this.downloadCurrent();
    else if (action === 'search-pdf') {
      const query = await inputDialog('在 PDF 中查找', { label: '搜索文字' });
      if (query && !(await this.viewer.find(query))) toast('当前文档未找到这段文字');
    } else if (action.startsWith('tool-')) await this.setTool(action.slice(5));
    else if (action.startsWith('color-')) this.colorPicker(action.slice(6), target);
  }
  async importFiles(files) {
    for (const file of [...files]) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        toast(`${file.name} 不是 PDF 文件`, 'error');
        continue;
      }
      let pdf;
      try {
        toast(`正在导入 ${file.name}`);
        pdf = await loadPdf(file, () => inputDialog('打开加密 PDF', { password: true, label: 'PDF 密码' }));
        const doc = await addDocument(file, file.name, pdf.numPages);
        this.documents.push(doc);
        await this.openDocument(doc.id, pdf);
        pdf = null;
      } catch (error) {
        toast(`导入失败：${errorMessage(error)}`, 'error');
      } finally {
        if (pdf) await pdf.destroy();
      }
    }
  }
  async importGenerated(blob, source, translationId) {
    const pdf = await loadPdf(blob);
    try {
      const doc = await addDocument(
        blob,
        `${source.name.replace(/\.pdf$/i, '')} · 译文.pdf`,
        pdf.numPages,
        source.rootId,
      );
      await patch('documents', doc.id, { translationId });
      this.documents.push(doc);
      return doc;
    } finally {
      await pdf.destroy();
    }
  }
  async openDocument(id, loaded) {
    const generation = ++this.openGeneration;
    const doc = await get('documents', id);
    if (!doc) return;
    if (id === this.activeId && !loaded) {
      this.showReader();
      setMobilePane('reader');
      return;
    }
    const pdf =
      loaded ||
      (await loadPdf((await get('files', id)).blob, () =>
        inputDialog('打开加密 PDF', { password: true, label: 'PDF 密码' }),
      ));
    if (generation !== this.openGeneration) {
      await pdf.destroy();
      return;
    }
    const previous = this.pdf;
    this.pdf = pdf;
    this.active = doc;
    this.activeId = id;
    if (!this.openIds.includes(id)) this.openIds.push(id);
    this.showReader();
    setMobilePane('reader');
    document.getElementById('reader-empty').hidden = true;
    document.getElementById('pdf-scroll').hidden = false;
    await this.viewer.open(doc, pdf);
    if (previous && previous !== pdf) await previous.destroy();
    this.renderTabs();
    this.renderToolbar();
    await this.assistant.render();
    await this.saveWorkspace();
    document.getElementById('document-status').textContent = `${doc.pages} 页 · ${sizeLabel(doc.size)}`;
  }
  async closeDocument(id) {
    this.openIds = this.openIds.filter((value) => value !== id);
    if (this.activeId === id) {
      if (this.openIds.length) await this.openDocument(this.openIds.at(-1));
      else {
        this.activeId = null;
        this.active = null;
        this.viewer.generation++;
        this.viewer.observer?.disconnect();
        if (this.pdf) await this.pdf.destroy();
        this.pdf = null;
        document.getElementById('pdf-scroll').replaceChildren();
        document.getElementById('reader-empty').hidden = false;
        document.getElementById('document-status').textContent = '一张书桌，无限可能';
        await this.assistant.render();
      }
    }
    this.renderTabs();
    this.renderToolbar();
    await this.saveWorkspace();
  }
  async saveWorkspace() {
    await put('settings', {
      id: 'workspace',
      value: {
        openIds: this.openIds,
        activeId: this.activeId,
        currentThreads: [...this.assistant.currentThreads],
      },
    });
  }
  renderTabs() {
    const root = document.getElementById('document-tabs');
    root.innerHTML = this.openIds
      .map((id) => {
        const doc = this.documents.find((d) => d.id === id) || this.active;
        if (!doc) return '';
        return `<div class="document-tab ${id === this.activeId ? 'active' : ''}"><button class="tab-main" data-action="open-document" data-id="${id}" title="${esc(doc.name)}"><span class="pdf-miniature">${icon('file-text')}<small>PDF</small></span><span class="tab-caption"><strong>${esc(doc.name)}</strong><small>${id === this.activeId ? this.viewer?.page || 1 : doc.page || 1} / ${doc.pages} 页</small></span></button><button class="tab-close" data-action="close-document" data-id="${id}" title="关闭标签，保留文档" aria-label="关闭 ${esc(doc.name)}">${icon('x')}</button></div>`;
      })
      .join('');
    if (!this.openIds.length)
      root.innerHTML = `<div class="workspace-label">${icon('book-open')}我的阅读空间</div>`;
  }
  renderToolbar() {
    const root = document.getElementById('pdf-toolbar');
    const zoom = this.viewer?.zoom || 'fit';
    const zoomOptions = [
      ['fit', '适应宽度'],
      [0.5, '50%'],
      [0.75, '75%'],
      [1, '100%'],
      [1.25, '125%'],
      [1.5, '150%'],
      [2, '200%'],
    ];
    if (zoom !== 'fit' && !zoomOptions.some((o) => o[0] === zoom))
      zoomOptions.push([zoom, `${Math.round(zoom * 100)}%`]);
    root.innerHTML = `<div class="toolbar-group zoom-group">${select('zoom', zoomOptions, zoom, '缩放比例')}${iconButton('zoom-in', 'plus', '放大')}${iconButton('zoom-out', 'minus', '缩小')}</div><span class="toolbar-divider"></span><div class="toolbar-group page-group"><input id="page-input" value="${this.viewer?.page || 1}" inputmode="numeric" aria-label="当前页码"><span class="total-pages">/ ${this.pdf?.numPages || 0}</span>${iconButton('prev-page', 'chevron-left', '上一页')}${iconButton('next-page', 'chevron-right', '下一页')}</div><span class="toolbar-divider"></span><div class="toolbar-group annotation-group">${TOOLS.slice(
      0,
      4,
    )
      .map(([tool, name, label]) => this.toolButton(tool, name, label))
      .join('')}</div><span class="toolbar-divider"></span><div class="toolbar-group">${TOOLS.slice(4)
      .map(([tool, name, label]) => this.toolButton(tool, name, label))
      .join(
        '',
      )}</div><div class="toolbar-spacer"></div><div class="toolbar-group extra-tools">${iconButton('undo', 'undo-2', '撤销批注 (Ctrl+Z)')}${iconButton('redo', 'redo-2', '重做批注 (Ctrl+Shift+Z)')}${iconButton('search-pdf', 'search', '查找文字')}${iconButton('download-pdf', 'download', '下载包含批注的 PDF')}</div>`;
    if (!this.active) root.querySelectorAll('button,input').forEach((el) => (el.disabled = true));
    bindSelects(root);
    root
      .querySelector('[data-select="zoom"]')
      .addEventListener('valuechange', (event) =>
        this.changeZoom(event.detail === 'fit' ? 'fit' : Number(event.detail)).catch((e) =>
          toast(e.message, 'error'),
        ),
      );
    const page = root.querySelector('#page-input');
    page.onchange = () => {
      if (this.pdf) this.viewer.goTo(page.value);
    };
    page.onkeydown = (event) => {
      if (event.key === 'Enter') page.blur();
    };
  }
  toolButton(tool, name, label) {
    const color = this.colors[tool];
    return `<div class="tool-pair ${this.tool === tool ? 'active' : ''}"><button class="tool-main" data-action="tool-${tool}" title="${label}" aria-label="${label}" aria-pressed="${this.tool === tool}">${icon(name)}${color && tool !== 'underline' ? `<span class="tool-color" style="background:${color}"></span>` : ''}</button>${color && tool !== 'underline' ? `<button class="tool-color-toggle" data-action="color-${tool}" title="${label}颜色" aria-label="${label}颜色">${icon('chevron-down')}</button>` : ''}</div>`;
  }
  async setTool(tool) {
    if (!this.active) return;
    this.tool = this.tool === tool ? 'select' : tool;
    this.viewer.setTool(this.tool, this.colors[tool] || '#334155');
    this.renderToolbar();
    if (['highlight', 'underline'].includes(this.tool))
      await this.viewer.annotateSelection(this.tool, this.colors[this.tool]);
    if (this.tool === 'note' && this.viewer.selection?.rects.length) {
      const rect = this.viewer.selection.rects[0];
      const text = await inputDialog('添加批注', { multiline: true, label: '批注内容' });
      if (text)
        await this.viewer.addAnnotation({
          type: 'note',
          color: this.colors.note,
          page: rect.page,
          x: rect.x,
          y: Math.min(0.9, rect.y + rect.h),
          text,
        });
      this.viewer.selection = null;
    }
  }
  colorPicker(tool, target) {
    const colors =
      tool === 'highlight'
        ? ['#ffe082', '#b4e3c5', '#b7d7ff', '#dcc8ff', '#ffc4cf', '#ffd5af']
        : ['#6370ee', '#334155', '#e8ae3e', '#21a179', '#ef6380', '#9361c9'];
    const root = document.getElementById('color-popover');
    root.innerHTML = `<span>${TOOLS.find((t) => t[0] === tool)[2]}颜色</span><div>${colors.map((c) => `<button style="--swatch:${c}" data-color="${c}" aria-label="颜色 ${c}" class="${this.colors[tool] === c ? 'selected' : ''}">${this.colors[tool] === c ? icon('check') : ''}</button>`).join('')}</div>`;
    root.hidden = false;
    const rect = target.getBoundingClientRect();
    root.style.left = `${Math.min(innerWidth - 240, Math.max(10, rect.left - 50))}px`;
    root.style.top = `${rect.bottom + 10}px`;
    root.onclick = (e) => {
      const swatch = e.target.closest('[data-color]');
      if (swatch) {
        this.colors[tool] = swatch.dataset.color;
        if (this.tool === tool) this.viewer.setTool(tool, swatch.dataset.color);
        this.renderToolbar();
        root.hidden = true;
      }
    };
  }
  async changeZoom(zoom) {
    if (!this.active) return;
    await this.viewer.setZoom(zoom);
    await patch('documents', this.activeId, { zoom });
    this.renderToolbar();
  }
  setPage(page) {
    const input = document.getElementById('page-input');
    if (input) input.value = page;
    if (this.active) {
      this.active.page = page;
      const id = this.activeId;
      clearTimeout(this.pageTimer);
      this.pageTimer = setTimeout(
        () =>
          patch('documents', id, { page })
            .then(() => this.renderTabs())
            .catch((e) => toast(e.message, 'error')),
        250,
      );
    }
  }
  showReader() {
    document.getElementById('workspace').hidden = false;
    document.getElementById('library-view').hidden = true;
    document.documentElement.dataset.view = 'reader';
    document
      .querySelectorAll('.main-nav .nav-item')
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.action === 'reader'));
  }
  async showLibrary() {
    this.documents = await all('documents');
    this.showSecondary('library');
    const root = document.getElementById('library-view');
    root.innerHTML = `<header class="library-header"><div><p class="eyebrow">YOUR PERSONAL LIBRARY</p><h1>我的文档 <span class="count-badge">${this.documents.length}</span></h1><p>每一份文档，每一次思考，都在这里。</p></div>${button('upload', 'plus', '导入 PDF', 'primary')}</header><div class="library-tools"><label class="search-field">${icon('search')}<input id="library-search" placeholder="搜索文档名称" aria-label="搜索文档"></label><span>${sizeLabel(this.documents.reduce((n, d) => n + d.size, 0))} · 本地存储</span></div><div id="document-grid" class="document-grid"></div>`;
    const render = (query) => {
      const docs = this.documents
        .filter((d) => d.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => b.createdAt - a.createdAt);
      root.querySelector('#document-grid').innerHTML = docs.length
        ? docs
            .map(
              (d) =>
                `<article class="library-card"><button class="document-cover" data-action="open-document" data-id="${d.id}">${icon('file-text')}<span>PDF</span>${d.rootId !== d.id ? '<small>译文</small>' : ''}</button><div class="library-card-body"><button class="library-document-name" data-action="open-document" data-id="${d.id}">${esc(d.name)}</button><p>${d.pages} 页 <span>·</span> ${sizeLabel(d.size)}</p><footer><span>${dateLabel(d.createdAt)}</span><div><button class="icon-button" data-rename="${d.id}" aria-label="重命名文档" title="重命名">${icon('pencil')}</button><button class="icon-button" data-download="${d.id}" aria-label="下载原始 PDF" title="下载原始 PDF">${icon('download')}</button></div></footer></div></article>`,
            )
            .join('')
        : `<div class="library-empty">${icon('folder-open')}<h2>${query ? '没有匹配的文档' : '你的第一份文档，从这里开始'}</h2><p>导入 PDF 后，文档及其批注会自动保存在这里。</p>${button('upload', 'upload', '导入 PDF', 'primary')}</div>`;
      root.querySelectorAll('[data-download]').forEach(
        (btn) =>
          (btn.onclick = async () => {
            const doc = this.documents.find((d) => d.id === btn.dataset.download);
            try {
              await saveFile((await get('files', doc.id)).blob, doc.name);
            } catch (e) {
              toast(e.message, 'error');
            }
          }),
      );
      root.querySelectorAll('[data-rename]').forEach(
        (btn) =>
          (btn.onclick = async () => {
            const doc = this.documents.find((d) => d.id === btn.dataset.rename);
            const name = await inputDialog('重命名文档', { value: doc.name, label: '文档名称' });
            if (name) {
              await patch('documents', doc.id, { name });
              doc.name = name;
              if (this.activeId === doc.id) this.active.name = name;
              render(root.querySelector('#library-search').value);
              this.renderTabs();
            }
          }),
      );
    };
    render('');
    root.querySelector('#library-search').oninput = (event) => render(event.target.value);
  }
  showSecondary(view) {
    document.getElementById('workspace').hidden = true;
    document.getElementById('library-view').hidden = false;
    document.documentElement.dataset.view = view;
    document
      .querySelectorAll('.main-nav .nav-item')
      .forEach((btn) => btn.classList.toggle('active', btn.dataset.action === view));
  }
  async showRecords() {
    this.showSecondary('records');
    const rows = (await all('translations')).sort((a, b) => b.createdAt - a.createdAt);
    const root = document.getElementById('library-view');
    root.innerHTML = `<header class="library-header"><div><p class="eyebrow">READING, REMEMBERED</p><h1>翻译记录</h1><p>全文译文会留在这里；划词翻译不存入存档。</p></div></header><div class="record-list">${
      rows.length
        ? rows
            .map((row) => {
              const doc = this.documents.find((d) => d.id === row.documentId);
              return `<button class="record-card" data-record="${row.id}">${icon('languages')}<div><strong>${esc(doc?.name || 'PDF 文档')}</strong><p>${dateLabel(row.createdAt)} · ${row.language} · ${row.status === 'complete' ? '已完成' : '部分结果已保留'}</p></div>${icon('chevron-right')}</button>`;
            })
            .join('')
        : '<div class="library-empty"><h2>还没有全文翻译记录</h2><p>打开 PDF 后，在右栏选择“全文翻译”。</p></div>'
    }</div>`;
    root.querySelectorAll('[data-record]').forEach(
      (btn) =>
        (btn.onclick = async () => {
          const row = rows.find((r) => r.id === btn.dataset.record);
          await this.openDocument(row.documentId);
          this.assistant.tab = 'full';
          await this.assistant.render();
          const picker = document.querySelector('[data-select="translation-history"]');
          picker?.querySelector(`[data-value="${row.id}"]`)?.click();
          setMobilePane('assistant');
        }),
    );
  }
  async documentText(doc) {
    if (this.textCache.has(doc.id)) return this.textCache.get(doc.id);
    const pdf = await loadPdf((await get('files', doc.id)).blob, () =>
      inputDialog('读取加密 PDF', { password: true, label: 'PDF 密码' }),
    );
    try {
      const text = await extractPdfText(pdf);
      this.textCache.clear();
      this.textCache.set(doc.id, text);
      return text;
    } finally {
      await pdf.destroy();
    }
  }
  async downloadCurrent() {
    if (!this.active) return;
    const doc = this.active;
    const file = await get('files', doc.id);
    const annotations = (await all('annotations')).filter((a) => a.documentId === doc.id && !a.deleted);
    if (!annotations.length) {
      await saveFile(file.blob, doc.name);
      return;
    }
    toast('正在将批注写入 PDF…');
    const { exportAnnotatedPdf } = await import('./pdf-export.js');
    const blob = await exportAnnotatedPdf(file.blob, annotations, this.pdf);
    await saveFile(blob, doc.name.replace(/\.pdf$/i, ' · 批注.pdf'));
  }
  async reload() {
    this.documents = await all('documents');
    if (this.activeId) {
      const id = this.activeId;
      this.activeId = null;
      await this.openDocument(id);
    } else {
      this.renderTabs();
      await this.assistant.render();
    }
  }
  refreshAssistant() {
    this.assistant.render().catch((e) => toast(e.message, 'error'));
  }
  updateSaved() {
    document.getElementById('save-status').innerHTML = `${icon('check')}已保存到本机`;
  }
  setSyncStatus(message) {
    document.querySelector('[data-action="cloud"]').title = message;
  }
}
const app = new App();
app.init().catch((error) => {
  console.error(error);
  toast(`启动失败：${errorMessage(error)}`, 'error');
});
window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  toast(errorMessage(event.reason), 'error');
});
