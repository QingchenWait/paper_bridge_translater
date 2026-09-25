import { markdown } from './markdown-core.js';

// Always parse the whole document so reference links, lists and unfinished
// fences retain Markdown semantics; cache rendering of unchanged token groups.
export class MarkdownBlocks {
  constructor() {
    this.cache = new Map();
  }
  render(source) {
    const env = {},
      tokens = markdown.parse(source, env),
      next = new Map();
    const render = (group, inline = false) => {
      const key = (inline ? 'i' : 'b') + JSON.stringify(group);
      const html =
        this.cache.get(key) ??
        (inline
          ? markdown.renderer.renderInline(group, markdown.options, env)
          : markdown.renderer.render(group, markdown.options, env));
      next.set(key, html);
      return html;
    };
    const blocks = [];
    // Raw block HTML can span Markdown blocks: render it in one context.
    if (tokens.some((t) => t.type === 'html_block')) blocks.push({ html: render(tokens) });
    else
      for (let i = 0; i < tokens.length;) {
        const start = i++;
        let depth = tokens[start].nesting;
        while (depth > 0 && i < tokens.length) depth += tokens[i++].nesting;
        const group = tokens.slice(start, i);
        if (
          group.length === 3 &&
          group[0].type === 'paragraph_open' &&
          group[1].type === 'inline' &&
          !group[1].children.some((t) => t.type === 'html_inline')
        ) {
          const parts = [];
          let run = [],
            length = 0,
            nesting = 0;
          const flush = () => {
            if (run.length) parts.push(render(run, true));
            run = [];
            length = 0;
          };
          for (const token of group[1].children) {
            // Long plain text remains a paragraph: only its internal text runs split.
            if (token.type === 'text' && nesting === 0 && token.content.length > 2048) {
              flush();
              const chars = Array.from(token.content);
              for (let offset = 0; offset < chars.length; offset += 2048)
                parts.push(
                  render([{ ...token, content: chars.slice(offset, offset + 2048).join('') }], true),
                );
            } else {
              run.push(token);
              nesting += token.nesting;
              length += token.content.length;
              if (!nesting && (length >= 2048 || run.length >= 48)) flush();
            }
          }
          flush();
          blocks.push({ paragraph: true, parts });
        } else blocks.push({ html: render(group) });
      }
    this.cache = next;
    return blocks;
  }
}
