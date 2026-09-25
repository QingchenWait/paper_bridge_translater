import { installedModels, installModel, removeModel, loadAsset } from './store.js';
import { validateDirection } from './catalog.js';
import { createBergamot } from './bergamot.js';
import { createOnnx } from './onnx.js';

const loaders = { bergamot: createBergamot, onnx: createOnnx };
let manifestPromise, activeModel, engine;
async function manifest(base) {
  return (manifestPromise ||= fetch(new URL('manifest.json', base))
    .then((r) => {
      if (!r.ok) throw new Error('无法读取离线模型清单，请检查静态资源部署。');
      return r.json();
    })
    .catch((error) => {
      manifestPromise = null;
      throw error;
    }));
}
async function handle({ id, type, modelId, base, text, source, target, files }) {
  const progress = (detail) => self.postMessage({ id, type: 'progress', modelId, ...detail });
  try {
    const registry = await manifest(base);
    if (type === 'list') {
      self.postMessage({ id, result: await installedModels(registry) });
      return;
    }
    const model = registry.models.find((m) => m.id === modelId);
    if (!model || !loaders[model.engine]) throw new Error('此模型格式尚无可用加载器。');
    if (type === 'install' || type === 'import')
      await installModel(model, registry, base, type === 'import' ? files : null, progress);
    else if (type === 'delete') await removeModel(model, registry);
    else if (type === 'load' || type === 'translate') {
      if (type === 'translate') validateDirection(modelId, source, target);
      if (activeModel && activeModel !== modelId) throw new Error('切换模型需要释放旧 Worker。');
      if (!engine) {
        progress({ phase: 'loading' });
        if (!model.bundled && !(await installedModels(registry)).includes(modelId))
          throw new Error('请先完整下载或导入该离线模型。');
        // Prepare local assets before executing the matching runtime.
        for (const file of registry.runtimes.filter((f) => f.engine === model.engine))
          await loadAsset(file, base);
        engine = await loaders[model.engine](model, registry, base);
        activeModel = modelId;
      }
      progress({ phase: 'ready' });
      if (type === 'translate') {
        const results = [];
        // Segment on sentences/whitespace, never silently discard long selections.
        const chunks = text.match(/[^.!?。！？\n]+[.!?。！？\n]*|[.!?。！？\n]+/g) || [text];
        for (const sentence of chunks) {
          let pending = sentence;
          while (pending.length) {
            let cut = Math.min(pending.length, model.engine === 'onnx' ? 160 : 500);
            if (cut < pending.length) {
              const space = pending.lastIndexOf(' ', cut);
              if (space > cut / 2) cut = space + 1;
              if (/[\uD800-\uDBFF]/.test(pending[cut - 1])) cut--;
            }
            const chunk = pending.slice(0, cut);
            pending = pending.slice(cut);
            if (chunk.trim()) results.push(await engine.translate(chunk, source, target));
          }
        }
        const result = results.join(['zh-CN', 'zh-TW', 'ja'].includes(target) ? '' : ' ');
        if (!result.trim()) throw new Error('离线模型没有生成译文，请重试。');
        self.postMessage({ id, result });
        return;
      }
    } else throw new Error('未知的离线翻译请求。');
    self.postMessage({ id, result: true });
  } catch (error) {
    self.postMessage({
      id,
      error:
        error?.name === 'QuotaExceededError'
          ? '模型存储空间不足，已有文档未改动。请释放空间后重试。'
          : String(error?.message || error),
    });
  }
}
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data)).catch(() => {});
};
