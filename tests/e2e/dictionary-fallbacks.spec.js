import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
const free = (chinese = true) => ({
  word: 'attention',
  entries: [
    {
      language: { code: 'en' },
      partOfSpeech: 'noun',
      pronunciations: [{ type: 'ipa', text: '/əˈtɛnʃən/' }],
      forms: [{ word: 'attentions', tags: ['plural'] }],
      synonyms: ['focus'],
      senses: [
        {
          definition: 'Mental focus.',
          examples: ['Pay attention.'],
          translations: chinese ? [{ language: { code: 'cmn' }, word: '注意力' }] : [],
        },
      ],
    },
  ],
  source: {
    url: 'https://en.wiktionary.org/wiki/attention',
    license: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  },
});
const second = {
  code: 200,
  data: {
    word: 'attention',
    british: '[əˈtenʃən]',
    american: '[əˈtɛnʃən]',
    cx: 'n',
    jbjs: 'n.注意,关心,注意力',
    url: 'https://3325.cn/dict/attention',
  },
};
const primary = [
  {
    word: 'attention',
    phonetics: [],
    meanings: [
      {
        partOfSpeech: 'noun',
        definitions: [{ definition: 'Primary English definition.' }],
        synonyms: [],
      },
    ],
  },
];
async function setup(page, translate = true) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: '不再显示', exact: true }).check();
  await page.getByRole('button', { name: '直接进入 APP', exact: true }).click();
  const calls = [];
  await page.route(/^https:\/\//, (route) => {
    calls.push(route.request().url());
    return route.fulfill({ status: 503, json: {} });
  });
  await page.route('https://en.wiktionary.org/**', (route) =>
    route.fulfill({ json: { parse: { text: { '*': '' } } } }),
  );
  if (translate)
    await page.route('https://translate.googleapis.com/**', (route) => {
      calls.push(route.request().url());
      const value = new URL(route.request().url()).searchParams.get('q');
      const translated =
        { 'Mental focus.': '精神集中。', 'Primary English definition.': '主要词典的中文解释。' }[value] ||
        '其他中文解释。';
      return route.fulfill({ json: [[[translated, value]]] });
    });
  return calls;
}
async function selectWord(page) {
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('attention', { x: 50, y: 650, size: 18 });
  await page
    .locator('#pdf-input')
    .setInputFiles({ name: 'Word.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.locator('.textLayer span').first().waitFor();
  await page.evaluate(() => {
    document.activeElement?.blur();
    const span = document.querySelector('.textLayer span');
    span.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0 }));
    const range = document.createRange();
    range.selectNodeContents(span);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document
      .getElementById('pdf-scroll')
      .dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
  });
}
const lookup = (page) =>
  page.evaluate(async () => (await import('/src/js/translation.js')).lookupWord('attention'));
