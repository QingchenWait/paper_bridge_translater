// Normalize optional dictionaries and Chinese details into the existing word-result model.
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
export const hasChinese = (value) => typeof value === 'string' && /\p{Script=Han}/u.test(value);
export const hasDictionaryDetails = (result) =>
  list(result?.entries).some((entry) =>
    list(entry?.meanings).some(
      (meaning) =>
        text(meaning?.partOfSpeech) &&
        list(meaning?.definitions).some((definition) => text(definition?.definition)),
    ),
  );
export const nativeDictionaryAvailable = (host = globalThis) =>
  Boolean(
    host.__TAURI__ ||
    host.__TAURI_INTERNALS__ ||
    typeof host.__PAPER_BRIDGE_DICTIONARY_FETCH__ === 'function',
  );
const partsOfSpeech = {
  noun: '名词',
  n: '名词',
  verb: '动词',
  v: '动词',
  vt: '及物动词',
  vi: '不及物动词',
  adjective: '形容词',
  adj: '形容词',
  adverb: '副词',
  adv: '副词',
  pronoun: '代词',
  pron: '代词',
  preposition: '介词',
  prep: '介词',
  conjunction: '连词',
  conj: '连词',
  interjection: '感叹词',
  interj: '感叹词',
  int: '感叹词',
  article: '冠词',
  art: '冠词',
  determiner: '限定词',
  det: '限定词',
  numeral: '数词',
  num: '数词',
  auxiliary: '助动词',
  aux: '助动词',
  'proper noun': '专有名词',
  abbreviation: '缩写',
  abbr: '缩写',
  phrase: '短语',
  phr: '短语',
  particle: '小品词',
  prefix: '前缀',
  suffix: '后缀',
};
export function needsChineseTranslation(value) {
  return (
    /[a-z]/i.test(value) &&
    (!hasChinese(value) ||
      (value.match(/[a-z]+/gi) || []).length > (value.match(/\p{Script=Han}/gu) || []).length)
  );
}
export async function chineseDictionaryEntries(entries, translate) {
  const result = structuredClone(entries);
  for (const entry of result) {
    entry.meanings = list(entry.meanings).filter(
      (meaning) => text(meaning?.partOfSpeech) && list(meaning.definitions).some((d) => text(d?.definition)),
    );
    for (const meaning of entry.meanings) {
      const parts = text(meaning.partOfSpeech)
        .toLowerCase()
        .replace(/\.$/, '')
        .split(/\.?\s*[&/、;,]\s*|\.\s+/);
      const label = parts.map((part) => partsOfSpeech[part.trim()] || part.trim()).join(' / ');
      meaning.partOfSpeech = needsChineseTranslation(label) ? await translate(label) : label;
      meaning.definitions = meaning.definitions.filter((d) => text(d?.definition));
      for (const definition of meaning.definitions)
        if (needsChineseTranslation(definition.definition))
          definition.definition = await translate(definition.definition);
    }
  }
  return result;
}
export function youdaoDictionaryResult(json, word) {
  if (json?.result?.code !== 200) throw new Error('有道词典暂无词条');
  const entry = list(json.data?.entries).find(
    (item) => text(item?.entry).toLowerCase() === word.toLowerCase(),
  );
  if (!entry) throw new Error('有道词典未返回匹配单词');
  const explain = text(entry.explain);
  const marks = [
    ...explain.matchAll(
      /(?:^|[\s;；])((?:(?:vt|vi|adj|adv|prep|pron|conj|interj|int|num|art|aux|abbr|phr|n|v)\.\s*(?:[&/、]\s*)?)+)/gi,
    ),
  ];
  const meanings = marks
    .map((match, index) => ({
      partOfSpeech: match[1].trim(),
      definitions: [
        {
          definition: explain
            .slice(match.index + match[0].length, marks[index + 1]?.index)
            .replace(/^[\s;；]+|[\s;；]+$/g, ''),
        },
      ],
      synonyms: [],
    }))
    .filter((meaning) => meaning.definitions[0].definition);
  return {
    source: '有道词典',
    chinese: hasChinese(explain) ? explain : '',
    forms: [],
    entries: [{ word: entry.entry, phonetics: [], meanings }],
    credit: {
      name: '有道词典',
      url: 'https://dict.youdao.com/',
      sourceUrl: `https://dict.youdao.com/result?word=${encodeURIComponent(word)}&lang=en`,
    },
  };
}
function sensesOf(senses) {
  return list(senses)
    .flatMap((sense) => [sense, ...sensesOf(sense?.subsenses)])
    .filter(Boolean);
}
export function freeDictionaryResult(json, word) {
  const entries = list(json?.entries).filter((entry) => entry?.language?.code === 'en');
  if (!entries.length) throw new Error('FreeDictionaryAPI 暂无词条');
  const senses = entries.flatMap((entry) => sensesOf(entry.senses));
  const chinese = unique(
    senses.flatMap((sense) =>
      list(sense.translations)
        .filter((translation) => /^(zh|zho|cmn)(?:[-_]|$)/i.test(translation?.language?.code || ''))
        .map((translation) => translation.word)
        .filter(hasChinese),
    ),
  ).join('；');
  const license = {
    name: text(json.source?.license?.name),
    url: text(json.source?.license?.url),
  };
  return {
    source: 'FreeDictionaryAPI.com',
    chinese,
    forms: unique(
      entries.flatMap((entry) =>
        list(entry.forms)
          .filter((form) => text(form?.word))
          .map((form) => [unique(list(form.tags)).join(' / '), text(form.word)].filter(Boolean).join('：')),
      ),
    ),
    entries: [
      {
        word: text(json.word) || word,
        phonetics: unique(entries.flatMap((entry) => list(entry.pronunciations).map((p) => p?.text))).map(
          (value) => ({ text: value, audio: '' }),
        ),
        meanings: entries
          .map((entry) => {
            const senses = sensesOf(entry.senses);
            return {
              partOfSpeech: text(entry.partOfSpeech),
              definitions: senses
                .filter((sense) => text(sense.definition))
                .map((sense) => ({
                  definition: text(sense.definition),
                  example: unique(list(sense.examples)).join('\n'),
                })),
              synonyms: unique([...list(entry.synonyms), ...senses.flatMap((sense) => list(sense.synonyms))]),
            };
          })
          .filter((meaning) => meaning.definitions.length),
        license,
      },
    ],
    credit: {
      name: 'FreeDictionaryAPI.com',
      url: 'https://freedictionaryapi.com/',
      sourceUrl: text(json.source?.url) || `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
      license,
    },
  };
}
export function dictionary3325Result(json, word) {
  if (json?.code !== 200 || !json.data) throw new Error('3325 词典暂无词条');
  const data = json.data,
    definition = text(data.jbjs);
  return {
    source: '3325 词典',
    chinese: hasChinese(definition) ? definition : '',
    forms: [],
    entries: [
      {
        word: text(data.word) || word,
        phonetics: unique([data.british, data.american]).map((value) => ({ text: value, audio: '' })),
        meanings: definition
          ? [
              {
                partOfSpeech: text(data.cx),
                definitions: [{ definition }],
                synonyms: [],
              },
            ]
          : [],
      },
    ],
    credit: {
      name: '3325 词典',
      url: 'https://3325.cn/api-docs',
      sourceUrl: text(data.url) || `https://3325.cn/dict/${encodeURIComponent(word)}`,
    },
  };
}
