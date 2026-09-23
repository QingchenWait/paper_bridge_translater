import { esc } from '../utils.js';
const icons = import.meta.glob('../../_logo/icons/*.svg', { eager: true, query: '?url', import: 'default' });
const art = import.meta.glob('../../_logo/art/*.png', { eager: true, query: '?url', import: 'default' });
export const icon = (name, extra = '') =>
  `<img class="icon ${extra}" src="${icons[`../../_logo/icons/${name}.svg`] || icons['../../_logo/icons/file-text.svg']}" alt="" draggable="false">`;
const providerLogos = import.meta.glob('../../_logo/llms/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
export const providerLogo = (id) =>
  providerLogos[`../../_logo/llms/${id}.svg`]
    ? `<img class="icon provider-logo" src="${providerLogos[`../../_logo/llms/${id}.svg`]}" alt="" draggable="false">`
    : icon('settings-2');
export const illustration = (name) => art[`../../_logo/art/${name}.png`] || '';
export const button = (action, name, label, className = '') =>
  `<button type="button" class="button ${className}" data-action="${action}">${icon(name)}<span>${label}</span></button>`;
export const iconButton = (action, name, label, className = '') =>
  `<button type="button" class="icon-button ${className}" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}">${icon(name)}</button>`;
export function select(id, options, value, label = '', className = '') {
  const selected = options.find((option) => String(option[0]) === String(value)) || options[0];
  return `<div class="custom-select ${className}" data-select="${id}" data-value="${esc(selected?.[0] || '')}"><button type="button" class="select-trigger" aria-label="${esc(label || id)}" aria-haspopup="listbox" aria-expanded="false"><span>${esc(selected?.[1] || '请选择')}</span>${icon('chevron-down')}</button><div class="select-menu" role="listbox" aria-label="${esc(label || id)}" hidden>${options.map(([key, text]) => `<button type="button" role="option" aria-selected="${String(key) === String(selected?.[0])}" data-value="${esc(key)}">${esc(text)}</button>`).join('')}</div></div>`;
}
export const selected = (id) => document.querySelector(`[data-select="${id}"]`)?.dataset.value;
export function bindSelects(root = document) {
  root.querySelectorAll('.custom-select').forEach((element) => {
    const trigger = element.querySelector('.select-trigger');
    const menu = element.querySelector('.select-menu');
    trigger.onclick = (event) => {
      event.stopPropagation();
      const open = menu.hidden;
      closeMenus();
      menu.hidden = !open;
      trigger.setAttribute('aria-expanded', String(open));
      if (open) menu.querySelector('[aria-selected="true"]')?.focus();
    };
    menu.onclick = (event) => {
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      element.dataset.value = option.dataset.value;
      trigger.querySelector('span').textContent = option.textContent;
      menu
        .querySelectorAll('[role="option"]')
        .forEach((el) => el.setAttribute('aria-selected', String(el === option)));
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
      element.dispatchEvent(new CustomEvent('valuechange', { bubbles: true, detail: option.dataset.value }));
    };
    menu.onkeydown = (event) => {
      const options = [...menu.querySelectorAll('button')];
      const index = options.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        options[(index + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length]?.focus();
      }
      if (event.key === 'Escape') {
        closeMenus();
        trigger.focus();
      }
    };
  });
}
export function closeMenus() {
  document.querySelectorAll('.select-menu').forEach((menu) => (menu.hidden = true));
  document
    .querySelectorAll('.select-trigger')
    .forEach((trigger) => trigger.setAttribute('aria-expanded', 'false'));
}
document.addEventListener('click', (event) => {
  if (!event.target.closest('.custom-select')) closeMenus();
});
export function toast(message, type = 'info') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `${icon(type === 'error' ? 'circle-alert' : 'check')}<span>${esc(message)}</span>`;
  document.getElementById('toast-root').append(element);
  setTimeout(() => element.remove(), type === 'error' ? 12000 : 4500);
}
let activeClose;
export function modal(title, body, { wide = false, closable = true, onClose } = {}) {
  activeClose?.();
  const previous = document.activeElement;
  const root = document.getElementById('overlay-root');
  root.innerHTML = `<div class="modal-backdrop"><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><div><p class="eyebrow">PAPER BRIDGE</p><h2 id="modal-title">${esc(title)}</h2></div>${closable ? iconButton('close-modal', 'x', '关闭') : ''}</header><div class="modal-body">${body}</div></section></div>`;
  const element = root.querySelector('.modal');
  const close = () => {
    document.removeEventListener('keydown', key);
    if (root.contains(element)) {
      root.replaceChildren();
      activeClose = null;
    }
    previous?.focus();
    onClose?.();
  };
  const key = (event) => {
    if (event.key === 'Escape' && closable) close();
    if (event.key === 'Tab') {
      const focusable = [...element.querySelectorAll('button,input,textarea,a[href]')].filter(
        (el) => !el.disabled && el.getClientRects().length,
      );
      if (!focusable.length) return;
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', key);
  root.querySelector('[data-action="close-modal"]')?.addEventListener('click', close);
  root.querySelector('.modal-backdrop').addEventListener('pointerdown', (event) => {
    if (event.target.classList.contains('modal-backdrop') && closable) close();
  });
  activeClose = close;
  bindSelects(element);
  setTimeout(() => element.querySelector('input,button,textarea')?.focus(), 50);
  return { element, close };
}
export function anchoredPopover(anchor, title, body) {
  const dialog = modal(title, body);
  const backdrop = dialog.element.parentElement;
  backdrop.classList.add('anchored-backdrop');
  dialog.element.classList.add('translation-popover');
  const position = () => {
    const bounds = anchor.getBoundingClientRect();
    const width = Math.min(360, innerWidth - 20);
    dialog.element.style.width = `${width}px`;
    dialog.element.style.left = `${Math.max(10, Math.min(innerWidth - width - 10, bounds.right - width))}px`;
    dialog.element.style.top = `${bounds.bottom + 8}px`;
    dialog.element.style.maxHeight = `${Math.max(120, innerHeight - bounds.bottom - 18)}px`;
  };
  position();
  window.addEventListener('resize', position);
  const close = dialog.close;
  // Every modal close path (outside click / Escape / close button) removes listeners.
  const observer = new MutationObserver(() => {
    if (!dialog.element.isConnected) {
      window.removeEventListener('resize', position);
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('overlay-root'), { childList: true });
  return { ...dialog, close };
}
export function inputDialog(
  title,
  { value = '', multiline = false, password = false, remove = false, label = '内容' } = {},
) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
      dialog.close();
    };
    const dialog = modal(
      title,
      `<form id="input-form"><label class="field"><span>${esc(label)}</span>${multiline ? `<textarea name="value" rows="5">${esc(value)}</textarea>` : `<input name="value" type="${password ? 'password' : 'text'}" value="${esc(value)}" autocomplete="off">`}</label><div class="modal-actions">${remove ? button('remove-input', 'trash-2', '删除', 'danger') : ''}<button type="submit" class="button primary">${icon('check')}保存</button></div></form>`,
      {
        onClose: () => {
          if (!settled) resolve(null);
        },
      },
    );
    dialog.element.querySelector('form').onsubmit = (event) => {
      event.preventDefault();
      finish(new FormData(event.target).get('value'));
    };
    dialog.element
      .querySelector('[data-action="remove-input"]')
      ?.addEventListener('click', () => finish({ deleted: true }));
  });
}