test('existing Chinese results keep priority and do not request either fallback', async ({ page }) => {
  const calls = await setup(page);
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.fulfill({ json: primary }));
  await page.route('https://api.mymemory.translated.net/**', (route) =>
    route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '原有中文释义' } } }),
  );
  const result = await lookup(page);
  expect(result.chinese).toBe('原有中文释义');
  expect(result.source).toBe('Free Dictionary API');
  expect(result.credits).toEqual([]);
  expect(calls.filter((url) => /freedictionaryapi.com|3325.cn/.test(url))).toEqual([]);
});
test('FreeDictionaryAPI supplies Chinese and complete dictionary fields without an LLM or second fallback', async ({
  page,
}) => {
  const calls = await setup(page);
  await page.route('https://freedictionaryapi.com/**', (route) => {
    calls.push(route.request().url());
    return route.fulfill({ json: free() });
  });
  await selectWord(page);
  await expect(page.locator('.chinese-meaning')).toHaveText('注意力');
  await expect(page.locator('.dictionary-heading')).toContainText('/əˈtɛnʃən/');
  await expect(page.locator('.word-meaning')).toContainText('精神集中。');
  await expect(page.locator('#selection-result')).toContainText('plural：attentions');
  await expect(page.locator('#selection-result')).toContainText('focus');
  await expect(page.locator('.dictionary-credit')).toContainText('FreeDictionaryAPI.com');
  await expect(page.getByRole('link', { name: '词条来源', exact: true })).toHaveAttribute(
    'href',
    'https://en.wiktionary.org/wiki/attention',
  );
  await expect(page.getByRole('link', { name: 'CC BY-SA 4.0', exact: true })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(page.locator('.inline-loading')).toHaveCount(0);
  expect(calls.filter((url) => /freedictionaryapi.com/.test(url))).toEqual([
    'https://freedictionaryapi.com/api/v1/entries/en/attention?translations=true',
  ]);
  expect(calls.some((url) => /3325.cn|chat\/completions|\/responses/.test(url))).toBe(false);
});
for (const missing of ['no-chinese', 'rate-limit'])
  test(`3325 is requested only after the first fallback has ${missing}`, async ({ page }) => {
    const calls = await setup(page);
    await page.route('https://api.mymemory.translated.net/**', (route) =>
      route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: 'attention' } } }),
    );
    await page.route('https://freedictionaryapi.com/**', async (route) => {
      calls.push('first');
      await route.fulfill(missing === 'no-chinese' ? { json: free(false) } : { status: 429, json: {} });
      calls.push('first-finished');
    });
    await page.route('https://3325.cn/**', (route) => {
      calls.push('second');
      return route.fulfill({ json: second });
    });
    await selectWord(page);
    await expect(page.locator('.chinese-meaning')).toContainText('n.注意,关心,注意力');
    await expect(page.locator('.dictionary-credit')).toContainText('3325 词典');
    await expect(page.locator('.inline-loading')).toHaveCount(0);
    expect(calls.indexOf('second')).toBeGreaterThan(calls.indexOf('first'));
    expect(calls.filter((value) => value === 'second')).toHaveLength(1);
    if (missing === 'no-chinese') {
      await expect(page.locator('.word-meaning')).toContainText('精神集中。');
      await expect(page.locator('#selection-result')).toContainText('plural：attentions');
    } else {
      await expect(page.locator('.dictionary-heading')).toContainText('[əˈtenʃən]');
      await expect(page.locator('.part-of-speech')).toHaveText('名词');
      await expect(page.locator('.dictionary-credit a').filter({ hasText: '词条来源' })).toHaveAttribute(
        'href',
        'https://3325.cn/dict/attention',
      );
    }
  });
test('late empty Wiktionary forms do not erase translated definitions or supplementary phonetics and forms', async ({
  page,
}) => {
  await setup(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://en.wiktionary.org/w/api.php*', async (route) => {
    await held;
    await route.fulfill({ json: { parse: { text: { '*': '' } } } });
  });
  await page.route('https://freedictionaryapi.com/**', (route) => route.fulfill({ json: free() }));
  await selectWord(page);
  await expect(page.locator('.chinese-meaning')).toHaveText('注意力');
  release();
  await expect(page.locator('.word-meaning')).toContainText('精神集中。');
  await expect(page.locator('.inline-loading')).toHaveCount(0);
  await expect(page.locator('.dictionary-heading')).toContainText('/əˈtɛnʃən/');
  await expect(page.locator('#selection-result')).toContainText('plural：attentions');
  await expect(page.locator('.chinese-meaning')).toHaveText('注意力');
});
test('aborting a lookup stops the ordered chain and suppresses later updates', async ({ page }) => {
  const calls = await setup(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://freedictionaryapi.com/**', async (route) => {
    calls.push('first');
    await held;
    await route.fulfill({ json: free() }).catch(() => {});
  });
  await page.evaluate(async () => {
    const { lookupWord } = await import('/src/js/translation.js');
    window.dictionaryController = new AbortController();
    window.dictionaryUpdates = [];
    window.dictionaryTask = lookupWord('attention', window.dictionaryController.signal, (result) =>
      window.dictionaryUpdates.push(structuredClone(result)),
    ).then(
      () => 'success',
      (error) => error.name,
    );
  });
  await expect.poll(() => calls.includes('first')).toBe(true);
  const result = await page.evaluate(async () => {
    const count = window.dictionaryUpdates.length;
    window.dictionaryController.abort();
    return { name: await window.dictionaryTask, before: count, after: window.dictionaryUpdates.length };
  });
  release();
  expect(result.name).toBe('AbortError');
  expect(result.after).toBe(result.before);
  expect(calls.some((url) => /3325.cn/.test(url))).toBe(false);
});
test('failed translation and dictionary requests exhaust alternatives without publishing English definitions', async ({
  page,
}) => {
  const calls = await setup(page, false);
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.fulfill({ json: primary }));
  const result = await page.evaluate(async () => {
    const updates = [];
    try {
      await (
        await import('/src/js/translation.js')
      ).lookupWord('attention', undefined, (value) => updates.push(structuredClone(value)));
    } catch (error) {
      return { error: error.message, updates };
    }
  });
  expect(result.error).toContain('英文详细释义暂未能翻译成中文');
  expect(JSON.stringify(result.updates)).not.toContain('Primary English definition.');
  expect(calls.filter((url) => /freedictionaryapi.com|3325.cn/.test(url))).toHaveLength(2);
  expect(calls.some((url) => url.includes('dict.youdao.com'))).toBe(false);
});

