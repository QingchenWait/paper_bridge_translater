import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveFile, chooseSaveTarget } from '../src/js/utils.js';
test('save picker writes and closes once; write errors and cancellation never trigger a second download', async () => {
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  let downloads = 0,
    pickers = 0,
    writes = 0,
    closes = 0;
  globalThis.document = { createElement: () => ({ click: () => downloads++ }) };
  const blob = new Blob(['%PDF-1.7\ncorrect']);
  globalThis.window = {
    showSaveFilePicker: async () => {
      pickers++;
      return {
        createWritable: async () => ({
          write: async (value) => {
            writes++;
            assert.equal(await value.text(), await blob.text());
          },
          close: async () => closes++,
        }),
      };
    },
  };
  try {
    await saveFile(blob, 'paper.pdf');
    assert.deepEqual([pickers, writes, closes, downloads], [1, 1, 1, 0]);
    window.showSaveFilePicker = async () => ({
      createWritable: async () => ({
        write: async () => {
          throw new Error('disk error');
        },
        abort: async () => {},
      }),
    });
    await assert.rejects(saveFile(blob, 'paper.pdf'), /disk error/);
    assert.equal(downloads, 0);
    window.showSaveFilePicker = async () => {
      throw new DOMException('cancel', 'AbortError');
    };
    await saveFile(blob, 'paper.pdf');
    assert.equal(downloads, 0);
    await assert.rejects(saveFile(new Blob([]), 'empty.pdf'), /为空/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
test('unsupported pickers download silently, while a prepared destination is never picked twice', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previousWindow = globalThis.window,
    previousDocument = globalThis.document;
  let downloads = 0,
    pickers = 0,
    writes = 0;
  globalThis.document = { createElement: () => ({ click: () => downloads++ }) };
  globalThis.window = {};
  const blob = new Blob(['%PDF-1.7']);
  try {
    const fallback = await chooseSaveTarget('file.pdf');
    assert.equal(fallback.defaultDownload, true);
    await saveFile(blob, 'file.pdf', { target: fallback });
    assert.equal(downloads, 1);
    window.showSaveFilePicker = async () => {
      pickers++;
      return { createWritable: async () => ({ write: async () => writes++, close: async () => {} }) };
    };
    const target = await chooseSaveTarget('file.pdf');
    await saveFile(blob, 'file.pdf', { target });
    assert.equal(pickers, 1);
    assert.equal(writes, 1);
    window.showSaveFilePicker = async () => {
      throw new DOMException('unsupported', 'NotSupportedError');
    };
    await saveFile(blob, 'file.pdf');
    assert.equal(downloads, 2);
    window.showSaveFilePicker = async () => {
      throw new DOMException('expired gesture', 'SecurityError');
    };
    await assert.rejects(saveFile(blob, 'file.pdf'), /点击授权/);
    assert.equal(downloads, 2);
    t.mock.timers.tick(60000);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
