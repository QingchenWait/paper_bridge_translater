export function initMobileLayout() {
  const media = matchMedia('(max-width: 960px)');
  const update = () => {
    document.documentElement.classList.toggle('mobile-layout', media.matches);
    if (media.matches && !document.documentElement.dataset.mobilePane)
      document.documentElement.dataset.mobilePane = 'reader';
  };
  media.addEventListener('change', update);
  update();
  document
    .querySelectorAll('[data-mobile-pane]')
    .forEach((button) => button.addEventListener('click', () => setMobilePane(button.dataset.mobilePane)));
  document.addEventListener('selection-translated', () => {
    if (media.matches) setMobilePane('assistant');
  });
  const viewport = () =>
    document.documentElement.style.setProperty(
      '--viewport-height',
      `${window.visualViewport?.height || innerHeight}px`,
    );
  window.visualViewport?.addEventListener('resize', viewport);
  viewport();
}
export function setMobilePane(pane) {
  document.getElementById('workspace').hidden = false;
  document.getElementById('library-view').hidden = true;
  document.documentElement.dataset.view = 'reader';
  document.documentElement.dataset.mobilePane = pane;
  document
    .querySelectorAll('[data-mobile-pane]')
    .forEach((button) => button.classList.toggle('active', button.dataset.mobilePane === pane));
  if (pane === 'reader') document.dispatchEvent(new Event('reader-resize'));
}
