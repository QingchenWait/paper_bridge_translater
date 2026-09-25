import { cleanPdfText, splitForTranslation } from './text.js';
import { offlineOptions, isOfflineModel } from './offline/catalog.js';

export const BASIC_APIS = [
  {
    id: 'baidu',
    name: '百度论文翻译 API',
    quota: '每月 50 万字符免费额度',
    idLabel: 'APP ID',
    secretLabel: '密钥',
  },
  {
    id: 'aliyun',
    name: '阿里云翻译 API',
    quota: '每月 100 万字符免费额度',
    idLabel: 'AccessKey ID',
    secretLabel: 'AccessKey Secret',
  },
  {
    id: 'volcengine',
    name: '火山引擎翻译 API',
    quota: '【网页版不能使用】每月 200 万字符免费额度',
    idLabel: 'AccessKeyID',
    secretLabel: 'SecretAccessKey',
  },
];
export const BASIC_FREE = [
  ['mymemory', 'MyMemory（每日上限低）'],
  ['google', 'Google 翻译（仅海外可访问）'],
];
export function basicConfigured(config) {
  return Boolean(String(config?.keyId || '').trim() && String(config?.secret || '').trim());
}
export function basicOptions(basic) {
  return [
    ...BASIC_FREE,
    ...offlineOptions(),
    ...BASIC_APIS.filter((p) => basicConfigured(basic?.providers?.[p.id])).map((p) => [p.id, p.name]),
  ];
}
export function normalizeBasicTranslation(raw = {}) {
  const providers = Object.fromEntries(
    BASIC_APIS.map(({ id }) => {
      const value = raw?.providers?.[id] || {};
      return [
        id,
        {
          keyId: String(value.keyId || '').trim(),
          secret: String(value.secret || '').trim(),
          connection:
            value.connection?.ok === true && basicConfigured(value)
              ? {
                  ok: true,
                  checkedAt: Number(value.connection.checkedAt) || 0,
                  style: String(value.connection.style || ''),
                }
              : null,
        },
      ];
    }),
  );
  const options = basicOptions({ providers });
  return {
    providers,
    defaultProvider:
      options.some(([id]) => id === raw?.defaultProvider) || isOfflineModel(raw?.defaultProvider)
        ? raw.defaultProvider
        : 'mymemory',
  };
}
// An archive without secrets must never erase an existing local credential.
export function mergeBasicTranslation(local = {}, incoming = {}) {
  local ||= {};
  incoming ||= {};
  const providers = { ...local.providers };
  for (const { id } of BASIC_APIS) {
    const next = incoming.providers?.[id],
      previous = providers[id];
    if (!next) continue;
    const sameAccount = !next.keyId || next.keyId === previous?.keyId;
    providers[id] = {
      ...previous,
      ...next,
      keyId: next.keyId || previous?.keyId || '',
      secret: next.secret || (sameAccount ? previous?.secret : '') || '',
      connection: null,
    };
    // Keep the existing complete account if an imported account lacks its secret.
    if (!next.secret && !sameAccount && basicConfigured(previous))
      providers[id] = { ...previous, connection: null };
  }
  return normalizeBasicTranslation({ ...local, ...incoming, providers });
}
const encoder = new TextEncoder();
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const bytes = (value) => (typeof value === 'string' ? encoder.encode(value) : value);
const digest = async (value) => hex(await crypto.subtle.digest('SHA-256', bytes(value)));
async function hmac(key, value, algorithm = 'SHA-256') {
  const material = await crypto.subtle.importKey(
    'raw',
    bytes(key),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', material, bytes(value)));
}
const encode = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const query = (params) =>
  Object.keys(params)
    .sort()
    .map((key) => `${encode(key)}=${encode(params[key])}`)
    .join('&');
export function basicLanguage(provider, language) {
  const map =
    provider === 'baidu'
      ? { 'zh-CN': 'zh', 'zh-TW': 'cht', ja: 'jp', ko: 'kor', fr: 'fra', es: 'spa' }
      : provider === 'aliyun'
        ? { 'zh-CN': 'zh', 'zh-TW': 'zh-tw' }
        : provider === 'volcengine'
          ? { 'zh-CN': 'zh', 'zh-TW': 'zh-Hant' }
          : {};
  return map[language] || language;
}
export async function buildBasicRequest(
  provider,
  config,
  text,
  source,
  target,
  style = '学术论文',
  { date = new Date(), nonce = crypto.randomUUID() } = {},
) {
  const from = basicLanguage(provider, source),
    to = basicLanguage(provider, target);
  if (provider === 'mymemory')
    return {
      url: `https://api.mymemory.translated.net/get?${new URLSearchParams({ q: text, langpair: `${from}|${to}` })}`,
    };
  if (provider === 'google')
    return {
      url: `https://translate.googleapis.com/translate_a/single?${new URLSearchParams({ client: 'gtx', dt: 't', sl: from, tl: to, q: text })}`,
    };
  if (!BASIC_APIS.some((p) => p.id === provider)) throw new Error('未知的基础翻译服务');
  if (!basicConfigured(config)) throw new Error('请先在“基础翻译功能”中填写并保存账号和密钥');
  if (provider === 'baidu') {
    const academic = style === '学术论文';
    if (academic && (!['en', 'zh', 'auto'].includes(from) || !['en', 'zh'].includes(to)))
      throw new Error('百度学术论文领域仅支持简体中文与英文互译；请调整语言或选择其他翻译风格。');
    const params = { q: text, from, to, appid: config.keyId, salt: nonce };
    if (academic) params.domain = 'academic';
    const { md5 } = await import('@noble/hashes/legacy.js');
    params.sign = hex(
      md5(encoder.encode(config.keyId + text + nonce + (params.domain || '') + config.secret)),
    );
    return {
      url: `https://fanyi-api.baidu.com/api/trans/vip/${academic ? 'fieldtranslate' : 'translate'}?${new URLSearchParams(params)}`,
      jsonp: true,
    };
  }
  if (provider === 'aliyun') {
    const params = {
      Action: 'TranslateGeneral',
      Version: '2018-10-12',
      Format: 'JSON',
      AccessKeyId: config.keyId,
      SignatureMethod: 'HMAC-SHA1',
      SignatureVersion: '1.0',
      SignatureNonce: nonce,
      Timestamp: date.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      FormatType: 'text',
      SourceLanguage: from,
      TargetLanguage: to,
      SourceText: text,
      Scene: 'general',
    };
    params.Signature = btoa(
      String.fromCharCode(...(await hmac(config.secret + '&', 'POST&%2F&' + encode(query(params)), 'SHA-1'))),
    );
    return {
      url: 'https://mt.cn-hangzhou.aliyuncs.com/',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(params).toString(),
    };
  }
  const host = 'translate.volcengineapi.com',
    region = 'cn-north-1',
    service = 'translate';
  const body = JSON.stringify({
    ...(from === 'auto' ? {} : { SourceLanguage: from }),
    TargetLanguage: to,
    TextList: [text],
  });
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, ''),
    day = timestamp.slice(0, 8);
  const bodyHash = await digest(body),
    pathQuery = 'Action=TranslateText&Version=2020-06-01';
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-content-sha256:${bodyHash}\nx-date:${timestamp}\n`;
  const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  const canonical = ['POST', '/', pathQuery, canonicalHeaders, signedHeaders, bodyHash].join('\n');
  const scope = `${day}/${region}/${service}/request`;
  let key = await hmac(config.secret, day);
  for (const part of [region, service, 'request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, `HMAC-SHA256\n${timestamp}\n${scope}\n${await digest(canonical)}`));
  return {
    url: `https://${host}/?${pathQuery}`,
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Date': timestamp,
      'X-Content-Sha256': bodyHash,
      Authorization: `HMAC-SHA256 Credential=${config.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

export function baiduJsonp(url, signal) {
  // Only Baidu's fixed official API may execute the JSONP response.
  const target = new URL(url);
  if (
    target.origin !== 'https://fanyi-api.baidu.com' ||
    !['/api/trans/vip/translate', '/api/trans/vip/fieldtranslate'].includes(target.pathname)
  )
    return Promise.reject(new Error('无效的百度翻译接口'));
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const callback = `paperBridgeTranslate_${crypto.randomUUID().replaceAll('-', '')}`;
    const script = document.createElement('script');
    const cleanup = () => {
      script.remove();
      delete window[callback];
      signal?.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('无法连接百度翻译，请检查网络或站点的脚本加载限制。'));
    };
    target.searchParams.set('callback', callback);
    script.src = target.href;
    script.referrerPolicy = 'no-referrer';
    signal?.addEventListener('abort', abort, { once: true });
    document.head.append(script);
  });
}
export function parseBasicResponse(provider, json) {
  if (!json || typeof json !== 'object') throw new Error('翻译服务返回了无效数据。');
  let parts;
  if (provider === 'mymemory') {
    if (Number(json.responseStatus) !== 200 || json.quotaFinished)
      throw new Error('MyMemory 每日额度已用完或请求失败，请更换基础翻译服务。');
    parts = [json.responseData?.translatedText];
  } else if (provider === 'google')
    parts = Array.isArray(json?.[0])
      ? json[0].filter((part) => Array.isArray(part) && part[0] != null).map((part) => part[0])
      : [];
  else if (provider === 'baidu') {
    if (json.error_code && String(json.error_code) !== '52000') {
      const messages = {
        52003: '未授权，请核对 APP ID 及服务开通状态',
        54001: '签名错误，请核对密钥',
        54003: '请求过于频繁，请稍后再试',
        54004: '账户额度或余额不足',
        58001: '不支持该语言方向',
        58002: '服务已关闭',
        58003: '当前 IP 受到服务限制',
        90107: '账号认证未通过或未生效',
      };
      throw new Error(
        `百度翻译 ${json.error_code}：${messages[json.error_code] || '请求失败，请查看官方错误码说明'}`,
      );
    }
    parts = json.trans_result?.map((item) => item.dst);
  } else if (provider === 'aliyun') {
    if (Number(json.Code) !== 200)
      throw new Error(
        `阿里云翻译请求失败（${String(json.Code || '未知错误').slice(0, 80)}），请核对密钥、服务权限与额度。`,
      );
    parts = [json.Data?.Translated];
  } else {
    if (json.ResponseMetadata?.Error)
      throw new Error(
        `火山翻译请求失败（${String(json.ResponseMetadata.Error.Code || '未知错误').slice(0, 80)}），请核对密钥、服务权限与额度。`,
      );
    parts = json.TranslationList?.map((item) => item.Translation);
  }
  if (!parts?.length || parts.some((part) => typeof part !== 'string') || !parts.join('').trim())
    throw new Error('翻译服务未返回有效译文，未将本次请求标记为成功。');
  return parts.join(provider === 'baidu' ? '\n' : '');
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}
let baiduQueue = Promise.resolve(),
  lastBaiduRequest = 0;
async function sendBasicRequest(provider, config, text, source, target, style, signal) {
  const send = async () => {
    signal?.throwIfAborted();
    if (provider === 'baidu') await wait(Math.max(0, 1050 - (Date.now() - lastBaiduRequest)), signal);
    signal?.throwIfAborted();
    const request = await buildBasicRequest(provider, config, text, source, target, style);
    const timeout = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]);
    let json;
    try {
      if (request.jsonp) {
        lastBaiduRequest = Date.now();
        json = await baiduJsonp(request.url, timeout);
      } else {
        const { url, ...options } = request;
        const response = await fetch(url, {
          ...options,
          signal: timeout,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (!response.ok) {
          const error = await response.json().catch(() => null);
          if (
            (provider === 'aliyun' && error?.Code) ||
            (provider === 'volcengine' && error?.ResponseMetadata?.Error)
          )
            parseBasicResponse(provider, error);
          throw new Error(`翻译请求失败（HTTP ${response.status}），请检查密钥、服务权限与额度。`);
        }
        json = await response.json();
      }
    } catch (error) {
      if (timeout.aborted) throw timeout.reason;
      if (error instanceof TypeError)
        throw new Error(
          provider === 'google'
            ? 'Google 翻译无法连接（仅海外可访问），请检查网络或切换其他基础翻译服务。'
            : '翻译接口无法连接，请检查网络及服务商的浏览器跨域支持。',
        );
      throw error;
    }
    return parseBasicResponse(provider, json);
  };
  if (provider !== 'baidu') return send();
  const pending = baiduQueue.catch(() => {}).then(send);
  baiduQueue = pending;
  return pending;
}
export async function basicTranslate(
  text,
  {
    provider = 'mymemory',
    config,
    source = 'en',
    target = 'zh-CN',
    style = '学术论文',
    signal,
    onProgress,
  } = {},
) {
  const cleaned = cleanPdfText(text);
  if (!cleaned || source === target) return cleaned;
  if (isOfflineModel(provider)) {
    const { offlineTranslate } = await import('./offline-translation.js');
    return offlineTranslate(cleaned, { provider, source, target, signal, onProgress });
  }
  // GET/JSONP also need room for percent-encoding within common URL length limits.
  const limits = { mymemory: 450, google: 1500, baidu: 1500, aliyun: 4500, volcengine: 4500 };
  const result = [];
  for (const chunk of splitForTranslation(cleaned, limits[provider] || 450)) {
    signal?.throwIfAborted();
    result.push(await sendBasicRequest(provider, config, chunk, source, target, style, signal));
  }
  return result.join('');
}
