// Shared selection-first rule. New text actions register a create callback;
// hit testing, partial removal, button state and transaction history stay shared.
const actions = new Map();
export function registerSelectionAction(type, create) {
  actions.set(type, { create });
}
export function isSelectionAction(type) {
  return actions.has(type);
}
export function overlaps(a, b) {
  return (
    a.page === b.page &&
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.0001 &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > Math.min(a.h, b.h) * 0.45
  );
}
export function subtractSelection(rects, selection) {
  return selection.reduce(
    (parts, cut) =>
      parts.flatMap((rect) => {
        if (!overlaps(rect, cut)) return [rect];
        const remaining = [];
        if (cut.x - rect.x > 0.0001) remaining.push({ ...rect, w: cut.x - rect.x });
        const right = cut.x + cut.w;
        if (rect.x + rect.w - right > 0.0001)
          remaining.push({ ...rect, x: right, w: rect.x + rect.w - right });
        return remaining;
      }),
    rects,
  );
}
export function matchingAnnotations(type, annotations, selection) {
  return !selection?.rects.length
    ? []
    : annotations.filter(
        (a) =>
          !a.deleted &&
          a.type === type &&
          a.rects?.some((r) => selection.rects.some((s) => overlaps({ ...r, page: a.page }, s))),
      );
}
export function selectionActionState(annotations, selection) {
  return Object.fromEntries(
    [...actions.keys()].map((type) => [type, matchingAnnotations(type, annotations, selection).length > 0]),
  );
}
export async function planSelectionAction(type, annotations, selection, context) {
  const rule = actions.get(type);
  if (!rule || !selection?.rects.length) return [];
  const matches = matchingAnnotations(type, annotations, selection);
  if (matches.length)
    return matches.map((before) => {
      const rects = subtractSelection(
        before.rects.map((r) => ({ ...r, page: before.page })),
        selection.rects,
      );
      const after = { ...before, rects, deleted: !rects.length };
      if (before.type === 'note' && rects.length) {
        after.x = rects[0].x;
        after.y = Math.min(0.9, rects[0].y + rects[0].h);
      }
      return { before, after };
    });
  const extra = await rule.create(context);
  if (extra === null) return [];
  return [...new Set(selection.rects.map((r) => r.page))].map((page) => {
    const rects = selection.rects.filter((r) => r.page === page);
    return {
      before: null,
      after: {
        type,
        page,
        rects,
        color: context.color,
        selectedText: selection.text,
        ...extra,
        ...(type === 'note' ? { x: rects[0].x, y: Math.min(0.9, rects[0].y + rects[0].h) } : {}),
      },
    };
  });
}
registerSelectionAction('underline', async () => ({}));
registerSelectionAction('strike', async () => ({}));
registerSelectionAction('highlight', async () => ({}));
registerSelectionAction('note', async ({ inputText, fontSize = 12 }) => {
  const text = await inputText('note');
  return text ? { text, fontSize } : null;
});
