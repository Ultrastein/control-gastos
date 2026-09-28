// Arranque: base de datos -> router -> pantalla. El resto de la Fase 1 cuelga de acá.
import { openDB, dbEvents, getSetting, generateRecurring, listCategories, pruneReceipts } from './db.js';
import { todayISO } from './utils/dates.js';
import { formatMoney } from './utils/money.js';
import { parseQuickAdd } from './utils/quickAdd.js';
import { registerRoute, start, rerender } from './ui/router.js';
import { openSheet, saveNewMovement, notifyBudget } from './ui/sheet.js';
import { centsToBuffer } from './ui/keypad.js';
import * as resumen from './ui/resumen.js';
import * as historial from './ui/historial.js';
import * as presupuestos from './ui/presupuestos.js';
import * as ajustes from './ui/ajustes.js';
import * as categorias from './ui/categorias.js';
import * as fijos from './ui/fijos.js';
import * as analisis from './ui/analisis.js';
import * as reportes from './ui/reportes.js';
import { h } from './ui/dom.js';
import { openModal } from './ui/modal.js';
import { showSnackbar } from './ui/snackbar.js';
import { initLock, isLocked } from './ui/lock.js';
import { applyTheme } from './ui/theme.js';
import { isNative, takeLink, pushWidget } from './io/native.js';

// Pantalla #/dev-seed (solo se registra en localhost / 127.0.0.1).
function renderDevSeed(container) {
  // La pantalla se redibuja con cada escritura en la base: el resultado va en el aviso, no en el DOM.
  const run = async () => {
    showSnackbar({ text: 'Cargando datos de prueba…', ms: 60000 });
    try {
      const mod = await import('./dev/seed.js');
      const n = await mod.seedDemo();
      showSnackbar({ text: 'Listo: datos de prueba cargados' + (Number.isFinite(n) ? ' (' + n + ' movimientos).' : '.') });
    } catch (e) {
      showSnackbar({ text: 'No se pudieron cargar los datos de prueba.' });
    }
  };
  const ask = () => {
    let close = () => {};
    const panel = h('div', { class: 'sheet' },
      h('h2', { class: 'sheet-title' }, 'Cargar datos de prueba'),
      h('p', null, 'Suma movimientos, gastos fijos y presupuestos de ejemplo a lo que ya tenés.'),
      h('div', { class: 'form-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'),
        h('button', { class: 'btn btn-primary grow', type: 'button', onclick: () => { close(); run(); } }, 'Cargar')));
    close = openModal(panel, { label: 'Cargar datos de prueba' });
  };
  const btn = h('button', { class: 'btn btn-primary', type: 'button', onclick: ask }, 'Cargar datos de prueba');
  container.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Datos de prueba')),
    h('p', { class: 'row-sub wrap' }, 'Solo para desarrollo: genera 6 meses de movimientos de ejemplo.'),
    h('div', { class: 'empty' }, btn),
    h('a', { class: 'btn btn-ghost', href: '#/resumen' }, 'Ir al resumen'));
}

// #/quick-add?type&amount&cat&method&installments&note (atajos, widgets, "Añadir a inicio").
// Completo (monto + categoría) -> guarda directo, sin confirmar, con Deshacer. Incompleto -> hoja pre-llenada.
async function runQuickAdd(search) {
  const [cats, cur] = await Promise.all([listCategories(), getSetting('defaultCurrency', 'ARS')]);
  const { complete, draft } = parseQuickAdd(search, cats);
  const n = draft.type === 'expense' && draft.method === 'credito' ? draft.installments : 1;
  if (!complete || (n > 1 && draft.amount < n)) {
    openSheet({
      prefill: {
        type: draft.type, categoryId: draft.categoryId, note: draft.note, method: draft.method,
        installments: draft.installments, buffer: draft.amount ? centsToBuffer(draft.amount) : '',
      },
    });
    return;
  }
  const data = {
    type: draft.type, amount: draft.amount, currency: cur, categoryId: draft.categoryId,
    date: todayISO(), note: draft.note, paymentMethod: draft.method,
  };
  try {
    const { list, undo } = await saveNewMovement(data, n);
    const cat = cats.find((c) => c.id === data.categoryId);
    showSnackbar({
      text: (data.type === 'income' ? 'Ingreso' : 'Gasto') + ' cargado: ' + formatMoney(data.amount, cur) + ' en ' + (cat ? cat.name : 'la categoría') +
        (n > 1 ? ' (' + n + ' cuotas)' : ''),
      actionLabel: 'Deshacer',
      onAction: undo,
    });
    if (data.type === 'expense') notifyBudget(list[0], cats, undo);
  } catch (e) {
    showSnackbar({ text: 'No se pudo cargar el gasto.' });
  }
}

// Si el hash es #/quick-add, devuelve su query y deja la URL en #/resumen (recargar no repite el gasto).
function takeQuickAdd() {
  const m = /^#\/quick-add(?:\?(.*))?$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + '#/resumen');
  return m[1] || '';
}

