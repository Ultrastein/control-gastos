// Router por hash. Cada pantalla: render(container, params) -> limpieza opcional (puede ser async).
// El render va a un contenedor aparte y se intercambia al terminar: sin parpadeo al re-renderizar.

const routes = new Map();
const DEFAULT_PATH = '/resumen';
let view = null;
let cleanup = null;
let token = 0;
let guard = null; // si devuelve true (ej. app bloqueada), no se dibuja nada

// opts: {title, section} — section = ruta del ítem de navegación que queda activo.
export function registerRoute(path, fn, opts = {}) {
  routes.set(path, { fn, title: opts.title || '', section: opts.section || path });
}

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#/, '');
  const [p, q = ''] = raw.split('?');
  const path = p.startsWith('/') ? p : '/' + p;
  return { path, params: Object.fromEntries(new URLSearchParams(q)) };
}

export function navigate(hash) {
  const target = hash.startsWith('#') ? hash : '#' + hash;
  if (location.hash === target) show(false);
  else location.hash = target;
}

export function setGuard(fn) {
  guard = fn;
}

export function start(el) {
  view = el;
  window.addEventListener('hashchange', () => show(false));
  return show(false);
}

// Vuelve a dibujar la pantalla actual conservando scroll y foco (data-fk).
export function rerender() {
  return show(true);
}

function errorBox() {
  const box = document.createElement('div');
  box.className = 'empty';
  const t = document.createElement('h2');
  t.textContent = 'No pudimos cargar esta pantalla';
  const p = document.createElement('p');
  p.textContent = 'Probá recargar la página.';
  box.append(t, p);
  return box;
}

async function show(isRerender) {
  if (!view || (guard && guard())) return;
  const mine = ++token;
  let { path, params } = parseHash();
  let route = routes.get(path);
  if (!route) {
    path = DEFAULT_PATH;
    route = routes.get(path);
    if (!route) return;
    history.replaceState(null, '', '#' + path);
    params = {};
  }

  const y = window.scrollY;
  const focusKey = isRerender && document.activeElement && view.contains(document.activeElement)
    ? document.activeElement.dataset.fk : null;

  const inner = document.createElement('div');
  let result = null;
  try {
    result = await route.fn(inner, params);
  } catch (e) {
    inner.replaceChildren(errorBox());
  }
  if (mine !== token) { // llegó otra navegación mientras cargaba
    if (typeof result === 'function') result();
    return;
  }
  if (typeof cleanup === 'function') cleanup();
  cleanup = typeof result === 'function' ? result : null;
  view.replaceChildren(inner);

  if (isRerender) {
    window.scrollTo(0, y);
    if (focusKey) {
      const el = view.querySelector('[data-fk="' + CSS.escape(focusKey) + '"]');
      if (el) el.focus({ preventScroll: true });
    }
  } else {
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }

  document.title = route.title ? route.title + ' · Control de gastos' : 'Control de gastos';
  for (const a of document.querySelectorAll('.nav a[data-section]')) {
    if (a.dataset.section === route.section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}
