import test from 'node:test';
import assert from 'node:assert/strict';
import { hasChinese, freeDictionaryResult, dictionary3325Result } from '../src/js/dictionary-fallbacks.js';

test('FreeDictionaryAPI maps recursive senses and Chinese translations without mixing other languages', () => {
  const result = freeDictionaryResult(
    {
      word: 'focus',
      entries: [
        {
          language: { code: 'en' },
          partOfSpeech: 'noun',
          pronunciations: [{ type: 'ipa', text: '/ˈfəʊkəs/' }],
          forms: [{ word: 'foci', tags: ['plural'] }],
          synonyms: ['centre'],
          senses: [
            {
              definition: 'A centre.',
              examples: ['A point of focus.'],
              synonyms: ['centre', 'hub'],
              translations: [
                { language: { code: 'cmn' }, word: '焦点' },
                { language: { code: 'ja' }, word: '焦点_日本語' },
                { language: { code: 'zh' }, word: 'jiāodiǎn' },
              ],
              subsenses: [
                {
                  definition: 'Concentration.',
                  translations: [
                    { language: { code: 'zh-Hans' }, word: '注意力' },
                    { language: { code: 'zho' }, word: '焦点' },
                  ],
                },
              ],
            },
          ],
        },
        { language: { code: 'fr' }, senses: [{ definition: 'Must not be used.' }] },
      ],
      source: {
        url: 'https://en.wiktionary.org/wiki/focus',
        license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
      },
    },
    'focus',
  );
  assert.equal(result.chinese, '焦点；注意力');
  assert.deepEqual(result.forms, ['plural：foci']);
  assert.equal(result.entries[0].phonetics[0].text, '/ˈfəʊkəs/');
  assert.equal(result.entries[0].phonetics[0].audio, '');
  assert.equal(result.entries[0].meanings[0].definitions.length, 2);
  assert.deepEqual(result.entries[0].meanings[0].synonyms, ['centre', 'hub']);
  assert.equal(result.credit.sourceUrl, 'https://en.wiktionary.org/wiki/focus');
  assert.equal(result.credit.license.name, 'CC BY-SA 4.0');
});
test('3325 maps official jbjs/cx and both phonetics without inventing audio or inflections', () => {
  const result = dictionary3325Result(
    {
      code: 200,
      data: {
        word: 'attention',
        british: '[əˈtenʃən]',
        american: '[əˈtɛnʃən]',
        cx: 'n',
        jbjs: 'n.注意,关心,关注,注意力',
        url: 'https://3325.cn/dict/attention',
      },
    },
    'attention',
  );
  assert.equal(result.chinese, 'n.注意,关心,关注,注意力');
  assert.equal(result.entries[0].meanings[0].partOfSpeech, 'n');
  assert.equal(result.entries[0].meanings[0].definitions[0].definition, result.chinese);
  assert.equal(result.entries[0].phonetics.length, 2);
  assert.ok(result.entries[0].phonetics.every((item) => item.audio === ''));
  assert.deepEqual(result.forms, []);
  assert.equal(result.credit.sourceUrl, 'https://3325.cn/dict/attention');
});
test('empty entries and unsuccessful 3325 envelopes cannot masquerade as usable Chinese definitions', () => {
  for (const response of [null, {}, { entries: [] }])
    assert.throws(() => freeDictionaryResult(response, 'word'), /暂无词条/);
  for (const response of [null, { code: 429, data: { jbjs: '限流' } }, { code: 200, data: null }])
    assert.throws(() => dictionary3325Result(response, 'word'), /暂无词条/);
  assert.equal(dictionary3325Result({ code: 200, data: { jbjs: 'unchanged' } }, 'word').chinese, '');
  assert.equal(freeDictionaryResult({ entries: [{ language: { code: 'en' } }] }, 'word').chinese, '');
});
test('Chinese availability excludes empty, unchanged English and romanized results', () => {
  for (const text of [undefined, null, '', 'attention', 'zhùyì', 'Quota exceeded'])
    assert.equal(hasChinese(text), false);
  for (const text of ['注意力', '專注', 'n. 关注；关心']) assert.equal(hasChinese(text), true);
});
