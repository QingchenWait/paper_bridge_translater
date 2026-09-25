import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  highlight(code, language) {
    return language && hljs.getLanguage(language) ? hljs.highlight(code, { language }).value : '';
  },
}).use(texmath, {
  engine: katex,
  delimiters: ['dollars', 'brackets'],
  katexOptions: { throwOnError: false, strict: 'ignore', trust: false },
});
markdown.renderer.rules.image = (tokens, index) =>
  `<span class="image-placeholder">[图片：${esc(tokens[index].content || '原文图片')}]</span>`;

export { markdown };
