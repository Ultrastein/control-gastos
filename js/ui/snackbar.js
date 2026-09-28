// Aviso corto abajo, con acción opcional (ej. Deshacer). Uno a la vez.
// ms = 0 -> no se va solo (queda hasta que lo toquen). `sticky: true` lo recuerda: si otro aviso
// lo tapa, vuelve a aparecer cuando ese termina (lo usa "Hay una versión nueva").
import { h } from './dom.js';

let timer = null;
let sticky = null;

function root() {
  return document.getElementById('snackbar');
}

function clearCurrent() {
  clearTimeout(timer);
  timer = null;
  const r = root();
  if (r) r.replaceChildren();
}

function draw(cfg) {
  clearCurrent();
  const { text, actionLabel, onAction, ms = 5000 } = cfg;
  const isSticky = cfg === sticky;
  const el = h('div', { class: 'snackbar' },
    h('span', { class: 'snackbar-text' }, text),
    actionLabel
      ? h('button', {
        class: 'snackbar-action',
        type: 'button',
        onclick: () => { if (isSticky) sticky = null; clearCurrent(); if (onAction) onAction(); },
      }, actionLabel)
      : null);
  root().replaceChildren(el);
  if (ms > 0) timer = setTimeout(hideSnackbar, ms);
}

// Oculta el aviso actual (si había uno pegajoso pendiente, vuelve a mostrarlo).
export function hideSnackbar() {
  clearCurrent();
  if (sticky) draw(sticky);
}

// showSnackbar({text, actionLabel, onAction, ms=5000, sticky}) -> hide()
export function showSnackbar(cfg) {
  sticky = cfg.sticky ? cfg : sticky;
  draw(cfg);
  return () => { if (cfg === sticky) sticky = null; if (root().firstChild) hideSnackbar(); };
}
