// Teclado numérico propio (0-9, coma, borrar, Guardar) + soporte de teclado físico.
import { keypadPress, keypadToCents } from '../utils/money.js';
import { h, icon } from './dom.js';

// "1234,5" -> "1.234,5" (solo para mostrar mientras se tipea).
export function formatBuffer(buf) {
  const [int = '', dec] = String(buf || '').split(',');
  const miles = (int === '' ? '0' : int).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === undefined ? miles : miles + ',' + dec;
}

// Centavos -> buffer editable: 12350 -> "123,5".
export function centsToBuffer(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0));
  const units = Math.floor(n / 100);
  const dec = String(n % 100).padStart(2, '0').replace(/0+$/, '');
  return String(units) + (dec ? ',' + dec : '');
}

// createKeypad({initial, onChange(buf), onSubmit, submitLabel}) -> {el, press, set, submit, buffer, cents}
export function createKeypad({ initial = '', onChange, onSubmit, submitLabel = 'Guardar' } = {}) {
  let buf = initial;

  const press = (key) => {
    const next = keypadPress(buf, key);
    if (next === buf) return;
    buf = next;
    if (onChange) onChange(buf);
  };
  const key = (k, label, aria) => h('button', {
    class: 'key',
    type: 'button',
    'aria-label': aria,
    onclick: () => press(k),
  }, label);

  const submit = () => { if (onSubmit) onSubmit(); };

  const el = h('div', { class: 'keypad', role: 'group', 'aria-label': 'Teclado numérico' },
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, d)),
    key(',', ',', 'Coma decimal'),
    key('0', '0'),
    h('button', { class: 'key', type: 'button', 'aria-label': 'Borrar', onclick: () => press('back') }, icon('back')),
    h('button', { class: 'key key-submit', type: 'button', onclick: submit }, submitLabel));

  return {
    el,
    press,
    submit,
    set(next) { buf = next; if (onChange) onChange(buf); },
    get buffer() { return buf; },
    get cents() { return keypadToCents(buf); },
  };
}

// Teclado físico: dígitos, coma/punto, Backspace, Enter. (Esc lo cierra modal.js.)
// No pisa lo que se escribe en otros campos (fecha, nota, selects). Devuelve detach().
export function attachKeyboard(kp, { amountEl } = {}) {
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    const writing = t !== amountEl && (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable));
    if (writing) return;

    let k = null;
    if (/^[0-9]$/.test(e.key)) k = e.key;
    else if (e.key === ',' || e.key === '.') k = ',';
    else if (e.key === 'Backspace') k = 'back';
    if (k) {
      e.preventDefault();
      kp.press(k);
      return;
    }
    // En un botón, Enter lo activa el propio botón.
    if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'A') {
      e.preventDefault();
      kp.submit();
    }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
