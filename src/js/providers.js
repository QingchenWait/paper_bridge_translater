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
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'https://localhost:1234/v1', model: '' },
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

export async function openProviderWebsite(baseUrl) {
  const url = providerKeyUrl(baseUrl);
  if (!url) return;
  if (window.__TAURI__?.opener?.openUrl) await window.__TAURI__.opener.openUrl(url);
  else if (window.__TAURI_INTERNALS__?.invoke)
    await window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url });
  else if (window.__TAURI__?.shell?.open) await window.__TAURI__.shell.open(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
