import { adjustReadingFontSize, normalizeReadingFontSizes, READING_FONT_LIMITS } from '../settings.js';
import { iconButton, toast } from './components.js';

const labels = { source: '原文', selection: '译文', full: '全文译文' };
const targets = { source: '.source-text', selection: '#selection-result', full: '#full-result' };
export function readingFontButtons(area) {
  return [-1, 1]
    .map((direction) =>
      iconButton(
        `reading-font-${area}-${direction < 0 ? 'smaller' : 'larger'}`,
        direction < 0 ? 'a-arrow-down' : 'a-arrow-up',
        `${labels[area]}字体${direction < 0 ? '缩小' : '加大'}`,
      ).replace('<button ', `<button data-font-area="${area}" data-font-direction="${direction}" `),
    )
    .join('');
}
export class ReadingFonts {
  constructor(root) {
    this.root = root;
    this.sizes = normalizeReadingFontSizes();
    // Delegate once; streaming/re-rendering the result must not accumulate handlers.
    root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-font-area]');
      if (!button || button.disabled) return;
      adjustReadingFontSize(button.dataset.fontArea, Number(button.dataset.fontDirection)).catch((error) =>
        toast(error.message, 'error'),
      );
    });
  }
  update(settings) {
    this.sizes = normalizeReadingFontSizes(settings.readingFontSizes);
    this.apply();
  }
  apply() {
    for (const [area, selector] of Object.entries(targets)) {
      const target = this.root.querySelector(selector);
      target?.style.setProperty('--reading-font-scale', this.sizes[area] / 100);
      // Scale absolute inline HTML font sizes too, preserving their relative hierarchy.
      // em/% inherit the resized parent already; KaTeX uses relative internal sizes.
      target?.querySelectorAll('[style]').forEach((element) => {
        const size = element.style.fontSize;
        if (/^-?[\d.]+(?:px|pt|pc|in|cm|mm|q|rem)$/i.test(size))
          element.style.fontSize = `calc(${size} * var(--reading-font-scale))`;
      });
    }
    this.root.querySelectorAll('[data-font-area]').forEach((button) => {
      const size = this.sizes[button.dataset.fontArea];
      button.disabled =
        Number(button.dataset.fontDirection) < 0
          ? size <= READING_FONT_LIMITS.min
          : size >= READING_FONT_LIMITS.max;
    });
  }
}
