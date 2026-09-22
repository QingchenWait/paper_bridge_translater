export function indexPageText(items) {
  let text = '';
  const runs = [];
  items.forEach((item, itemIndex) => {
    if (typeof item.str !== 'string') return;
    const start = text.length;
    text += item.str.replace(/\s/g, ' ');
    runs.push({ itemIndex, start, end: text.length });
    const next = items[itemIndex + 1];
    const gap = next?.transform && item.transform ? next.transform[4] - item.transform[4] - item.width : 0;
    if (item.hasEOL || gap > Math.abs(item.height || item.transform?.[3] || 0) * 0.15) text += ' ';
  });
  return { text, runs };
}
export function findPageMatches(index, query, { caseSensitive = false, wholeWord = false } = {}) {
  const term = query.trim();
  if (!term) return [];
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const expression = new RegExp(
    wholeWord ? `(?<![\\p{L}\\p{N}\\p{M}_])${escaped}(?![\\p{L}\\p{N}\\p{M}_])` : escaped,
    caseSensitive ? 'gu' : 'giu',
  );
  return [...index.text.matchAll(expression)]
    .map((match) => {
      const start = match.index,
        end = start + match[0].length;
      const parts = index.runs
        .filter((run) => run.end > start && run.start < end)
        .map((run) => ({
          itemIndex: run.itemIndex,
          start: Math.max(0, start - run.start),
          end: Math.min(run.end, end) - run.start,
        }));
      return {
        start,
        end,
        parts,
        snippet: index.text
          .slice(Math.max(0, start - 24), Math.min(index.text.length, end + 45))
          .replace(/\s+/g, ' '),
      };
    })
    .filter((match) => match.parts.length);
}
