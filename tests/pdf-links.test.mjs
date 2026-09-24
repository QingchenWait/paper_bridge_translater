import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePdfLink } from '../src/js/pdf-links.js';
test('external PDF links accept case-insensitive suffixes and keep an uneditable .pdf extension', () => {
  assert.deepEqual(parsePdfLink(' https://example.test/Study.PDF '), {
    url: 'https://example.test/Study.PDF',
    filename: 'Study.pdf',
  });
  assert.equal(parsePdfLink('https://example.test/%E8%AE%BA%E6%96%87.pdf').filename, '论文.pdf');
  assert.equal(parsePdfLink('https://example.test/a.pdf', '我的重命名.PDF').filename, '我的重命名.pdf');
  assert.equal(parsePdfLink('http://localhost/a.pdf', 'name.pdf.pdf').filename, 'name.pdf');
});
test('invalid links and path-like rename values are rejected before network requests', () => {
  for (const url of [
    '',
    'a.pdf',
    'javascript:alert(1).pdf',
    'file:///a.pdf',
    'https://user:secret@example.test/a.pdf',
  ])
    assert.throws(() => parsePdfLink(url));
  assert.throws(() => parsePdfLink('https://example.test/a.pdf', '../other'));
});

test('extensionless endpoints, query strings and fragments keep the URL and produce a safe PDF name', () => {
  for (const [url, filename] of [
    ['https://arxiv.org/pdf/2503.13443', '2503.13443.pdf'],
    ['https://example.test/a.pdf?token=x#page=1', 'a.pdf'],
    ['https://example.test/download?id=123', 'download.pdf'],
    ['https://example.test/export.txt', 'export.txt.pdf'],
    ['https://example.test/', '文档.pdf'],
    ['https://example.test/%2e%2e%2fprivate', '.._private.pdf'],
  ])
    assert.deepEqual(parsePdfLink(url), { url, filename });
  assert.equal(parsePdfLink('https://arxiv.org/pdf/2503.13443', '论文.PDF').filename, '论文.pdf');
});
