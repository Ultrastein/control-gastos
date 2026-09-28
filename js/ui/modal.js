// Modales y hojas con history.pushState: el botón Atrás cierra primero el modal de arriba.
// Cada entrada del historial guarda {modalDepth}; popstate cierra hasta esa profundidad.

const stack = [];

// Si se recargó con un estado de modal viejo, lo limpiamos.
if (history.state && history.state.modalDepth) history.replaceState(null, '');

function layerRoot() {
  return document.getElementById('modal-root');
}

function syncBackground() {
  const app = document.getElementById('app');
  if (app) app.inert = stack.length > 0; // fondo sin foco ni lectura mientras hay modal
  document.body.classList.toggle('modal-open', stack.length > 0);
}

// Quita entradas (de arriba hacia abajo), avisa y devuelve el foco al elemento previo.
function finalize(removed) {
  for (let i = removed.length - 1; i >= 0; i--) {
    const e = removed[i];
    e.closed = true;
    e.layer.remove();
    if (e.onClose) e.onClose();
  }
  syncBackground();
  const first = removed[0];
  if (first && first.prevFocus && first.prevFocus.isConnected && typeof first.prevFocus.focus === 'function') {
    first.prevFocus.focus({ preventScroll: true });
  }
}

function closeEntry(entry) {
  const idx = stack.indexOf(entry);
  if (entry.closed || idx < 0) return;
  const removed = stack.splice(idx);
  finalize(removed);
  history.go(-removed.length); // popstate llega con stack ya recortado: no hace nada
}

// `el` es el panel; opts: {label, onClose, dismissible=true}. Devuelve close().
export function openModal(el, opts = {}) {
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  layer.append(el);

  const entry = { el, layer, onClose: opts.onClose, prevFocus: document.activeElement, closed: false };
  const close = () => closeEntry(entry);

  if (opts.dismissible !== false) {
    // Cierra al tocar el fondo, pero no si arrastraste desde adentro del panel.
    let armed = false;
    layer.addEventListener('pointerdown', (e) => { armed = e.target === layer; });
    layer.addEventListener('click', (e) => { if (armed && e.target === layer) close(); armed = false; });
  }

  history.pushState({ modalDepth: stack.length + 1 }, '');
  stack.push(entry);
  layerRoot().append(layer);
  syncBackground();
  el.focus({ preventScroll: true });
  return close;
}

export function hasOpenModal() {
  return stack.length > 0;
}

window.addEventListener('popstate', () => {
  const depth = (history.state && history.state.modalDepth) || 0;
  if (stack.length > depth) finalize(stack.splice(depth));
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  e.preventDefault();
  closeEntry(stack[stack.length - 1]);
});
