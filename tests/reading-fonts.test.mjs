import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  normalizeSettings,
  normalizeReadingFontSizes,
  saveSettings,
  getSettings,
  reloadSettings,
  adjustReadingFontSize,
} from '../src/js/settings.js';
import { createArchive, readArchive, importArchive } from '../src/js/archive.js';
globalThis.document = new EventTarget();

test('reading font defaults and bounds normalize old or malformed preferences independently', () => {
  assert.deepEqual(normalizeSettings({}).readingFontSizes, { source: 100, selection: 100, full: 100 });
  assert.deepEqual(normalizeReadingFontSizes({ source: 1, selection: 999, full: '130' }), {
    source: 70,
    selection: 180,
    full: 130,
  });
  assert.deepEqual(normalizeReadingFontSizes({ source: null, selection: 'invalid', full: Infinity }), {
    source: 100,
    selection: 100,
    full: 100,
  });
});
test('queued font clicks merge independently, clamp at limits and survive reload/archive without secrets', async () => {
  await saveSettings({ readingFontSizes: { source: 100, selection: 100, full: 100 } });
  await Promise.all([
    adjustReadingFontSize('source', 1),
    adjustReadingFontSize('source', 1),
    adjustReadingFontSize('selection', -1),
    adjustReadingFontSize('full', 1),
    saveSettings({ translationStyle: '忠实直译' }),
  ]);
  assert.deepEqual((await reloadSettings()).readingFontSizes, { source: 120, selection: 90, full: 110 });
  assert.equal((await getSettings()).translationStyle, '忠实直译');
  await Promise.all(Array.from({ length: 20 }, () => adjustReadingFontSize('source', 1)));
  await Promise.all(Array.from({ length: 20 }, () => adjustReadingFontSize('selection', -1)));
  const changing = adjustReadingFontSize('full', 1);
  const archive = await createArchive({ includeSecrets: false });
  await changing;
  assert.deepEqual((await readArchive(archive)).settings.find((s) => s.id === 'app').value.readingFontSizes, {
    source: 180,
    selection: 70,
    full: 120,
  });
  await saveSettings({ readingFontSizes: {} });
  await importArchive(archive, { restoreSettings: true });
  assert.deepEqual((await getSettings()).readingFontSizes, { source: 180, selection: 70, full: 120 });
  await assert.rejects(adjustReadingFontSize('chat', 1));
});
