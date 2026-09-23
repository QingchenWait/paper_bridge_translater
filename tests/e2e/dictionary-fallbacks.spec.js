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
async function setup(page) {
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
  await expect(page.locator('#selection-result')).toContainText('Mental focus.');
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
      await expect(page.locator('#selection-result')).toContainText('Mental focus.');
      await expect(page.locator('#selection-result')).toContainText('plural：attentions');
    } else {
      await expect(page.locator('.dictionary-heading')).toContainText('[əˈtenʃən]');
      await expect(page.locator('.part-of-speech')).toHaveText('n');
      await expect(page.locator('.dictionary-credit a').filter({ hasText: '词条来源' })).toHaveAttribute(
        'href',
        'https://3325.cn/dict/attention',
      );
    }
  });
test('late primary English and empty Wiktionary forms do not erase supplementary phonetics or forms', async ({
  page,
}) => {
  await setup(page);
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('https://api.dictionaryapi.dev/**', async (route) => {
    await held;
    await route.fulfill({ json: primary });
  });
  await page.route('https://freedictionaryapi.com/**', (route) => route.fulfill({ json: free() }));
  await selectWord(page);
  await expect(page.locator('.chinese-meaning')).toHaveText('注意力');
  release();
  await expect(page.locator('#selection-result')).toContainText('Primary English definition.');
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
test('failed fallback requests retain usable primary English definitions', async ({ page }) => {
  const calls = await setup(page);
  await page.route('https://api.dictionaryapi.dev/**', (route) => route.fulfill({ json: primary }));
  const result = await lookup(page);
  expect(result.entries[0].meanings[0].definitions[0].definition).toBe('Primary English definition.');
  expect(result.chinese).toBe('');
  expect(result.warning).toBe('');
  expect(calls.filter((url) => /freedictionaryapi.com|3325.cn/.test(url))).toHaveLength(2);
});
