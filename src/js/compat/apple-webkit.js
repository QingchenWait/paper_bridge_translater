// Apple-only compatibility. Chromium on macOS must keep the ordinary path.
import { installAppleRuntime } from './apple-streams.js';
export function applePlatform(navigator = globalThis.navigator) {
  const ua = navigator?.userAgent || '',
    platform = navigator?.platform || '';
  const touch = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return {
    touch,
    webkit:
      /AppleWebKit/.test(ua) &&
      (touch || (/Mac/.test(`${platform} ${ua}`) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua))),
  };
}
export const apple = applePlatform();
export const applePdfOptions = apple.webkit
  ? { isOffscreenCanvasSupported: false, isImageDecoderSupported: false }
  : {};
export async function loadApplePdfEngine() {
  installAppleRuntime();
  // Both realms need the upstream polyfills; a main-window Map shim alone is insufficient.
  const [engine, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('./apple-pdf.worker.js?worker&url'),
  ]);
  engine.GlobalWorkerOptions.workerSrc = worker.default;
  return engine;
}
export function installAppleWebKit() {
  if (!apple.webkit) return;
  installAppleRuntime();
  document.documentElement.dataset.appleWebkit = '';
  if (apple.touch) document.documentElement.dataset.appleTouch = '';
}
export function releaseAppleCanvases(root) {
  if (!apple.webkit) return;
  for (const canvas of root.querySelectorAll('canvas')) canvas.width = canvas.height = 0;
}
export function deferAppleTextPlacement(event, canvas, create) {
  if (!apple.touch || !apple.webkit || event.pointerType !== 'touch') return false;
  // Focusing a textarea during touchstart cancels the pointer on older iPadOS,
  // then the native tap blurs/deletes the empty editor. Focus after release.
  const cleanup = () => {
    canvas.removeEventListener('pointerup', end);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('touchend', touchEnd);
  };
  let frame,
    complete = false;
  const finish = () => {
    if (complete) return;
    complete = true;
    cleanup();
    cancelAnimationFrame(frame);
    if (canvas.isConnected) create();
  };
  const end = (next) => {
    if (next.pointerId !== event.pointerId) return;
    frame = requestAnimationFrame(finish);
  };
  const touchEnd = (next) => {
    if (next.touches.length) return;
    next.preventDefault();
    finish(); // Preserve the real touch gesture for the iOS keyboard.
  };
  const cancel = (next) => {
    if (next.pointerId !== event.pointerId) return;
    complete = true;
    cancelAnimationFrame(frame);
    cleanup();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  return true;
}
const portals = new WeakMap();
export function restoreAppleMenu(menu) {
  const portal = portals.get(menu);
  if (!portal) return;
  portal.cleanup();
  menu.hidden = true;
  menu.classList.remove('apple-select-portal');
  menu.removeAttribute('style');
  portal.trigger.setAttribute('aria-expanded', 'false');
  if (portal.parent.isConnected) portal.parent.append(menu);
  else menu.remove();
  portals.delete(menu);
}
export function openAppleMenu(element, trigger, menu) {
  if (!apple.webkit || !element.closest('#pdf-toolbar')) return;
  restoreAppleMenu(menu);
  const parent = menu.parentElement;
  document.body.append(menu);
  menu.classList.add('apple-select-portal');
  menu.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, 144), innerWidth - 16);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rect.left))}px`;
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 22)}px`;
  const close = (event) => {
    if (event?.type === 'scroll' && menu.contains(event.target)) return;
    restoreAppleMenu(menu);
  };
  window.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
  portals.set(menu, {
    parent,
    trigger,
    cleanup: () => {
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    },
  });
  return true;
}
