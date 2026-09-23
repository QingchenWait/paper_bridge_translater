// Adapted from 海姆休息室 src/js/settings.js (GPL-3.0); field meanings remain compatible.
import { get, put } from './storage.js';
export { PROVIDERS } from './providers.js';
export function normalizeSettings(raw = {}) {
  const source = raw.chatProviders?.length
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
    translationProviderId: raw.translationProviderId || selected?.id || '',
    translationStyle: raw.translationStyle || '学术论文',
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
export async function getSettings() {
  return (settings ||= normalizeSettings((await get('settings', 'app'))?.value));
}
export async function reloadSettings() {
  settings = null;
  return getSettings();
}
export async function saveSettings(next) {
  const normalized = normalizeSettings({ ...(await getSettings()), ...next });
  await put('settings', { id: 'app', value: normalized });
  settings = normalized;
  document.dispatchEvent(new CustomEvent('settings-changed', { detail: normalized }));
  return normalized;
}
export function getProvider(settings, id = settings.defaultChatProviderId) {
  const provider = settings.chatProviders.find((p) => p.id === id);
  if (!provider?.baseUrl || !provider?.model) throw new Error('请在设置中填写 API 地址和模型名称');
  return provider;
}
