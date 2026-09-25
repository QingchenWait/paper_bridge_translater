// UI metadata only; binary URLs, pinned revisions and checksums live in the manifest.
export const OFFLINE_MODELS = [
  {
    id: 'offline-lite',
    name: '中英翻译 Lite',
    bytes: 49913927,
    bundled: true,
    description: 'Firefox · 英文 → 简体中文',
  },
  {
    id: 'offline-plus',
    name: '中英翻译 Plus',
    bytes: 119495576,
    description: 'OPUS-MT INT8 · 英文 → 简体中文',
  },
  {
    id: 'offline-pro',
    name: '多语种翻译 Pro',
    bytes: 911959084,
    description: 'NLLB INT8 · 多语种 · 仅限非商业用途',
  },
];
let installed = new Set(['offline-lite']);
export const isOfflineModel = (id) => OFFLINE_MODELS.some((model) => model.id === id);
export const offlineOptions = () =>
  OFFLINE_MODELS.filter((m) => installed.has(m.id)).map((m) => [m.id, m.name]);
export function setOfflineInstalled(ids) {
  installed = new Set(['offline-lite', ...ids.filter(isOfflineModel)]);
}
export const offlineInstalled = (id) => installed.has(id);
export const NLLB_LANGUAGES = {
  'zh-CN': 'zho_Hans',
  'zh-TW': 'zho_Hant',
  en: 'eng_Latn',
  ja: 'jpn_Jpan',
  ko: 'kor_Hang',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  es: 'spa_Latn',
};
export function validateDirection(id, source, target) {
  if (!isOfflineModel(id)) throw new Error('未知的离线翻译模型');
  if (id === 'offline-pro') {
    if (!NLLB_LANGUAGES[source] || !NLLB_LANGUAGES[target])
      throw new Error('请选择 Pro 支持的原文和目标语言，不支持自动识别语言。');
  } else if (source !== 'en' || target !== 'zh-CN')
    throw new Error('此离线模型仅支持英文 → 简体中文，请调整翻译设置或选择多语种 Pro。');
}
