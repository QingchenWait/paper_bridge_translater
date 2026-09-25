import { loadAsset } from './store.js';
export async function createBergamot(model, manifest, base) {
  const runtime = manifest.runtimes.filter((file) => file.engine === 'bergamot');
  const binary = await loadAsset(
    runtime.find((f) => f.path.endsWith('.wasm')),
    base,
  );
  const { default: loadBergamot } = await import(
    /* @vite-ignore */ new URL('bergamot/bergamot-translator.mjs', base).href
  );
  const wasmBinary = new Uint8Array(await binary.arrayBuffer());
  if (!WebAssembly.validate(wasmBinary))
    throw new Error('当前浏览器无法运行此 WASM 模型，请升级浏览器后重试。');
  const bergamot = await new Promise((resolve, reject) => {
    const instance = loadBergamot({
      wasmBinary,
      INITIAL_MEMORY: 41943040,
      print() {},
      printErr() {},
      onAbort: () => reject(new Error('Bergamot 无法启动，请检查浏览器 WebAssembly 支持。')),
      onRuntimeInitialized: () => queueMicrotask(() => resolve(instance)),
    });
  });
  const memory = {};
  for (const file of model.files) {
    const blob = await loadAsset(file, base);
    const aligned = new bergamot.AlignedMemory(blob.size, file.role === 'model' ? 256 : 64);
    aligned.getByteArrayView().set(new Uint8Array(await blob.arrayBuffer()));
    memory[file.role] = aligned;
  }
  const vocab = new bergamot.AlignedMemoryList();
  vocab.push_back(memory.srcVocab);
  vocab.push_back(memory.trgVocab);
  const config =
    'beam-size: 1\nnormalize: 1.0\nword-penalty: 0\nmax-length-break: 128\nmini-batch-words: 1024\nworkspace: 128\nmax-length-factor: 2.0\nskip-cost: true\ncpu-threads: 0\nquiet: true\nquiet-translation: true\ngemm-precision: int8shiftAlphaAll\nalignment: soft\n';
  const translationModel = new bergamot.TranslationModel(
    'en',
    'zh',
    config,
    memory.model,
    memory.lexicalShortlist,
    vocab,
    null,
  );
  const service = new bergamot.BlockingService({ cacheSize: 0 });
  return {
    translate(text) {
      const messages = new bergamot.VectorString(),
        options = new bergamot.VectorResponseOptions();
      let responses, response;
      try {
        messages.push_back(text);
        options.push_back({ qualityScores: false, alignment: false, html: false });
        responses = service.translate(translationModel, messages, options);
        response = responses.get(0);
        return response.getTranslatedText();
      } finally {
        response?.delete();
        responses?.delete();
        messages.delete();
        options.delete();
      }
    },
  };
}
