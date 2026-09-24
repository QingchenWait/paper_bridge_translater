// Adapted from 海姆休息室 src/js/settings.js (GPL-3.0); field meanings remain compatible.
import { get, put } from './storage.js';
import { normalizeBasicTranslation } from './basic-translation.js';
export { PROVIDERS } from './providers.js';
export const READING_FONT_LIMITS = { min: 70, max: 180, step: 10 };
export function normalizeReadingFontSizes(raw = {}) {
  return Object.fromEntries(
    ['source', 'selection', 'full'].map((key) => {
      const value = Number(raw?.[key]);
      return [
        key,
        Number.isFinite(value) && value > 0
          ? Math.max(READING_FONT_LIMITS.min, Math.min(READING_FONT_LIMITS.max, Math.round(value)))
          : 100,
      ];
    }),
  );
}
export function normalizeSettings(raw = {}) {
  const source = Array.isArray(raw.chatProviders)
    ? raw.chatProviders
    : raw.baseUrl
      ? [{ id: 'imported', ...raw }]
      : [];
  const used = new Set();
  const chatProviders = source.map((item, index) => {
    let id = String(item.id || `provider-${index + 1}`)
      .trim()
      .replace(/\s+/g, '-');
    const base = id;
    let suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    return {
      id,
      name: String(item.name || item.id || '自定义 API'),
      apiKey: String(item.apiKey || '').trim(),
      baseUrl: String(item.baseUrl || '')
        .trim()
        .replace(/\/+$/, ''),
      model: String(item.model || '').trim(),
      protocol: item.protocol === 'responses' ? 'responses' : 'chat',
      pdfInput: item.pdfInput === true,
      pdfOutput: item.pdfOutput === true,
    };
  });
  const selected = chatProviders.find((p) => p.id === raw.defaultChatProviderId) || chatProviders[0];
  return {
    ...raw,
    chatProviders,
    defaultChatProviderId: selected?.id || '',
    apiKey: selected?.apiKey || '',
    baseUrl: selected?.baseUrl || '',
    model: selected?.model || '',
    targetLanguage: raw.targetLanguage || 'zh-CN',
    sourceLanguage: raw.sourceLanguage || 'en',
    translationEngine: raw.translationEngine || 'online',
    basicTranslation: normalizeBasicTranslation(raw.basicTranslation),
    translationProviderId: raw.translationProviderId || selected?.id || '',
    translationStyle: raw.translationStyle || '学术论文',
    readingFontSizes: normalizeReadingFontSizes(raw.readingFontSizes),
    onboardingDone: raw.onboardingDone === true,
    hideOnboarding: raw.hideOnboarding === true,
    webdav: {
      url: '',
      path: '/paper-bridge',
      username: '',
      password: '',
      enabled: false,
      intervalMinutes: 30,
      ...raw.webdav,
    },
  };
}
let settings;
let settingsSave = Promise.resolve();
export async function getSettings() {
  return (settings ||= normalizeSettings((await get('settings', 'app'))?.value));
}
export async function reloadSettings() {
  settings = null;
  return getSettings();
}
export function saveSettings(next) {
  // Capture input now; serialize every settings writer against the latest commit.
  const update = typeof next === 'function' ? next : structuredClone(next);
  const pending = settingsSave
    .catch(() => {})
    .then(async () => {
      const current = await getSettings();
      const patch = typeof update === 'function' ? update(structuredClone(current)) : update;
      const normalized = normalizeSettings({ ...current, ...patch });
      await put('settings', { id: 'app', value: normalized });
      settings = normalized;
      document.dispatchEvent(new CustomEvent('settings-changed', { detail: normalized }));
      return normalized;
    });
  settingsSave = pending;
  return pending;
}
export function flushSettings() {
  return settingsSave;
}
export function adjustReadingFontSize(area, direction) {
  if (!['source', 'selection', 'full'].includes(area) || ![-1, 1].includes(direction))
    return Promise.reject(new Error('无效的阅读字号操作'));
  // Merge at commit time so rapid clicks or other settings writes cannot lose a step.
  return saveSettings((current) => ({
    readingFontSizes: {
      ...current.readingFontSizes,
      [area]: current.readingFontSizes[area] + direction * READING_FONT_LIMITS.step,
    },
  }));
}
export function saveBasicTranslation(update, preferences = {}) {
  return saveSettings((current) => ({ ...preferences, basicTranslation: update(current.basicTranslation) }));
}
export function getProvider(settings, id = settings.defaultChatProviderId) {
  const provider = settings.chatProviders.find((p) => p.id === id);
  if (!provider?.baseUrl || !provider?.model) throw new Error('请在设置中填写 API 地址和模型名称');
  return provider;
}
