export function initDesktopLayout() {
  const media = matchMedia('(min-width: 961px)');
  const update = () => {
    document.documentElement.classList.toggle('desktop-layout', media.matches);
  };
  media.addEventListener('change', update);
  update();
  const handle = document.getElementById('split-handle');
  handle.addEventListener('pointerdown', (event) => {
    if (!media.matches) return;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing');
    handle.onpointermove = (event) => {
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      const share = Math.max(38, Math.min(72, ((event.clientX - workspace.left) / workspace.width) * 100));
      document.documentElement.style.setProperty('--reader-share', `${share}%`);
    };
    const stop = () => {
      handle.onpointermove = null;
      document.body.classList.remove('resizing');
      document.dispatchEvent(new Event('reader-resize'));
    };
    handle.onpointerup = stop;
    handle.onpointercancel = stop;
  });
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-share')) || 60;
    document.documentElement.style.setProperty(
      '--reader-share',
      `${Math.max(38, Math.min(72, current + (event.key === 'ArrowRight' ? 2 : -2)))}%`,
    );
    document.dispatchEvent(new Event('reader-resize'));
  });
}
