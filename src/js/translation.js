import { basicTranslate } from './basic-translation.js';
import { hasChinese, freeDictionaryResult, dictionary3325Result } from './dictionary-fallbacks.js';
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
) {
  const provider = basic?.defaultProvider || 'mymemory';
  return basicTranslate(text, {
    provider,
    config: basic?.providers?.[provider],
    source,
    target,
    signal,
    style,
  });
}
const plainText = (html) => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.trim();
async function dictionaryJson(url, signal) {
  signal?.throwIfAborted();
  const response = await fetch(url, {
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
  };
  let primaryDictionary,
    wikiForms = [];
  const supplements = [];
  const hasDefinitions = (result) => result.entries.some((entry) => entry.meanings?.length);
  const updateDetails = () => {
    const detailed = primaryDictionary || supplements.find(hasDefinitions);
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
  // Independent dictionaries race; a blocked primary never holds up a healthy alternative.
  const definitions = Promise.any([
    dictionaryJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encoded}`, signal).then((entries) => {
      if (!Array.isArray(entries) || !entries[0]?.meanings?.length) throw new Error('词典暂无释义');
      return { entries, source: 'Free Dictionary API' };
    }),
    dictionaryJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encoded}`, signal).then(
      (json) => {
        if (!json.en?.length) throw new Error('词典暂无英文释义');
        return {
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
      },
    ),
  ]).then((result) => {
    primaryDictionary = result;
    updateDetails();
    publish();
  });
  const chinese = (async () => {
    try {
      const value = await onlineTranslate(word, 'en', 'zh-CN', signal, basic, '忠实直译');
      if (hasChinese(value)) {
        state.chinese = value;
        state.chineseSource = basic?.defaultProvider || 'mymemory';
        publish();
        return;
      }
    } catch {
      /* Missing Chinese definitions proceed to the ordered dictionaries. */
    }
    for (const [url, normalize] of [
      [`https://freedictionaryapi.com/api/v1/entries/en/${encoded}?translations=true`, freeDictionaryResult],
      [`https://3325.cn/api/word/${encoded}`, dictionary3325Result],
    ]) {
      signal?.throwIfAborted();
      try {
        const result = normalize(await dictionaryJson(url, signal), word);
        signal?.throwIfAborted();
        if (result.chinese || hasDefinitions(result) || result.forms.length) {
          supplements.push(result);
          state.credits.push(result.credit);
          updateDetails();
        }
        if (result.chinese) {
          state.chinese = result.chinese;
          state.chineseSource = result.source;
        }
        publish();
        if (state.chinese) return;
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
    if (!state.chinese) throw new Error('在线词典暂时无法连接或未收录此词，请稍后重试。');
    state.warning = '详细词典暂不可用，已显示在线获取的中文释义。';
  }
  return state;
}
