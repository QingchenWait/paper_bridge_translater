export function initMobileLayout({ closeNavigation = () => {} } = {}) {
  const media = matchMedia('(max-width: 960px)');
  const update = () => {
    document.documentElement.classList.toggle('mobile-layout', media.matches);
    if (media.matches && !document.documentElement.dataset.mobilePane)
      document.documentElement.dataset.mobilePane = 'reader';
  };
  media.addEventListener('change', update);
  update();
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!media.matches || !document.documentElement.dataset.pdfNav) return;
      if (
        event.target.closest(
          '#pdf-navigation,[data-action="thumbnails"],[data-action="bookmarks"],[data-action="search-pdf"]',
        )
      )
        return;
      closeNavigation();
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  document
    .querySelectorAll('.mobile-nav [data-mobile-pane]')
    .forEach((button) => button.addEventListener('click', () => setMobilePane(button.dataset.mobilePane)));
  // Stay on the reader after selecting: annotation actions need the same range.
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
    .querySelectorAll('.mobile-nav [data-mobile-pane]')
    .forEach((button) => button.classList.toggle('active', button.dataset.mobilePane === pane));
  if (pane === 'reader') document.dispatchEvent(new Event('reader-resize'));
}
