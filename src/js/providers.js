// New configurations only: never replace the user's saved model or endpoint.
export const PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'mimo',
    name: 'MiMO',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.6-flash',
    keyUrl: 'https://platform.xiaomimimo.com/console/api-keys',
  },
  {
    id: 'qwen',
    name: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-luna',
    protocol: 'responses',
    pdfInput: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'glm',
    name: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3-flash',
    keyUrl: 'https://bigmodel.cn/apikey/platform',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
  },
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: '' },
  { id: 'custom', name: '自定义', baseUrl: '', model: '' },
].map((preset) => ({ protocol: 'chat', pdfInput: false, pdfOutput: false, ...preset }));

export function providerKeyUrl(baseUrl) {
  try {
    const url = new URL(baseUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    return (
      PROVIDERS.find((preset) => preset.keyUrl && new URL(preset.baseUrl).hostname === url.hostname)
        ?.keyUrl || null
    );
  } catch {
    return null;
  }
}

// Saved provider IDs are UUIDs; identify branding without changing their identity.
export function providerBrand(provider = {}) {
  try {
    const host = new URL(provider.baseUrl).host;
    const preset = PROVIDERS.find((p) => p.baseUrl && new URL(p.baseUrl).host === host);
    if (preset) return preset.id;
  } catch {
    /* Custom endpoints may still use a recognizable model name. */
  }
  const names = `${provider.model || ''} ${provider.name || ''}`.toLowerCase();
  return (
    [
      ['deepseek', /deepseek/],
      ['mimo', /mimo/],
      ['qwen', /qwen|通义/],
      ['openai', /openai|\bgpt-|\bo[134]-/],
      ['glm', /\bglm|智谱/],
      ['kimi', /kimi|moonshot/],
      ['lmstudio', /lm\s*studio/],
    ].find(([, pattern]) => pattern.test(names))?.[0] || 'custom'
  );
}

export async function openProviderWebsite(baseUrl) {
  const url = providerKeyUrl(baseUrl);
  if (!url) return;
  return openExternalWebsite(url);
}
export async function openExternalWebsite(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('无效的官网地址');
  const url = parsed.href;
  if (window.__TAURI__?.opener?.openUrl) await window.__TAURI__.opener.openUrl(url);
  else if (window.__TAURI_INTERNALS__?.invoke)
    await window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url });
  else if (window.__TAURI__?.shell?.open) await window.__TAURI__.shell.open(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
