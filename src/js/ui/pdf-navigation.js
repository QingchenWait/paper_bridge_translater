import { icon, iconButton } from './components.js';
import { esc } from '../utils.js';

export class PdfNavigation {
  constructor(root, { navigate, onMode, error, search, navigateMatch }) {
    this.root = root;
    this.navigate = navigate;
    this.onMode = onMode;
    this.error = error;
    this.search = search;
    this.navigateMatch = navigateMatch;
    this.searchState = {
      query: '',
      caseSensitive: false,
      wholeWord: false,
      results: [],
      status: 'idle',
      progress: '',
    };
    this.mode = '';
    this.generation = 0;
    this.tasks = new Set();
  }
  stopRendering() {
    this.generation++;
    this.observer?.disconnect();
    for (const task of this.tasks) task.cancel();
    this.tasks.clear();
  }
  setDocument(pdf) {
    this.searchController?.abort();
    this.searchState = {
      query: '',
      caseSensitive: false,
      wholeWord: false,
      results: [],
      status: 'idle',
      progress: '',
    };
    this.stopRendering();
    this.pdf = pdf;
    if (!pdf) {
      this.mode = '';
      this.root.hidden = true;
      this.root.replaceChildren();
      this.onMode('');
    } else if (this.mode) this.render().catch(this.error);
  }
  toggle(mode) {
    if (!this.pdf) return;
    this.setMode(this.mode === mode ? '' : mode);
  }
  close() {
    this.setMode('');
  }
  setMode(mode) {
    if (!this.pdf && mode) return;
    this.mode = mode;
    this.stopRendering();
    this.root.hidden = !this.mode;
    if (!this.mode) this.root.replaceChildren();
    this.onMode(this.mode);
    if (this.mode) this.render().catch(this.error);
  }
  async render() {
    const generation = ++this.generation,
      pdf = this.pdf;
    this.root.innerHTML = `<header class="pdf-navigation-header"><div class="pdf-navigation-tabs" role="tablist" aria-label="PDF 导航模式">${[
      ['bookmarks', '书签'],
      ['thumbnails', '缩略图'],
      ['search', '查找'],
    ]
      .map(
        ([mode, label]) =>
          `<button role="tab" data-nav-mode="${mode}" aria-selected="${mode === this.mode}" class="${mode === this.mode ? 'active' : ''}">${label}</button>`,
      )
      .join(
        '',
      )}</div>${iconButton('close-navigation', 'x', '关闭 PDF 导航')}</header><div class="pdf-navigation-content"></div>`;
    this.root.querySelector('[data-action="close-navigation"]').onclick = () => this.close();
    this.root
      .querySelectorAll('[data-nav-mode]')
      .forEach((button) => (button.onclick = () => this.setMode(button.dataset.navMode)));
    const content = this.root.querySelector('.pdf-navigation-content');
    if (this.mode === 'search') {
      this.renderSearch(content);
      return;
    }
    if (this.mode === 'thumbnails') {
      for (let number = 1; number <= pdf.numPages; number++) {
        const button = document.createElement('button');
        button.className = 'pdf-thumbnail';
        button.dataset.page = number;
        button.setAttribute('aria-label', `跳到第 ${number} 页`);
        button.innerHTML = `<span class="thumbnail-paper">${icon('file-text')}</span><span class="thumbnail-label">${number}</span>`;
        button.onclick = () => this.navigate(number);
        content.append(button);
      }
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            this.observer.unobserve(entry.target);
            this.renderThumbnail(entry.target, pdf, generation).catch((error) => {
              if (generation === this.generation && error.name !== 'RenderingCancelledException')
                this.error(error);
            });
          }
        },
        { root: content, rootMargin: '160px' },
      );
      content.querySelectorAll('.pdf-thumbnail').forEach((button) => this.observer.observe(button));
      this.setPage(this.page || 1);
    } else {
      content.innerHTML = '<div class="navigation-empty"><span class="spinner small"></span>读取书签…</div>';
      let outline;
      try {
        outline = await pdf.getOutline();
      } catch (error) {
        if (generation === this.generation) throw error;
        return;
      }
      if (generation !== this.generation) return;
      content.replaceChildren();
      if (!outline?.length) {
        content.innerHTML = '<div class="navigation-empty">这份 PDF 没有内置书签</div>';
        return;
      }
      const append = (items, depth) => {
        for (const item of items) {
          const button = document.createElement('button');
          button.className = 'pdf-bookmark';
          button.style.setProperty('--bookmark-depth', Math.min(depth, 8));
          button.innerHTML = `${icon('bookmark')}<span>${esc(item.title || '未命名书签')}</span>`;
          if (!item.dest) {
            button.disabled = true;
            button.title = '此书签没有文档内跳转位置';
          }
          button.onclick = async () => {
            try {
              const destination =
                typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
              if (!Array.isArray(destination)) throw new Error('无法解析书签位置');
              const index = Number.isInteger(destination[0])
                ? destination[0]
                : await pdf.getPageIndex(destination[0]);
              if (generation === this.generation) this.navigate(index + 1);
            } catch (error) {
              if (generation === this.generation) this.error(error);
            }
          };
          content.append(button);
          if (item.items?.length) append(item.items, depth + 1);
        }
      };
      append(outline, 0);
    }
  }
  renderSearch(content) {
    const state = this.searchState;
    content.innerHTML = `<form class="navigation-search-form"><input type="text" aria-label="查找文本" placeholder="查找文字" value="${esc(state.query)}">${iconButton('run-pdf-search', 'search', '查找')}</form><div class="search-filters"><label class="toggle-row"><span>区分大小写</span><input type="checkbox" name="caseSensitive" ${state.caseSensitive ? 'checked' : ''}><span class="switch"></span></label><label class="toggle-row"><span>全字匹配</span><input type="checkbox" name="wholeWord" ${state.wholeWord ? 'checked' : ''}><span class="switch"></span></label></div><div class="navigation-search-status" role="status"></div><div class="search-results"></div>`;
    content.querySelector('input[type=text]').oninput = (event) => (state.query = event.target.value);
    content
      .querySelectorAll('input[type=checkbox]')
      .forEach((input) => (input.onchange = () => (state[input.name] = input.checked)));
    content.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      this.startSearch();
    };
    content.querySelector('[data-action="run-pdf-search"]').onclick = () => this.startSearch();
    this.updateSearchResults();
  }
  updateSearchResults() {
    if (this.mode !== 'search') return;
    const status = this.root.querySelector('.navigation-search-status');
    if (!status) return;
    const state = this.searchState;
    status.innerHTML =
      state.status === 'searching'
        ? `<span class="spinner small"></span><span>正在查找 ${esc(state.progress)}</span>`
        : state.error
          ? esc(state.error)
          : state.status === 'complete'
            ? `找到 ${state.results.length} 处匹配`
            : '输入文字后开始查找';
    const list = this.root.querySelector('.search-results');
    list.replaceChildren();
    if (state.status !== 'complete') return;
    for (const result of state.results) {
      const button = document.createElement('button');
      button.className = 'search-result';
      button.dataset.matchId = result.id;
      button.title = `第 ${result.page} 页 · ${result.snippet}`;
      button.innerHTML = `<span class="search-page">${result.page}</span><span>${esc(result.snippet)}</span>`;
      button.onclick = () => this.navigateMatch(result).catch(this.error);
      list.append(button);
    }
  }
  async startSearch() {
    const state = this.searchState;
    if (!state.query.trim()) {
      this.searchController?.abort();
      state.results = [];
      state.status = 'idle';
      state.error = '';
      await this.search('');
      this.updateSearchResults();
      return;
    }
    this.searchController?.abort();
    const controller = (this.searchController = new AbortController());
    const pdf = this.pdf;
    state.status = 'searching';
    state.results = [];
    state.error = '';
    state.progress = '';
    this.updateSearchResults();
    try {
      const results = await this.search(
        state.query,
        { caseSensitive: state.caseSensitive, wholeWord: state.wholeWord },
        {
          signal: controller.signal,
          onProgress: (page, total) => {
            if (this.pdf === pdf && this.searchController === controller) {
              state.progress = `${page} / ${total}`;
              this.updateSearchResults();
            }
          },
        },
      );
      if (this.pdf !== pdf || this.searchController !== controller) return;
      state.results = results;
      state.status = 'complete';
    } catch (error) {
      if (controller.signal.aborted) return;
      state.status = 'error';
      state.error = error.message;
    } finally {
      if (this.pdf === pdf && this.searchController === controller) this.updateSearchResults();
    }
  }
  async renderThumbnail(button, pdf, generation) {
    const page = await pdf.getPage(Number(button.dataset.page));
    if (generation !== this.generation) return;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 150 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width * 1.5);
    canvas.height = Math.ceil(viewport.height * 1.5);
    const task = page.render({
      canvasContext: canvas.getContext('2d'),
      viewport,
      transform: [1.5, 0, 0, 1.5, 0, 0],
    });
    this.tasks.add(task);
    try {
      await task.promise;
      if (generation !== this.generation) return;
      const image = document.createElement('img');
      image.alt = `第 ${button.dataset.page} 页缩略图`;
      image.src = canvas.toDataURL('image/jpeg', 0.76);
      const paper = button.querySelector('.thumbnail-paper');
      paper.style.aspectRatio = String(viewport.width / viewport.height);
      paper.replaceChildren(image);
    } finally {
      this.tasks.delete(task);
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  setPage(page) {
    this.page = page;
    this.root.querySelectorAll('.pdf-thumbnail').forEach((button) => {
      const active = Number(button.dataset.page) === page;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
  }
}
