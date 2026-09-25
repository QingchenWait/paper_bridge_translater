import { basicTranslate, basicOptions } from './basic-translation.js';
import { isOfflineModel } from './offline/catalog.js';
import {
  hasChinese,
  hasDictionaryDetails,
  needsChineseTranslation,
  chineseDictionaryEntries,
  nativeDictionaryAvailable,
  youdaoDictionaryResult,
  freeDictionaryResult,
  dictionary3325Result,
} from './dictionary-fallbacks.js';
export const LANGUAGES = [
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
];
export async function onlineTranslate(
  text,
  source = 'en',
  target = 'zh-CN',
  signal,
  basic,
  style = '学术论文',
  onProgress,
) {
  const provider = basic?.defaultProvider || 'mymemory';
  return basicTranslate(text, {
    provider,
    config: basic?.providers?.[provider],
    source,
    target,
    signal,
    style,
    onProgress,
  });
}
const plainText = (html) => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.trim();
async function dictionaryJson(url, signal, request = fetch) {
  signal?.throwIfAborted();
  const response = await request(url, {
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6500)]),
  });
  if (!response.ok) throw new Error(`词典请求失败 (${response.status})`);
  return response.json();
}
export async function lookupWord(word, signal, onUpdate = () => {}, basic) {
  signal?.throwIfAborted();
  const state = {
    word,
    entries: [{ word, phonetics: [], meanings: [] }],
    chinese: '',
    forms: [],
    source: '',
    warning: '',
    credits: [],
    definitionSources: [],
  };
  let primaryDictionary,
    wikiForms = [];
  const supplements = [];
  const hasDefinitions = hasDictionaryDetails;
  const translationCache = new Map(),
    failedProviders = new Set();
  const providers = [
    ...new Set([basic?.defaultProvider || 'mymemory', ...basicOptions(basic).map(([id]) => id)]),
  ].filter((id) => !isOfflineModel(id) && (id !== 'volcengine' || nativeDictionaryAvailable()));
  let detailTranslationFailed = false;
  const translateDetail = (value) => {
    if (!translationCache.has(value))
      translationCache.set(
        value,
        (async () => {
          for (const provider of providers) {
            signal?.throwIfAborted();
            if (failedProviders.has(provider)) continue;
            try {
              const translated = await basicTranslate(value, {
                provider,
                config: basic?.providers?.[provider],
                source: 'en',
                target: 'zh-CN',
                style: '忠实直译',
                signal,
              });
              signal?.throwIfAborted();
              if (!hasChinese(translated) || needsChineseTranslation(translated))
                throw new Error('未返回中文释义');
              if (!state.definitionSources.includes(provider)) state.definitionSources.push(provider);
              return translated;
            } catch (error) {
              signal?.throwIfAborted();
              failedProviders.add(provider);
            }
          }
          throw new Error('英文详细释义暂未能翻译成中文，请稍后重试或切换基础翻译服务。');
        })(),
      );
    return translationCache.get(value);
  };
  const prepareDetails = async (result) => {
    try {
      return { ...result, entries: await chineseDictionaryEntries(result.entries, translateDetail) };
    } catch (error) {
      signal?.throwIfAborted();
      detailTranslationFailed = true;
      return { ...result, entries: result.entries.map((entry) => ({ ...entry, meanings: [] })) };
    }
  };
  const updateDetails = () => {
    const detailed = primaryDictionary || supplements.find(hasDefinitions) || supplements[0];
    if (detailed) {
      const phonetics = supplements.flatMap((result) => result.entries.flatMap((entry) => entry.phonetics));
      state.entries = detailed.entries.map((entry) => ({
        ...entry,
        phonetics: entry.phonetics?.length ? entry.phonetics : phonetics,
      }));
      state.source = detailed.source;
    }
    state.forms = [...new Set([...wikiForms, ...supplements.flatMap((result) => result.forms)])];
  };
  const publish = () => {
    if (!signal?.aborted) onUpdate({ ...state });
  };
  const encoded = encodeURIComponent(word.toLowerCase());
  const addSupplement = async (result) => {
    // Publish available Chinese/phonetics while English definitions are being translated.
    const supplement = { ...result, entries: result.entries.map((entry) => ({ ...entry, meanings: [] })) };
    supplements.push(supplement);
    state.credits.push(result.credit);
    if (result.chinese && !state.chinese) {
      state.chinese = result.chinese;
      state.chineseSource = result.source;
    }
    updateDetails();
    publish();
    Object.assign(supplement, await prepareDetails(result));
    updateDetails();
    publish();
  };
  if (nativeDictionaryAvailable()) {
    try {
      const request = globalThis.__PAPER_BRIDGE_DICTIONARY_FETCH__ || fetch;
      const result = youdaoDictionaryResult(
        await dictionaryJson(
          `https://dict.youdao.com/suggest?${new URLSearchParams({ q: word, num: '1', doctype: 'json' })}`,
          signal,
          request,
        ),
        word,
      );
      await addSupplement(result);
      if (hasDefinitions(state)) return state;
    } catch {
      signal?.throwIfAborted();
    }
  }
  // Independent dictionaries race; a blocked primary never holds up a healthy alternative.
  const primaryRequests = [
    dictionaryJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}`, signal).then((entries) => {
      if (!hasDefinitions({ entries })) throw new Error('词典暂无详细释义');
      return { entries, source: 'Free Dictionary API' };
    }),
    dictionaryJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encoded}`, signal).then(
      (json) => {
        if (!json.en?.length) throw new Error('词典暂无英文释义');
        const result = {
          source: 'Wiktionary',
          entries: [
            {
              word,
              phonetics: [],
              license: { name: 'CC BY-SA' },
              meanings: json.en.map((item) => ({
                partOfSpeech: item.partOfSpeech,
                definitions: item.definitions.map((d) => ({
                  definition: plainText(d.definition),
                  example: plainText(d.examples?.[0] || d.parsedExamples?.[0]?.example),
                })),
                synonyms: [],
              })),
            },
          ],
        };
        if (!hasDefinitions(result)) throw new Error('词典暂无详细释义');
        return result;
      },
    ),
  ];
  const definitions = (async () => {
    const pending = new Set(
      primaryRequests.map((request) =>
        request.then(
          (result) => ({ result }),
          () => ({}),
        ),
      ),
    );
    while (pending.size) {
      const { request, result } = await Promise.race(
        [...pending].map((request) => request.then((result) => ({ request, ...result }))),
      );
      pending.delete(request);
      signal?.throwIfAborted();
      if (!result) continue;
      const ready = await prepareDetails(result);
      if (!hasDefinitions(ready)) continue;
      primaryDictionary = ready;
      updateDetails();
      publish();
      return;
    }
    throw new Error('词典详细释义暂不可用');
  })();
  const chinese = (async () => {
    try {
      const value = state.chinese || (await onlineTranslate(word, 'en', 'zh-CN', signal, basic, '忠实直译'));
      if (hasChinese(value)) {
        state.chinese = value;
        state.chineseSource ||= basic?.defaultProvider || 'mymemory';
        publish();
      }
    } catch {
      /* Missing Chinese definitions proceed to the ordered dictionaries. */
    }
    await definitions.catch(() => {});
    if (state.chinese && hasDefinitions(state)) return;
    for (const [url, normalize] of [
      [`https://freedictionaryapi.com/api/v1/entries/en/${encoded}?translations=true`, freeDictionaryResult],
      [`https://3325.cn/api/word/${encoded}`, dictionary3325Result],
    ]) {
      signal?.throwIfAborted();
      try {
        const result = normalize(await dictionaryJson(url, signal), word);
        signal?.throwIfAborted();
        await addSupplement(result);
        if (state.chinese && hasDefinitions(state)) return;
      } catch {
        /* Unavailable, empty or rate-limited dictionaries allow the next fallback. */
      }
    }
  })();
  const forms = dictionaryJson(
    `https://en.wiktionary.org/w/api.php?${new URLSearchParams({ action: 'parse', page: word.toLowerCase(), prop: 'text', format: 'json', origin: '*' })}`,
    signal,
  ).then((json) => {
    const parsed = new DOMParser().parseFromString(json.parse?.text?.['*'] || '', 'text/html');
    wikiForms = [...parsed.querySelectorAll('.headword-line')]
      .filter((line) => line.querySelector('[lang="en"]'))
      .map((line) => line.textContent.trim());
    updateDetails();
    publish();
  });
  await Promise.allSettled([definitions, chinese, forms]);
  if (signal?.aborted) throw signal.reason;
  if (!hasDefinitions(state)) {
    state.warning = detailTranslationFailed
      ? '英文详细释义暂未能翻译成中文，请稍后重试或切换基础翻译服务。'
      : '详细词典暂不可用，已显示在线获取的中文释义。';
    if (!state.chinese)
      throw new Error(
        detailTranslationFailed ? state.warning : '在线词典暂时无法连接或未收录此词，请稍后重试。',
      );
  }
  return state;
}
