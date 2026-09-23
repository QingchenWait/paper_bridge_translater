// Normalize the two optional dictionaries into the existing word-result model.
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const list = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => [...new Set(values.map(text).filter(Boolean))];
export const hasChinese = (value) => typeof value === 'string' && /\p{Script=Han}/u.test(value);
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
