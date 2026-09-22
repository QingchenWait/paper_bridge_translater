import { cleanPdfText, splitForTranslation } from './text.js';
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
export async function onlineTranslate(text, source = 'en', target = 'zh-CN', signal) {
  if (source === target) return cleanPdfText(text);
  const output = [];
  for (const chunk of splitForTranslation(cleanPdfText(text))) {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.search = new URLSearchParams({ q: chunk, langpair: `${source}|${target}` });
    const response = await fetch(url, {
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(18000)]),
    });
    if (!response.ok) throw new Error(`在线翻译服务暂不可用 (${response.status})`);
    const json = await response.json();
    if (Number(json.responseStatus) !== 200 || json.quotaFinished)
      throw new Error(json.responseDetails || '免费翻译额度已用完，请稍后重试或切换 LLM');
    output.push(json.responseData.translatedText);
  }
  return output.join('');
}
export async function lookupWord(word, signal) {
  const requestSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(18000)]);
  const response = await fetch(
    `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`,
    { signal: requestSignal },
  );
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? '词典未收录此单词，可检查拼写或选择完整句子。'
        : `词典服务不可用 (${response.status})`,
    );
  const entries = await response.json();
  const supplemental = await Promise.allSettled([
    onlineTranslate(word, 'en', 'zh-CN', signal),
    fetch(
      `https://en.wiktionary.org/w/api.php?${new URLSearchParams({ action: 'parse', page: word.toLowerCase(), prop: 'text', format: 'json', origin: '*' })}`,
      { signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]) },
    ).then(async (response) => {
      if (!response.ok) return [];
      const json = await response.json();
      const document = new DOMParser().parseFromString(json.parse?.text?.['*'] || '', 'text/html');
      return [...document.querySelectorAll('.headword-line')]
        .filter((line) => line.querySelector('[lang="en"]'))
        .map((line) => line.textContent.trim());
    }),
  ]);
  if (signal?.aborted) throw signal.reason;
  return {
    word,
    entries,
    chinese: supplemental[0].status === 'fulfilled' ? supplemental[0].value : '',
    forms: supplemental[1].status === 'fulfilled' ? supplemental[1].value : [],
  };
}
