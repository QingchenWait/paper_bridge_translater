import { TextLayer, Util } from 'pdfjs-dist';

// Canvas and HTML must share fonts, language and the exact page coordinate space.
export async function renderAlignedText(page, content, container, viewport) {
  const styles = {};
  const fonts = new Map();
  for (const [name, style] of Object.entries(content.styles)) {
    const font = page.commonObjs.has(name) ? page.commonObjs.get(name) : null;
    fonts.set(name, font);
    styles[name] = {
      ...style,
      fontFamily:
        font?.systemFontInfo?.css ||
        (font?.loadedName && !font.disableFontFace
          ? `${JSON.stringify(font.loadedName)}, ${font.fallbackName || style.fontFamily}`
          : style.fontFamily),
    };
  }
  const layerContent = { ...content, lang: content.lang || 'en', styles };
  container.lang = layerContent.lang;
  const unitScale =
    viewport.width / (viewport.rotation % 180 ? viewport.rawDims.pageHeight : viewport.rawDims.pageWidth);
  container.style.setProperty('--total-scale-factor', unitScale);
  const layer = new TextLayer({ textContentSource: layerContent, container, viewport });
  await layer.render();
  // Avoid CSS round()/missing custom-property fallback and unrotated dimensions.
  container.style.width = `${viewport.rawDims.pageWidth * unitScale}px`;
  container.style.height = `${viewport.rawDims.pageHeight * unitScale}px`;
  const items = content.items.filter((item) => typeof item.str === 'string');
  const spans = layer.textDivs;
  items.forEach((item, i) => {
    const font = fonts.get(item.fontName),
      span = spans[i];
    span.style.fontWeight = font?.black ? '900' : font?.bold ? 'bold' : 'normal';
    span.style.fontStyle = font?.italic ? 'italic' : 'normal';
    span.style.fontKerning = 'none';
    span.style.fontVariantLigatures = 'none';
    span.style.setProperty('--font-height', `${Math.hypot(item.transform[2], item.transform[3])}px`);
  });
  const ctx = document.createElement('canvas').getContext('2d');
  const measurements = new Map();
  const { pageWidth, pageHeight, pageX, pageY } = viewport.rawDims;
  const transform = [1, 0, 0, -1, -pageX, pageY + pageHeight];
  items.forEach((item, i) => {
    const span = spans[i];
    if (!item.str) return;
    const css = getComputedStyle(span);
    const fontSize = parseFloat(css.fontSize);
    const minSize = parseFloat(container.style.getPropertyValue('--min-font-size')) || 1;
    const measuredWidth = parseFloat(css.width);
    const style = styles[item.fontName];
    if (measuredWidth > 0 && item.width > 0)
      span.style.setProperty(
        '--scale-x',
        ((style.vertical ? item.height : item.width) * unitScale * minSize) / measuredWidth,
      );
    const font = `${css.fontStyle} ${css.fontWeight} ${fontSize}px ${css.fontFamily}`;
    let baseline = measurements.get(font);
    if (baseline === undefined) {
      ctx.font = font;
      const metrics = ctx.measureText('');
      baseline =
        (fontSize +
          (metrics.fontBoundingBoxAscent || fontSize * 0.8) -
          (metrics.fontBoundingBoxDescent || fontSize * 0.2)) /
        2;
      measurements.set(font, baseline);
    }
    const tx = Util.transform(transform, item.transform);
    let angle = Math.atan2(tx[1], tx[0]);
    if (style.vertical) angle += Math.PI / 2;
    const ascent = baseline / unitScale / minSize;
    span.style.left = `${((tx[4] + ascent * Math.sin(angle)) / pageWidth) * 100}%`;
    span.style.top = `${((tx[5] - ascent * Math.cos(angle)) / pageHeight) * 100}%`;
  });
  const byItem = new Map();
  let cursor = 0;
  content.items.forEach((item, index) => {
    if (typeof item.str === 'string') byItem.set(index, spans[cursor++]);
  });
  return { layer, items, spans, byItem };
}
