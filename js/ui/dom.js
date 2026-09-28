// Helpers de DOM. Todo texto entra como nodo de texto / textContent: nunca innerHTML.
// Nada de style="": los colores dinámicos van con `vars` (element.style.setProperty).

const SVG_NS = 'http://www.w3.org/2000/svg';
// Props que se asignan como propiedad (no como atributo).
const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'required']);

function applyProps(el, props) {
  if (!props) return;
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') continue; // prohibido por CSP: usar `vars`
    if (k === 'vars') {
      for (const [name, val] of Object.entries(v)) el.style.setProperty(name, val);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (k === 'class' || k === 'className') {
      if (v) el.setAttribute('class', v);
    } else if (k === 'text') {
      el.textContent = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (PROP_KEYS.has(k)) {
      if (v != null) el[k] = v;
    } else if (v != null && v !== false) {
      el.setAttribute(k, v === true ? '' : String(v));
    }
  }
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

// h('div', {class:'x', onclick: fn}, 'texto', otroNodo)
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  appendChildren(el, children);
  applyProps(el, props); // después de los hijos, para que `value` de un select funcione
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  appendChildren(el, children);
  applyProps(el, props);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chevron: 'M9 5l7 7-7 7',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
};

export function icon(name) {
  return svg('svg', { class: 'icon', viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': 'true', focusable: 'false' },
    svg('path', { d: ICONS[name] || '' }));
}

// Círculo con el emoji de la categoría; el color va como variable CSS.
export function setBadge(el, cat) {
  el.textContent = cat.emoji || '📦';
  el.style.setProperty('--cat', cat.color || '#6B7280');
  return el;
}
export function catBadge(cat) {
  return setBadge(h('span', { class: 'cat-badge', 'aria-hidden': 'true' }), cat);
}

// Estado vacío: {title, text, actionLabel, onAction}
export function emptyState({ title, text, actionLabel, onAction }) {
  return h('div', { class: 'empty' },
    h('h2', null, title),
    text ? h('p', null, text) : null,
    actionLabel ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onAction }, actionLabel) : null);
}
