import { markdown } from './markdown-core.js';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github.css';
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
export function sanitizeMarkdown(html) {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['eq', 'eqn'],
    ADD_ATTR: ['style', 'class', 'aria-hidden'],
    FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'input', 'button', 'script', 'style', 'img'],
  });
}
export function renderMarkdown(text) {
  return sanitizeMarkdown(markdown.render(String(text || '')));
}
export function prepareMarkdown(element) {
  element.querySelectorAll('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
  // LLM prose uses placeholders; never make unsolicited remote image requests.
  element
    .querySelectorAll('img')
    .forEach((img) => img.replaceWith(document.createTextNode(`[图片：${img.alt || '原文图片'}]`)));
}

export function mountMarkdown(element, text) {
  element.innerHTML = renderMarkdown(text);
  prepareMarkdown(element);
}