for (const mobile of [false, true])
  test(`a short Chinese gloss and empty details continue through every dictionary on ${mobile ? 'mobile' : 'desktop'}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const calls = await setup(page);
    await page.route('https://api.mymemory.translated.net/**', (route) =>
      route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: '简短词义' } } }),
    );
    await page.route('https://api.dictionaryapi.dev/**', (route) =>
      route.fulfill({
        json: [
          { word: 'attention', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: ' ' }] }] },
        ],
      }),
    );
    await page.route('https://freedictionaryapi.com/**', (route) => {
      calls.push('first');
      const result = free();
      result.entries[0].senses[0].definition = '';
      return route.fulfill({ json: result });
    });
    await page.route('https://3325.cn/**', (route) => {
      calls.push('second');
      return route.fulfill({ json: second });
    });
    await selectWord(page);
    if (mobile) await page.locator('.mobile-nav [data-mobile-pane="assistant"]').click();
    await expect(page.locator('.word-meaning')).toContainText('n.注意,关心,注意力');
    await expect(page.locator('.part-of-speech')).toHaveText('名词');
    await expect(page.locator('.chinese-meaning')).toHaveText('简短词义');
    await expect(page.locator('.inline-loading')).toHaveCount(0);
    expect(calls.filter((value) => ['first', 'second'].includes(value))).toEqual(['first', 'second']);
    expect(calls.some((url) => url.includes('dict.youdao.com'))).toBe(false);
    await page.screenshot({
      path: `test-results/dictionary-details-${mobile ? 'mobile' : 'desktop'}.png`,
      animations: 'disabled',
    });
  });
test('native host queries Youdao first and displays regex-separated Chinese senses without other requests', async ({
  page,
}) => {
  const calls = await setup(page);
  await page.evaluate(() => {
    window.nativeDictionaryCalls = [];
    window.__PAPER_BRIDGE_DICTIONARY_FETCH__ = async (url, options) => {
      options.signal.throwIfAborted();
      window.nativeDictionaryCalls.push(url);
      return new Response(
        JSON.stringify({
          result: { code: 200 },
          data: { entries: [{ entry: 'attention', explain: 'n. 注意力；关注；v. 注意；留意' }] },
        }),
        { status: 200 },
      );
    };
  });
  await selectWord(page);
  await expect(page.locator('.part-of-speech')).toHaveText(['名词', '动词']);
  await expect(page.locator('.word-meaning').first()).toContainText('注意力；关注');
  await expect(page.locator('.word-meaning').last()).toContainText('注意；留意');
  await expect(page.locator('.inline-loading')).toHaveCount(0);
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => window.nativeDictionaryCalls)).toEqual([
    'https://dict.youdao.com/suggest?q=attention&num=1&doctype=json',
  ]);
});
test('unavailable native Youdao falls back normally and basic settings identify its web limitation', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = {};
  });
  const requested = [];
  await page.route('https://dict.youdao.com/**', (route) => {
    requested.push('youdao');
    return route.fulfill({ status: 403, body: 'Invalid CORS request' });
  });
  await page.route('https://3325.cn/**', (route) => {
    requested.push('3325');
    return route.fulfill({ json: second });
  });
  const result = await lookup(page);
  expect(requested).toEqual(['youdao', '3325']);
  expect(result.entries[0].meanings[0].partOfSpeech).toBe('名词');
  await page.locator('.sidebar [data-action="settings"]').click();
  await page.locator('[data-action="settings-basic"]').click();
  await expect(page.locator('.youdao-dictionary-note')).toContainText('网页版不支持');
});
test('English explanations wait for Chinese translation before entering the visible dictionary', async ({
  page,
}) => {
  await setup(page);
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.fulfill({ json: primary }));
  let release,
    requested = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://api.mymemory.translated.net/**', async (route) => {
    const word = new URL(route.request().url()).searchParams.get('q') === 'attention';
    if (!word) {
      requested = true;
      await held;
    }
    return route.fulfill({
      json: {
        responseStatus: 200,
        responseData: { translatedText: word ? '注意力' : '主要词典的中文解释。' },
      },
    });
  });
  await selectWord(page);
  await expect.poll(() => requested).toBe(true);
  await expect(page.locator('.word-meaning')).toHaveCount(0);
  await expect(page.locator('#selection-result')).not.toContainText('Primary English definition.');
  release();
  await expect(page.locator('.word-meaning')).toContainText('主要词典的中文解释。');
  await expect(page.locator('.part-of-speech')).toHaveText('名词');
  await expect(page.locator('.dictionary-credit')).toContainText('释义翻译：MyMemory');
});
test('a failed selected translation API tries other available APIs and deduplicates repeated senses', async ({
  page,
}) => {
  const calls = await setup(page);
  const entries = structuredClone(primary);
  entries[0].meanings.push({ ...entries[0].meanings[0], partOfSpeech: 'verb' });
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.fulfill({ json: entries }));
  await page.route('https://3325.cn/**', (route) => route.fulfill({ json: second }));
  const result = await page.evaluate(async () =>
    (await import('/src/js/translation.js')).lookupWord('attention', undefined, undefined, {
      defaultProvider: 'aliyun',
      providers: { aliyun: { keyId: 'fake', secret: 'fake' } },
    }),
  );
  expect(result.entries[0].meanings.map((m) => m.partOfSpeech)).toEqual(['名词', '动词']);
  expect(
    result.entries[0].meanings.every((m) => m.definitions[0].definition === '主要词典的中文解释。'),
  ).toBe(true);
  expect(calls.filter((url) => url.includes('translate.googleapis.com'))).toHaveLength(1);
  expect(result.definitionSources).toEqual(['google']);
});
test('an empty first primary dictionary does not hide usable details from Wiktionary', async ({ page }) => {
  const calls = await setup(page);
  await page.route('https://api.dictionaryapi.dev/**', (route) =>
    route.fulfill({ json: [{ word: 'attention', meanings: [{ partOfSpeech: 'noun', definitions: [] }] }] }),
  );
  await page.route('https://en.wiktionary.org/api/rest_v1/**', (route) =>
    route.fulfill({
      json: { en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'Mental focus.' }] }] },
    }),
  );
  await page.route('https://api.mymemory.translated.net/**', (route) => {
    const word = new URL(route.request().url()).searchParams.get('q') === 'attention';
    return route.fulfill(
      word
        ? { json: { responseStatus: 200, responseData: { translatedText: '注意力' } } }
        : { status: 503, json: {} },
    );
  });
  const result = await lookup(page);
  expect(result.source).toBe('Wiktionary');
  expect(result.entries[0].meanings[0].definitions[0].definition).toBe('精神集中。');
  expect(calls.some((url) => /freedictionaryapi.com|3325.cn|dict.youdao.com/.test(url))).toBe(false);
});

test('failed English conversion continues to a dictionary with native Chinese details', async ({ page }) => {
  const calls = await setup(page, false);
  await page.route('https://freedictionaryapi.com/**', (route) => route.fulfill({ json: free() }));
  await page.route('https://3325.cn/**', (route) => {
    calls.push('second');
    return route.fulfill({ json: second });
  });
  const result = await lookup(page);
  expect(calls).toContain('second');
  expect(result.chinese).toBe('注意力');
  expect(result.entries[0].meanings[0].definitions[0].definition).toBe('n.注意,关心,注意力');
  expect(result.warning).toBe('');
  expect(result.source).toBe('3325 词典');
});
test('canceling during definition translation never starts more providers or publishes stale definitions', async ({
  page,
}) => {
  const calls = await setup(page, false);
  let release,
    requested = false;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.fulfill({ json: primary }));
  await page.route('https://api.mymemory.translated.net/**', async (route) => {
    const word = new URL(route.request().url()).searchParams.get('q') === 'attention';
    if (!word) {
      requested = true;
      await held;
    }
    await route
      .fulfill({
        json: {
          responseStatus: 200,
          responseData: { translatedText: word ? '注意力' : '不应回填的中文解释' },
        },
      })
      .catch(() => {});
  });
  await page.evaluate(async () => {
    window.detailController = new AbortController();
    window.detailUpdates = [];
    window.detailTask = (await import('/src/js/translation.js'))
      .lookupWord('attention', window.detailController.signal, (result) =>
        window.detailUpdates.push(structuredClone(result)),
      )
      .then(
        () => 'success',
        (error) => error.name,
      );
  });
  await expect.poll(() => requested).toBe(true);
  const result = await page.evaluate(async () => {
    window.detailController.abort();
    return { name: await window.detailTask, updates: window.detailUpdates };
  });
  release();
  expect(result.name).toBe('AbortError');
  expect(JSON.stringify(result.updates)).not.toContain('Primary English definition.');
  expect(JSON.stringify(result.updates)).not.toContain('不应回填');
  expect(calls.some((url) => /googleapis.com|freedictionaryapi.com|3325.cn/.test(url))).toBe(false);
});
