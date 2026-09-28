// Pantalla de bloqueo con PIN. Es un candado de pantalla: no cifra los datos.
// Se muestra al abrir (si hay PIN) y al volver de segundo plano tras más de 1 minuto.
// No usa history.pushState: Atrás nunca la saltea porque tapa todo y el fondo queda inerte.
import { getSetting } from '../db.js';
import { verifyPin } from '../utils/pin.js';
import { shouldLock } from '../utils/lock.js';
import { isAvailable, authenticate } from '../io/biometric.js';
import { h } from './dom.js';
import { createPinPad, nudge } from './pinpad.js';
import { hasOpenModal } from './modal.js';

const BEHIND = ['app', 'modal-root', 'snackbar']; // lo que queda inerte mientras se pide el PIN

let cred = { salt: null, hash: null }; // PIN vigente (en memoria, para decidir sin esperar a la base)
let hiddenAt = null;                   // cuándo pasó a segundo plano (solo en memoria)
let current = null;                    // {layer, pad, promise, resolve, prevFocus}
let onUnlockCb = null;

export function isLocked() {
  return current !== null;
}

const hasPin = () => typeof cred.hash === 'string' && cred.hash !== '' && typeof cred.salt === 'string' && cred.salt !== '';

// Vuelve a leer el PIN de la base (Ajustes lo llama tras activar, cambiar o quitar).
export async function reloadLock() {
  const [salt, hash] = await Promise.all([getSetting('pinSalt', null), getSetting('pinHash', null)]);
  cred = { salt, hash };
}

function setBehindInert(on) {
  for (const id of BEHIND) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.inert = on;
    if (on) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  }
  document.body.classList.toggle('is-locked', on);
}

function unlock() {
  const c = current;
  if (!c) return;
  current = null;
  hiddenAt = null;
  c.pad.destroy();
  c.layer.remove();
  setBehindInert(false);
  const app = document.getElementById('app');
  if (app && hasOpenModal()) app.inert = true; // si había una hoja abierta, sigue tapando el fondo
  const back = c.prevFocus && c.prevFocus.isConnected ? c.prevFocus : document.getElementById('view');
  if (back && typeof back.focus === 'function') back.focus({ preventScroll: true });
  if (onUnlockCb) onUnlockCb();
  c.resolve();
}

// Muestra el bloqueo. Devuelve una promesa que se resuelve al desbloquear.
function lock() {
  if (current) return current.promise;
  let resolve;
  const promise = new Promise((r) => { resolve = r; });

  const bioBtn = h('button', { class: 'btn btn-ghost pin-bio', type: 'button', hidden: true }, 'Usar huella / Face ID');
  const sub = h('p', { class: 'lock-sub' }, 'Ingresá tu PIN para entrar');
  const snapshot = { salt: cred.salt, hash: cred.hash };

  const pad = createPinPad({
    extra: bioBtn,
    onComplete: async (pin) => {
      pad.setBusy(true);
      let ok = false;
      try { ok = await verifyPin(pin, snapshot.salt, snapshot.hash); } catch (e) { ok = false; }
      if (ok) { unlock(); return; }
      pad.clear();
      pad.setError('PIN incorrecto. Probá de nuevo.');
      pad.el.classList.remove('is-shake');
      void pad.el.offsetWidth; // reinicia la animación
      pad.el.classList.add('is-shake');
      nudge();
      pad.setBusy(false);
    },
  });

  const layer = h('div', { class: 'lock', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lock-title', tabindex: '-1' },
    h('div', { class: 'lock-card' },
      h('h1', { id: 'lock-title', class: 'lock-title' }, 'Control de gastos'),
      sub,
      pad.el));

  current = { layer, pad, promise, resolve, prevFocus: document.activeElement };
  setBehindInert(true);
  document.getElementById('lock-root').append(layer);
  layer.focus({ preventScroll: true });

  // Huella / Face ID: solo si hay credencial guardada y el dispositivo la soporta. El PIN siempre queda.
  (async () => {
    try {
      const id = await getSetting('biometricCredentialId', null);
      if (!id || !(await isAvailable()) || current === null || current.layer !== layer) return;
      bioBtn.hidden = false;
      bioBtn.addEventListener('click', async () => {
        bioBtn.disabled = true;
        let ok = false;
        try { ok = await authenticate(); } catch (e) { ok = false; }
        if (ok) { unlock(); return; }
        bioBtn.disabled = false;
        pad.setError('No se pudo con la huella. Usá tu PIN.');
      });
    } catch (e) { /* sin biometría: queda el PIN */ }
  })();

  return promise;
}

// Arranque: lee el PIN, engancha visibilitychange y, si hay PIN, espera el desbloqueo.
// opts.onUnlock se llama cada vez que se desbloquea (para redibujar la pantalla).
export async function initLock({ onUnlock } = {}) {
  onUnlockCb = onUnlock || null;
  try { await reloadLock(); } catch (e) { cred = { salt: null, hash: null }; }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (!current) hiddenAt = Date.now();
      return;
    }
    if (current || hiddenAt === null) return;
    if (shouldLock({ hasPin: hasPin(), lastActiveAt: hiddenAt, now: Date.now() })) lock();
    else hiddenAt = null;
  });

  if (hasPin()) await lock();
}
