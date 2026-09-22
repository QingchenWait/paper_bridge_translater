import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
import { esc } from './utils.js';
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
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style') {
    const allowed =
      /^(color|background-color|font-size|font-family|font-weight|font-style|text-align|text-decoration|vertical-align|margin(?:-\w+)?|padding(?:-\w+)?|border(?:-\w+)?|width|height|max-width|min-width|display|position|top|left|right|bottom|line-height|white-space)$/;
    data.attrValue = data.attrValue
      .split(';')
      .filter((declaration) => {
        const [property, ...rest] = declaration.split(':');
        const value = rest.join(':');
        return allowed.test(property.trim()) && !/url|expression|javascript|fixed|sticky|var\(/i.test(value);
      })
      .join(';');
  }
});
export function renderMarkdown(text) {
  return DOMPurify.sanitize(markdown.render(String(text || '')), {
    ADD_TAGS: ['eq', 'eqn'],
    ADD_ATTR: ['style', 'class', 'aria-hidden'],
    FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'button', 'script', 'style', 'img'],
  });
}
export function mountMarkdown(element, text) {
  element.innerHTML = renderMarkdown(text);
  element.querySelectorAll('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  // LLM prose uses placeholders; never make unsolicited remote image requests.
  element
    .querySelectorAll('img')
    .forEach((img) => img.replaceWith(document.createTextNode(`[图片：${img.alt || '原文图片'}]`)));
}
