import { patch } from './storage.js';
const active = new Set();
export class TranslationWriter {
  constructor(id, onError, save = (content) => patch('translations', id, { content })) {
    this.save = save;
    this.onError = onError;
    this.content = '';
    this.version = 0;
    this.saved = 0;
    active.add(this);
  }
  update(content) {
    this.content = content;
    this.version++;
    if (!this.timer && !this.running)
      this.timer = setTimeout(() => {
        this.timer = null;
        this.write().catch(this.onError);
      }, 200);
  }
  write() {
    if (this.running) return this.running;
    if (this.saved === this.version) return Promise.resolve();
    const version = this.version,
      content = this.content;
    this.running = this.save(content)
      .then(() => {
        this.saved = version;
        if (this.saved !== this.version && !this.timer)
          this.timer = setTimeout(() => {
            this.timer = null;
            this.write().catch(this.onError);
          }, 200);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = null;
    while (this.saved !== this.version || this.running) await this.write();
  }
  close() {
    clearTimeout(this.timer);
    active.delete(this);
  }
}
export async function flushTranslationWrites() {
  await Promise.all([...active].map((writer) => writer.flush()));
}
if (typeof window !== 'undefined') {
  const flush = () => {
    for (const writer of active) writer.flush().catch(writer.onError);
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });
}
