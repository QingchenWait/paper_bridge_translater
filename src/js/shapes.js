// Geometry is shared by the screen canvas and PDF export (coordinates in pt).
export const SHAPES = [
  ['rectangle', 'rectangle-horizontal', '矩形'],
  ['circle', 'circle', '圆形'],
  ['line', 'minus', '直线'],
  ['arrow', 'arrow-up-right', '箭头'],
];
export function shapeGeometry(annotation, width, height) {
  const start = { x: annotation.start.x * width, y: annotation.start.y * height };
  const end = { x: annotation.end.x * width, y: annotation.end.y * height };
  const x = Math.min(start.x, end.x),
    y = Math.min(start.y, end.y);
  if (annotation.shape === 'rectangle')
    return { type: 'rectangle', x, y, width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
  if (annotation.shape === 'circle') {
    const radius = Math.min(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
    return {
      type: 'circle',
      x: start.x + Math.sign(end.x - start.x) * radius,
      y: start.y + Math.sign(end.y - start.y) * radius,
      radius,
    };
  }
  const segments = [[start, end]];
  if (annotation.shape === 'arrow') {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const length = Math.min(
      Math.hypot(end.x - start.x, end.y - start.y) * 0.4,
      Math.max(8, (annotation.strokeWidth || 2) * 4),
    );
    for (const side of [-1, 1])
      segments.push([
        end,
        {
          x: end.x - length * Math.cos(angle + (side * Math.PI) / 6),
          y: end.y - length * Math.sin(angle + (side * Math.PI) / 6),
        },
      ]);
  }
  return { type: 'lines', segments };
}
export function drawShape(context, annotation, width, height) {
  const geometry = shapeGeometry(annotation, width, height);
  context.beginPath();
  if (geometry.type === 'rectangle') context.rect(geometry.x, geometry.y, geometry.width, geometry.height);
  else if (geometry.type === 'circle') context.arc(geometry.x, geometry.y, geometry.radius, 0, Math.PI * 2);
  else
    for (const [start, end] of geometry.segments) {
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
    }
  context.stroke();
}
export function distanceToSegment(point, start, end) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    denom = dx * dx + dy * dy;
  const t = denom
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom))
    : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
export function hitShape(annotation, point, width, height, tolerance = 8) {
  const geometry = shapeGeometry(annotation, width, height),
    p = { x: point.x * width, y: point.y * height };
  if (geometry.type === 'rectangle')
    return (
      p.x >= geometry.x - tolerance &&
      p.x <= geometry.x + geometry.width + tolerance &&
      p.y >= geometry.y - tolerance &&
      p.y <= geometry.y + geometry.height + tolerance
    );
  if (geometry.type === 'circle')
    return Math.hypot(p.x - geometry.x, p.y - geometry.y) <= geometry.radius + tolerance;
  return geometry.segments.some(([start, end]) => distanceToSegment(p, start, end) <= tolerance);
}

// Erase the swept path, not just event endpoints: fast pointer motion can cross
// a thin stroke without producing a pointermove directly on it.
export function hitEraserSweep(annotation, from, to, width, height, tolerance = 18) {
  const point = (p) => ({ x: p.x * width, y: p.y * height });
  const a = point(from),
    b = point(to);
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const near = (c, d, radius = tolerance) =>
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    Math.min(
      distanceToSegment(a, c, d),
      distanceToSegment(b, c, d),
      distanceToSegment(c, a, b),
      distanceToSegment(d, a, b),
    ) <= radius;
  if (annotation.type === 'pen')
    return (annotation.points || []).some((p, i, points) => near(point(p), point(points[i + 1] || p)));
  if (annotation.type !== 'shape') return false;
  const shape = shapeGeometry(annotation, width, height);
  if (shape.type === 'circle')
    return distanceToSegment({ x: shape.x, y: shape.y }, a, b) <= shape.radius + tolerance;
  if (shape.type === 'rectangle') {
    if (
      hitShape(annotation, from, width, height, tolerance) ||
      hitShape(annotation, to, width, height, tolerance)
    )
      return true;
    const x = shape.x - tolerance,
      y = shape.y - tolerance,
      right = shape.x + shape.width + tolerance,
      bottom = shape.y + shape.height + tolerance;
    const corners = [
      { x, y },
      { x: right, y },
      { x: right, y: bottom },
      { x, y: bottom },
    ];
    return corners.some((p, i) => near(p, corners[(i + 1) % 4], 0));
  }
  return shape.segments.some(([start, end]) => near(start, end));
}
export function translateAnnotation(annotation, dx, dy, box = { w: 0, h: 0 }) {
  const before = structuredClone(annotation);
  const xs =
    annotation.type === 'shape'
      ? [annotation.start.x, annotation.end.x]
      : [annotation.x, annotation.x + box.w];
  const ys =
    annotation.type === 'shape'
      ? [annotation.start.y, annotation.end.y]
      : [annotation.y, annotation.y + box.h];
  dx = Math.min(1 - Math.max(...xs), Math.max(-Math.min(...xs), dx));
  dy = Math.min(1 - Math.max(...ys), Math.max(-Math.min(...ys), dy));
  if (annotation.type === 'shape') {
    before.start = { x: annotation.start.x + dx, y: annotation.start.y + dy };
    before.end = { x: annotation.end.x + dx, y: annotation.end.y + dy };
  } else {
    before.x += dx;
    before.y += dy;
  }
  return before;
}
