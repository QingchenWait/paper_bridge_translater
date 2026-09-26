import { iconButton } from './components.js';

// Native scrolling is shared by mouse, trackpad, keyboard and touch devices.
export class DocumentTabs {
  constructor(root) {
    this.root = root;
    const strip = document.createElement('div');
    strip.className = 'document-tab-strip';
    strip.innerHTML = `${iconButton('tabs-left', 'triangle', '向左滚动文件卡片', 'tab-scroll tab-scroll-left')}${iconButton('tabs-right', 'triangle', '向右滚动文件卡片', 'tab-scroll tab-scroll-right')}`;
    this.left = strip.firstElementChild;
    this.right = strip.lastElementChild;
    this.left.hidden = this.right.hidden = true;
    this.left.setAttribute('aria-controls', root.id);
    this.right.setAttribute('aria-controls', root.id);
    root.before(strip);
    strip.insertBefore(root, this.right);
    root.tabIndex = 0;
    root.setAttribute('aria-label', '已打开的文件');
    this.left.onclick = () => this.scroll(-1);
    this.right.onclick = () => this.scroll(1);
    root.addEventListener('scroll', () => this.updateEdges(), { passive: true });
    root.addEventListener('keydown', (event) => {
      if (event.target !== root) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.scroll(event.key === 'ArrowLeft' ? -1 : 1);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        root.scrollLeft = event.key === 'Home' ? 0 : root.scrollWidth;
      }
    });
    let drag,
      suppressClick = false;
    root.addEventListener('pointerdown', (event) => {
      suppressClick = false;
      if (event.pointerType !== 'mouse' || event.button !== 0 || this.right.hidden) return;
      drag = { id: event.pointerId, x: event.clientX, left: root.scrollLeft, moved: false };
    });
    root.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const delta = event.clientX - drag.x;
      if (!drag.moved && Math.abs(delta) < 5) return;
      if (!drag.moved) {
        root.setPointerCapture(event.pointerId);
        root.classList.add('dragging');
        drag.moved = suppressClick = true;
      }
      event.preventDefault();
      root.scrollLeft = drag.left - delta;
    });
    const stop = () => {
      const id = drag?.id;
      drag = null;
      root.classList.remove('dragging');
      if (id !== undefined && root.hasPointerCapture(id)) root.releasePointerCapture(id);
    };
    root.addEventListener('pointerup', stop);
    root.addEventListener('pointercancel', stop);
    root.addEventListener('lostpointercapture', stop);
    root.addEventListener('pointerleave', () => {
      if (!drag?.moved) stop();
    });
    root.addEventListener(
      'click',
      (event) => {
        if (!suppressClick || event.detail === 0) return;
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
    this.observer = new ResizeObserver(() => this.refresh());
    this.observer.observe(strip);
    this.observer.observe(root);
  }
  scroll(direction) {
    this.root.scrollBy({
      left: direction * this.root.clientWidth * 0.8,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
  updateEdges() {
    const { root } = this;
    this.left.disabled = root.scrollLeft <= 1;
    this.right.disabled = root.scrollWidth - root.clientWidth - root.scrollLeft <= 1;
  }
  refresh(activeId, scrollLeft) {
    if (activeId !== undefined && activeId !== this.activeId) {
      this.activeId = activeId;
      this.reveal = true;
    }
    if (scrollLeft !== undefined) this.savedScroll = scrollLeft;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const { root, left, right } = this;
      if (!root.clientWidth) return; // Retry through ResizeObserver when the reader becomes visible.
      const gap = parseFloat(getComputedStyle(root.parentElement).columnGap) || 0;
      const reserved = left.hidden ? 0 : left.offsetWidth + right.offsetWidth + gap * 2;
      const overflow = root.scrollWidth > root.clientWidth + reserved + 1;
      const position = this.savedScroll ?? root.scrollLeft;
      left.hidden = right.hidden = !overflow;
      // A redundant write would cancel an in-progress smooth button scroll.
      if (root.scrollLeft !== position) root.scrollLeft = position;
      this.savedScroll = undefined;
      const active = root.querySelector('.document-tab.active');
      if (this.reveal && active) {
        const viewport = root.getBoundingClientRect(),
          card = active.getBoundingClientRect();
        if (card.right > viewport.right) root.scrollLeft += card.right - viewport.right;
        else if (card.left < viewport.left) root.scrollLeft += card.left - viewport.left;
      }
      this.reveal = false;
      this.updateEdges();
    });
  }
}
