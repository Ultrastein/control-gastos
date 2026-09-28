// Teclado de PIN de 4 dígitos: puntos, teclas 0-9, borrar y teclado físico.
// Lo usan la pantalla de bloqueo y el alta/cambio/baja del PIN en Ajustes.
import { h, icon } from './dom.js';

const LEN = 4;

// createPinPad({onComplete(pin), extra}) -> {el, clear(), setError(msg), setBusy(bool), focus(), destroy()}
// `extra`: nodo opcional que va debajo del teclado (ej. botón de huella).
export function createPinPad({ onComplete, extra } = {}) {
  let buf = '';
  let busy = false;

  const dots = Array.from({ length: LEN }, () => h('span', { class: 'pin-dot' }));
  const status = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const error = h('p', { class: 'pin-error', role: 'alert' });
  const dotsEl = h('div', { class: 'pin-dots', role: 'img', 'aria-label': 'Dígitos ingresados: 0 de 4' }, ...dots);

  const paint = () => {
    dots.forEach((d, i) => d.classList.toggle('is-on', i < buf.length));
    dotsEl.setAttribute('aria-label', 'Dígitos ingresados: ' + buf.length + ' de ' + LEN);
  };

  const press = (d) => {
    if (busy || buf.length >= LEN) return;
    buf += d;
    error.textContent = '';
    paint();
    if (buf.length === LEN && onComplete) onComplete(buf);
  };
  const back = () => {
    if (busy || !buf.length) return;
    buf = buf.slice(0, -1);
    paint();
  };

  const key = (d) => h('button', { class: 'key pin-key', type: 'button', onclick: () => press(d) }, d);
  const keys = h('div', { class: 'pin-keys', role: 'group', 'aria-label': 'Teclado numérico' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
    h('span', { class: 'pin-key-gap', 'aria-hidden': 'true' }),
    key('0'),
    h('button', { class: 'key pin-key', type: 'button', 'aria-label': 'Borrar', onclick: back }, icon('back')));

  const el = h('div', { class: 'pinpad' }, dotsEl, status, error, keys, extra || null);

  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!el.isConnected) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); back(); }
  };
  document.addEventListener('keydown', onKey);

  return {
    el,
    clear() { buf = ''; paint(); },
    setError(msg) { error.textContent = msg || ''; },
    setBusy(b) { busy = !!b; el.classList.toggle('is-busy', busy); },
    focus() { keys.querySelector('button').focus({ preventScroll: true }); },
    destroy() { document.removeEventListener('keydown', onKey); },
  };
}

// Vibración suave si el dispositivo la tiene.
export function nudge() {
  try { if (navigator.vibrate) navigator.vibrate(120); } catch (e) { /* sin vibración */ }
}
