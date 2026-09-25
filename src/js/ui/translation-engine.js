import { saveBasicTranslation } from '../settings.js';
import { basicOptions } from '../basic-translation.js';
import { providerBrand } from '../providers.js';
import { esc } from '../utils.js';
import { icon, providerLogo } from './components.js';
import { isOfflineModel } from '../offline/catalog.js';

export function translationEngines(settings) {
  return [
    ...basicOptions(settings.basicTranslation).map(([id, name]) => ({
      key: id === 'mymemory' ? 'online' : `basic:${id}`,
      name: isOfflineModel(id) ? `本地引擎 · ${name}` : id === 'mymemory' ? 'MyMemory (额度有限)' : name,
      brand: isOfflineModel(id) ? 'local' : id === 'mymemory' ? 'meta' : id,
      kind: '机翻',
    })),
    ...settings.chatProviders.map((p) => ({
      key: `llm:${p.id}`,
      name: `${p.name} · ${p.model || 'LLM'}`,
      brand: providerBrand(p),
      kind: 'AI',
    })),
  ];
}
export function translationEngineValue(settings) {
  return settings.translationEngine === 'online'
    ? settings.basicTranslation.defaultProvider === 'mymemory'
      ? 'online'
      : `basic:${settings.basicTranslation.defaultProvider}`
    : `llm:${settings.translationProviderId || settings.defaultChatProviderId}`;
}
export function saveTranslationEngine(key, preferences = {}) {
  // No engine in the selection-tab settings popover: save only its other fields.
  return saveBasicTranslation(
    (current) => ({
      ...current,
      defaultProvider: key?.startsWith('basic:')
        ? key.slice(6)
        : key === 'online'
          ? 'mymemory'
          : current.defaultProvider,
    }),
    {
      ...preferences,
      ...(key ? { translationEngine: key.startsWith('llm:') ? 'llm' : 'online' } : {}),
      ...(key?.startsWith('llm:') ? { translationProviderId: key.slice(4) } : {}),
    },
  );
}
const logo = (engine) =>
  engine?.brand && engine.brand !== 'custom' ? providerLogo(engine.brand) : icon('bot');
export const engineTrigger = (engine) =>
  `${logo(engine)}<span class="engine-kind">·${engine?.kind || 'AI'}</span>`;
export function engineMenu(engines, value) {
  const current = engines.find((e) => e.key === value);
  return `<div class="custom-select selection-engine" data-select="selection-engine" data-value="${esc(value)}">
    <button type="button" class="select-trigger" aria-label="翻译引擎" title="${esc(current?.name || '请选择翻译引擎')}" aria-haspopup="listbox" aria-expanded="false">${engineTrigger(current)}</button>
    <div class="select-menu" role="listbox" aria-label="翻译引擎" hidden>${[
      ['机翻', '机翻高速引擎'],
      ['AI', 'AI 大模型引擎'],
    ]
      .map(
        ([kind, title]) =>
          `<div role="group" aria-label="${title}"><div class="engine-group-title" aria-hidden="true">${title}</div>${engines
            .filter((e) => e.kind === kind)
            .map(
              (e) =>
                `<button type="button" role="option" aria-selected="${e.key === value}" data-value="${esc(e.key)}">${logo(e)}<span>${esc(e.name)}</span></button>`,
            )
            .join('')}</div>`,
      )
      .join('')}</div>
  </div>`;
}
