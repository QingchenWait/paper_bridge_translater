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
