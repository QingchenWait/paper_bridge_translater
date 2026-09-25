import { sanitizeMarkdown, prepareMarkdown } from './markdown.js';

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
export class FullMarkdown {
  constructor(host, onPatch, onError) {
    this.host = host;
    this.onPatch = onPatch;
    this.onError = onError;
    this.nodes = [];
    this.text = '';
    this.revision = 0;
    this.applied = 0;
    this.waiters = [];
    this.startWorker();
  }
  startWorker() {
    this.sleeping = false;
    try {
      this.worker = new Worker(new URL('./markdown.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => this.receive(data);
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.useFallback();
      };
    } catch {
      this.useFallback();
    }
  }
  useFallback() {
    this.worker?.terminate();
    this.worker = null;
    this.fallback ||= import('./markdown-blocks.js').then(({ MarkdownBlocks }) => new MarkdownBlocks());
    this.busy = false;
    this.schedule();
  }
  set(text) {
    if (this.closed || (this.revision && this.text === text)) return;
    if (this.sleeping) this.startWorker();
    this.text = text;
    this.failure = null;
    this.revision++;
    this.schedule();
  }
  schedule() {
    if (this.closed || this.failure || this.busy || this.timer || this.applied === this.revision) return;
    // One job in flight + the latest snapshot, never an unbounded chunk queue.
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send();
    }, 80);
  }
  async send() {
    if (this.closed || this.busy) return;
    this.busy = true;
    const data = { id: this.revision, text: this.text };
    if (this.worker) this.worker.postMessage(data);
    else
      try {
        const renderer = await this.fallback;
        await pause();
        await this.receive({ id: data.id, blocks: renderer.render(data.text) });
      } catch (error) {
        this.receive({ id: data.id, error: error.message });
      }
  }
  async receive({ id, blocks, error }) {
    if (this.closed) return;
    if (error) {
      this.busy = false;
      this.failure = new Error(error);
      this.onError(this.failure);
      this.release(this.failure);
      return;
    }
    try {
      let deadline = performance.now() + 7;
      for (let i = 0; i < blocks.length; i++) {
        if (this.closed) return;
        const block = blocks[i];
        let node = this.nodes[i];
        let replaced;
        const fresh = !node || node.paragraph !== !!block.paragraph;
        if (fresh) {
          const element = document.createElement(block.paragraph ? 'p' : 'div');
          element.className = 'full-markdown-block';
          replaced = node?.element;
          // Build an initial enormous paragraph off-DOM. Yielding while adding
          // its parts to a connected paragraph would repeatedly lay out its prefix.
          node = this.nodes[i] = { element, paragraph: !!block.paragraph, parts: [], html: null };
        }
        if (block.paragraph) {
          for (let j = 0; j < block.parts.length; j++) {
            const html = block.parts[j];
            let part = node.parts[j];
            if (!part) {
              part = node.parts[j] = { element: document.createElement('span') };
              node.element.append(part.element);
            }
            if (part.html !== html) {
              part.element.innerHTML = sanitizeMarkdown(html);
              part.html = html;
              prepareMarkdown(part.element);
              if (!fresh) this.onPatch(part.element);
            }
            if (performance.now() > deadline) {
              await pause();
              deadline = performance.now() + 7;
              if (this.closed) return;
            }
          }
          while (node.parts.length > block.parts.length) node.parts.pop().element.remove();
        } else if (node.html !== block.html) {
          node.element.innerHTML = sanitizeMarkdown(block.html);
          node.html = block.html;
          prepareMarkdown(node.element);
          if (!fresh) this.onPatch(node.element);
        }
        if (fresh) {
          if (replaced) replaced.replaceWith(node.element);
          else this.host.append(node.element);
          this.onPatch(node.element);
        }
        if (performance.now() > deadline) {
          await pause();
          deadline = performance.now() + 7;
        }
      }
      while (this.nodes.length > blocks.length) this.nodes.pop().element.remove();
      this.applied = id;
    } catch (failure) {
      this.failure = failure;
      this.onError(failure);
      this.release(failure);
    } finally {
      this.busy = false;
      if (this.applied === this.revision) this.release();
      else this.schedule();
    }
  }
  release(error) {
    for (const { resolve, reject } of this.waiters.splice(0)) error ? reject(error) : resolve();
  }
  flush() {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed || this.applied === this.revision) return Promise.resolve();
    const done = new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.busy) this.send();
    return done;
  }
  async finish() {
    await this.flush();
    if (this.closed || this.applied !== this.revision) return;
    this.worker?.terminate();
    this.worker = null;
    this.fallback = null;
    this.sleeping = true;
  }
  destroy() {
    this.closed = true;
    clearTimeout(this.timer);
    this.worker?.terminate();
    this.release();
  }
}
