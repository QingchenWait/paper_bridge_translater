import { basicTranslate } from './basic-translation.js';
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
  const response = await fetch(url, {
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(6500)]),
  });
  if (!response.ok) throw new Error(`词典请求失败 (${response.status})`);
  return response.json();
}
export async function lookupWord(word, signal, onUpdate = () => {}, basic) {
  const state = {
    word,
    entries: [{ word, phonetics: [], meanings: [] }],
    chinese: '',
    forms: [],
    source: '',
    warning: '',
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
    Object.assign(state, result);
    publish();
  });
  state.chineseSource = basic?.defaultProvider || 'mymemory';
  const chinese = onlineTranslate(word, 'en', 'zh-CN', signal, basic, '忠实直译').then((value) => {
    state.chinese = value;
    publish();
  });
  const forms = dictionaryJson(
    `https://en.wiktionary.org/w/api.php?${new URLSearchParams({ action: 'parse', page: word.toLowerCase(), prop: 'text', format: 'json', origin: '*' })}`,
    signal,
  ).then((json) => {
    const parsed = new DOMParser().parseFromString(json.parse?.text?.['*'] || '', 'text/html');
    state.forms = [...parsed.querySelectorAll('.headword-line')]
      .filter((line) => line.querySelector('[lang="en"]'))
      .map((line) => line.textContent.trim());
    publish();
  });
  const results = await Promise.allSettled([definitions, chinese, forms]);
  if (signal?.aborted) throw signal.reason;
  if (results[0].status === 'rejected') {
    if (!state.chinese) throw new Error('在线词典暂时无法连接或未收录此词，请稍后重试。');
    state.warning = '详细词典暂不可用，已显示在线获取的中文释义。';
  }
  return state;
}