function fatal(msg) {
  const view = document.getElementById('view');
  const box = document.createElement('div');
  box.className = 'empty';
  const t = document.createElement('h2');
  t.textContent = 'No pudimos abrir la app';
  const p = document.createElement('p');
  p.textContent = msg;
  box.append(t, p);
  view.replaceChildren(box);
}

// Service Worker: registra ./sw.js y avisa si hay una versión nueva esperando.
// Nunca recarga solo: recién al tocar "Actualizar" se manda SKIP_WAITING y se recarga en 'controllerchange'.
function setupServiceWorker() {
  // En la app de iPhone los archivos ya vienen adentro: no hace falta (y WKWebView no lo soporta).
  if (!('serviceWorker' in navigator) || isNative()) return;
  let wantsUpdate = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!wantsUpdate || reloading) return;
    reloading = true;
    location.reload();
  });

  const offer = (worker) => {
    showSnackbar({
      text: 'Hay una versión nueva.',
      actionLabel: 'Actualizar',
      ms: 0,
      sticky: true,
      onAction: () => { wantsUpdate = true; worker.postMessage({ type: 'SKIP_WAITING' }); },
    });
  };

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Solo es "actualización" si ya había un controlador: en la primera instalación no se avisa nada.
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) offer(nw);
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => { /* sin SW la app sigue funcionando, solo que sin modo offline */ });
}

async function main() {
  try {
    await openDB();
  } catch (e) {
    fatal('Tu navegador no dejó abrir el almacenamiento local. Revisá que no estés en modo privado.');
    return;
  }

  // Tema: 'auto' (default, sigue al sistema), 'light' o 'dark'. Se cambia desde Ajustes.
  try {
    applyTheme(await getSetting('theme', 'auto'));
  } catch (e) { /* queda en automático */ }

  // Bloqueo con PIN: si hay PIN, no se dibuja ni se lee ningún dato hasta desbloquear.
  let pendingQuick = null; // quick-add que llegó con la app bloqueada: se ejecuta al desbloquear
  await initLock({
    onUnlock: () => {
      rerender();
      if (pendingQuick !== null) { const q = pendingQuick; pendingQuick = null; runQuickAdd(q).catch(() => {}); }
    },
  });

  // Carga los gastos fijos vencidos antes del primer render (si falla, la app sigue igual).
  try {
    await generateRecurring(todayISO());
  } catch (e) { /* se reintenta en el próximo arranque */ }
  // Fotos de recibos de movimientos ya borrados (se guardan hasta acá para que Deshacer las recupere).
  pruneReceipts().catch(() => {});

  registerRoute('/resumen', resumen.render, { title: 'Resumen' });
  registerRoute('/historial', historial.render, { title: 'Historial' });
  registerRoute('/presupuestos', presupuestos.render, { title: 'Presupuestos' });
  registerRoute('/ajustes', ajustes.render, { title: 'Ajustes' });
  registerRoute('/categorias', categorias.render, { title: 'Categorías', section: '/ajustes' });
  registerRoute('/fijos', fijos.render, { title: 'Gastos fijos', section: '/ajustes' });
  registerRoute('/analisis', analisis.render, { title: 'Análisis', section: '/resumen' });
  registerRoute('/reportes', reportes.render, { title: 'Reportes', section: '/resumen' });

  // Solo en desarrollo: cargar datos de prueba. En otros hosts la ruta no existe y seed.js nunca se pide.
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    registerRoute('/dev-seed', renderDevSeed, { title: 'Datos de prueba', section: '/ajustes' });
  }

  document.getElementById('fab').addEventListener('click', () => openSheet());

  // Cualquier escritura en la base redibuja la pantalla actual (agrupado por si vienen varias juntas).
  let pending = null;
  let widgetTimer = null;
  dbEvents.addEventListener('change', () => {
    clearTimeout(pending);
    pending = setTimeout(() => rerender(), 30);
    // App de iPhone: el widget se actualiza con cada cambio (agrupado).
    clearTimeout(widgetTimer);
    widgetTimer = setTimeout(() => pushWidget(), 800);
  });

  // Antes de arrancar el router: al abrir directo en #/quick-add se limpia la URL y se carga después del primer render.
  const bootQuick = takeQuickAdd();
  // Con la app ya abierta: se registra antes que el del router para leer el hash antes de que lo reemplace.
  window.addEventListener('hashchange', () => {
    const q = takeQuickAdd();
    if (q === null) return;
    if (isLocked()) pendingQuick = q;
    else runQuickAdd(q).catch(() => {});
  });

  await start(document.getElementById('view'));
  if (bootQuick !== null) runQuickAdd(bootQuick).catch(() => {});
  setupServiceWorker();

  // App de iPhone: enlace gastos:// con el que se abrió (widget o Centro de control) y datos del widget.
  if (isNative()) {
    const link = await takeLink();
    if (link) location.hash = link; // #/quick-add lo toma el hashchange de arriba
    pushWidget();
  }
}

main();
