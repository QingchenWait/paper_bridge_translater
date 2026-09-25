import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownBlocks } from '../src/js/markdown-blocks.js';
import { markdown } from '../src/js/markdown-core.js';
import { TranslationWriter, flushTranslationWrites } from '../src/js/translation-writes.js';
const flatten = (blocks) =>
  blocks.map((b) => (b.paragraph ? `<p>${b.parts.join('')}</p>\n` : b.html)).join('');
test('block rendering preserves complete Markdown semantics and repairs incomplete streamed syntax', () => {
  const renderer = new MarkdownBlocks();
  const cases = [
    '# 标题\n\n**粗体** and *emphasis*; $x^2$\n\n$$x+y$$\n\n| A | B |\n|---|---|\n|1|2|\n\n```js\nlet a = 1;\n```',
    '- one\n  - nested\n\n    second paragraph\n- two\n\n> quote\n>\n> more\n',
    '[ref][target]\n\n[target]: https://example.test "title"\n\n![image](https://example.test/a.png)',
    '<div style="color:red">\n\n**inside**\n\n</div>',
    'x'.repeat(15000) + '😀中' + ' *italic* text $a+b$ '.repeat(200),
  ];
  for (const source of cases) {
    for (const size of [7, Math.floor(source.length / 2), source.length]) {
      const text = source.slice(0, size);
      assert.equal(flatten(renderer.render(text)), markdown.render(text));
    }
  }
});
test('full translation saves coalesce while in-flight writes keep the latest complete text', async () => {
  const saved = [];
  let release;
  const blocked = new Promise((r) => {
    release = r;
  });
  const writer = new TranslationWriter('fixture', assert.fail, async (value) => {
    saved.push(value);
    if (saved.length === 1) await blocked;
  });
  try {
    for (let i = 1; i <= 1000; i++) writer.update('a'.repeat(i));
    const writing = writer.flush();
    await Promise.resolve();
    writer.update('完整最后文本');
    release();
    await writing;
    assert.deepEqual(saved, ['a'.repeat(1000), '完整最后文本']);
    writer.update('备份前的文本');
    await flushTranslationWrites();
    assert.equal(saved.at(-1), '备份前的文本');
  } finally {
    writer.close();
  }
});
test('full translation failed save is reported and a later flush can retry unchanged content', async () => {
  let fail = true,
    saved;
  const writer = new TranslationWriter(
    'fixture',
    () => {},
    async (value) => {
      if (fail) throw new Error('disk');
      saved = value;
    },
  );
  try {
    writer.update('keep');
    await assert.rejects(writer.flush(), /disk/);
    fail = false;
    await writer.flush();
    assert.equal(saved, 'keep');
  } finally {
    writer.close();
  }
});
