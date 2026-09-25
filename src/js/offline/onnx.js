import { getAsset, loadAsset } from './store.js';
import { NLLB_LANGUAGES } from './catalog.js';

export async function createOnnx(model, manifest, base) {
  for (const file of manifest.runtimes.filter((file) => file.engine === 'onnx')) await loadAsset(file, base);
  const { env, pipeline } = await import(/* @vite-ignore */ new URL('onnx/transformers.min.js', base).href);
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useCustomCache = true;
  env.localModelPath = new URL('models/', base).href;
  env.customCache = {
    async match(key) {
      const prefix = `${env.localModelPath}${model.id}/`;
      if (!String(key).startsWith(prefix)) return undefined;
      const file = model.files.find((f) => f.path === String(key).slice(prefix.length));
      const blob = file && (await getAsset(file));
      return blob ? new Response(blob) : undefined;
    },
    async put() {},
  };
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.logLevel = 'error';
  env.backends.onnx.wasm.proxy = false;
  env.backends.onnx.wasm.wasmPaths = new URL('onnx/', base).href;
  const translator = await pipeline('translation', model.id, { quantized: true, local_files_only: true });
  return {
    async translate(text, source, target) {
      // Small input segments keep output well below the model's position limit.
      let generated = 0;
      const result = await translator(text, {
        max_new_tokens: 256,
        num_beams: 1,
        callback_function: () => {
          generated++;
        },
        ...(model.id === 'offline-pro'
          ? { src_lang: NLLB_LANGUAGES[source], tgt_lang: NLLB_LANGUAGES[target] }
          : {}),
      });
      if (generated >= 256) throw new Error('此段译文达到模型长度上限，请缩短选区后重试。未返回不完整译文。');
      if (!result?.[0]?.translation_text?.trim()) throw new Error('离线模型未返回有效译文。');
      return result[0].translation_text;
    },
  };
}
