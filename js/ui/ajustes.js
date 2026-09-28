// Ajustes: datos y backup, seguridad (PIN + huella), apariencia, atajos/widgets e instalación.
// Secciones planas, sin menús dentro de menús. Los pasos largos (PIN, importar) van en hojas modales.
import { getSetting, setSetting, listCategories } from '../db.js';
import { buildQuickAddUrl } from '../utils/quickAdd.js';
import { parseMoney } from '../utils/money.js';
import { toNativeLink } from '../utils/widgetData.js';
import { isNative } from '../io/native.js';
import { hashPin, verifyPin, newSalt } from '../utils/pin.js';
import { exportBackup, importBackup, importConfirmed } from '../io/backup.js';
import { exportCSV } from '../io/csv.js';
import { isAvailable, register } from '../io/biometric.js';
import { h, icon } from './dom.js';
import { openModal } from './modal.js';
import { showSnackbar } from './snackbar.js';
import { createPinPad, nudge } from './pinpad.js';
import { reloadLock } from './lock.js';
import { applyTheme } from './theme.js';

const DAY_MS = 86400000;
const THEMES = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']];
const CURRENCY_OPTIONS = [['ARS', 'ARS'], ['USD', 'USD'], ['EUR', 'EUR']];

// "Último backup: hace 3 días" / "hoy" / "nunca".
function lastBackupText(ts) {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return 'Último backup: nunca';
  const days = Math.max(0, Math.floor((Date.now() - ts) / DAY_MS));
  if (days === 0) return 'Último backup: hoy';
  return 'Último backup: hace ' + days + (days === 1 ? ' día' : ' días');
}

// "2026-09-21T10:00:00.000Z" -> "21/09/2026" (solo la parte de fecha, sin husos).
function backupDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '/' + m[2] + '/' + m[1] : 'sin fecha';
}

function section(id, title, ...children) {
  return h('section', { class: 'set-section', 'aria-labelledby': id },
    h('h2', { id, class: 'set-title' }, title),
    h('div', { class: 'set-card' }, ...children));
}

function linkRow(href, title, sub) {
  return h('li', null,
    h('a', { class: 'row', href },
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, title),
        h('span', { class: 'row-sub' }, sub)),
      icon('chevron')));
}

// Hoja simple con un mensaje y un botón.
function openNotice(title, text) {
  let close = () => {};
  const panel = h('div', { class: 'sheet' },
    h('h2', { class: 'sheet-title' }, title),
    h('p', { class: 'wrap' }, text),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn btn-primary grow', type: 'button', onclick: () => close() }, 'Entendido')));
  close = openModal(panel, { label: title });
}

// ---------- PIN ----------

// mode: 'set' | 'change' | 'remove'. Cambiar y quitar piden primero el PIN actual.
function openPinFlow(mode) {
  const steps = mode === 'set' ? ['new', 'confirm'] : mode === 'change' ? ['current', 'new', 'confirm'] : ['current'];
  const titles = { set: 'Activar PIN', change: 'Cambiar PIN', remove: 'Quitar PIN' };
  const prompts = {
    current: 'Ingresá tu PIN actual',
    new: 'Elegí un PIN de 4 dígitos',
    confirm: 'Repetí el PIN para confirmarlo',
  };
  let i = 0;
  let first = null;
  let close = () => {};

  const prompt = h('p', { class: 'pin-prompt', role: 'status' }, prompts[steps[0]]);
  const pad = createPinPad({ onComplete: (pin) => onPin(pin) });

  const goto = (n) => { i = n; prompt.textContent = prompts[steps[i]]; pad.clear(); };

  const finish = async (fn, okText) => {
    try {
      await fn();
      await reloadLock();
      close();
      showSnackbar({ text: okText });
    } catch (e) {
      pad.clear();
      pad.setError('No se pudo guardar. Probá de nuevo.');
      pad.setBusy(false);
    }
  };

  async function onPin(pin) {
    pad.setBusy(true);
    const step = steps[i];
    if (step === 'current') {
      let ok = false;
      try {
        const [salt, hash] = await Promise.all([getSetting('pinSalt', null), getSetting('pinHash', null)]);
        ok = await verifyPin(pin, salt, hash);
      } catch (e) { ok = false; }
      if (!ok) {
        pad.clear();
        pad.setError('PIN incorrecto. Probá de nuevo.');
        nudge();
        pad.setBusy(false);
        return;
      }
      if (mode === 'remove') {
        await finish(async () => {
          await setSetting('biometricCredentialId', null);
          await setSetting('pinHash', null);
          await setSetting('pinSalt', null);
        }, 'PIN quitado.');
        return;
      }
      goto(i + 1);
    } else if (step === 'new') {
      first = pin;
      goto(i + 1);
    } else if (pin !== first) {
      first = null;
      goto(steps.indexOf('new'));
      pad.setError('Los PIN no coinciden. Elegí uno de nuevo.');
      nudge();
    } else {
      await finish(async () => {
        const salt = newSalt();
        const hash = await hashPin(pin, salt);
        await setSetting('pinSalt', salt);
        await setSetting('pinHash', hash);
      }, mode === 'set' ? 'PIN activado.' : 'PIN cambiado.');
      return;
    }
    pad.setBusy(false);
  }

  const panel = h('div', { class: 'sheet pin-sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, titles[mode]),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    prompt,
    pad.el);
  close = openModal(panel, { label: titles[mode], onClose: () => pad.destroy() });
}

// ---------- Importar ----------

function confirmImport(dump, summary) {
  let close = () => {};
  const line = (label, n) => h('li', null, label + ': ' + n);
  const go = h('button', { class: 'btn btn-danger grow', type: 'button' }, 'Reemplazar mis datos');
  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      await importConfirmed(dump);
      applyTheme(await getSetting('theme', 'auto'));
      close();
      showSnackbar({ text: 'Backup importado.' });
    } catch (e) {
      close();
      openNotice('No se pudo importar', 'No cambiamos nada de lo que tenías. Probá con otro archivo.');
    }
  });
  const panel = h('div', { class: 'sheet' },
    h('h2', { class: 'sheet-title' }, 'Importar backup'),
    h('p', { class: 'wrap' }, 'Backup del ' + backupDate(summary.exportedAt) + ' con:'),
    h('ul', { class: 'set-list' },
      line('Movimientos', summary.transactionsCount),
      line('Categorías', summary.categoriesCount),
      line('Presupuestos', summary.budgetsCount),
      line('Gastos fijos', summary.recurringCount)),
    h('p', { class: 'wrap set-warn' }, 'Esto reemplaza todo lo que tenés ahora en la app. No se puede deshacer.'),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'),
      go));
  close = openModal(panel, { label: 'Importar backup' });
}

async function handleFile(file) {
  let res;
  try { res = await importBackup(file); } catch (e) { res = { ok: false, error: 'No pudimos leer el archivo.' }; }
  if (!res.ok) {
    openNotice('Backup no válido', (res.error || 'El archivo no sirve.') + '. No cambiamos nada de lo que tenías.');
    return;
  }
  let dump;
  try { dump = JSON.parse(await file.text()); } catch (e) {
    openNotice('Backup no válido', 'No pudimos leer el archivo. No cambiamos nada de lo que tenías.');
    return;
  }
  confirmImport(dump, res.summary);
}

function pickBackupFile() {
  const input = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, tabindex: '-1' });
  const done = () => input.remove();
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    done();
    if (f) handleFile(f);
  });
  input.addEventListener('cancel', done);
  document.body.append(input);
  input.click();
}

// ---------- Atajos, widgets y Centro de control ----------
// Una PWA no puede crear widgets ni controles propios: se usa la app Atajos de iPhone (o los accesos
// directos de Android) con un enlace #/quick-add. Completo (monto + categoría) guarda al tocar; si no, abre la hoja.

function shortcutsSection(cats) {
  const base = location.origin + location.pathname;
  const native = isNative(); // app de iPhone: widget y control propios + enlaces gastos://
  const st = { type: 'expense' };
  const typeBtns = {};
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo del atajo' },
    ...[['expense', 'Gasto'], ['income', 'Ingreso']].map(([value, label]) => {
      typeBtns[value] = h('button', {
        class: 'seg-btn', type: 'button', 'aria-pressed': String(value === st.type), 'data-fk': 'qa-' + value,
        onclick: () => { st.type = value; for (const [k, b] of Object.entries(typeBtns)) b.setAttribute('aria-pressed', String(k === value)); paint(); },
      }, label);
      return typeBtns[value];
    }));
  const catSel = h('select', { class: 'input', 'data-fk': 'qa-cat', onchange: () => paint() },
    h('option', { value: '' }, 'Elegir al cargar'),
    ...cats.map((c) => h('option', { value: c.name }, c.emoji + ' ' + c.name)));
  const amountEl = h('input', {
    class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Opcional', 'data-fk': 'qa-amount',
    oninput: () => paint(),
  });
  const urlEl = h('input', { class: 'input qa-url', type: 'text', readOnly: true, 'aria-label': 'Enlace del atajo', 'data-fk': 'qa-url' });
  const modeEl = h('p', { class: 'set-note wrap', 'aria-live': 'polite' });

  function paint() {
    const amount = parseMoney(amountEl.value);
    const cat = catSel.value;
    const url = buildQuickAddUrl(base, { type: st.type, amount: amount > 0 ? amount : null, cat });
    urlEl.value = native ? toNativeLink(url) : url;
    modeEl.textContent = amount > 0 && cat
      ? 'Con monto y categoría: al tocar el atajo se guarda directo (con Deshacer).'
      : 'Sin monto o sin categoría: el atajo abre la carga rápida lista para completar.';
  }

  const copyBtn = h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'qa-copy' }, 'Copiar enlace');
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(urlEl.value);
      showSnackbar({ text: 'Enlace copiado.' });
    } catch (e) {
      urlEl.focus();
      urlEl.select();
      showSnackbar({ text: 'Mantené apretado el enlace para copiarlo.' });
    }
  });

  paint();
  if (native) {
    return section('set-shortcuts', 'Widget, Centro de control y Atajos',
      h('h3', { class: 'set-sub' }, 'Widget de inicio'),
      h('ol', { class: 'set-steps' },
        h('li', null, 'Mantené apretada la pantalla de inicio y tocá Editar → Agregar widget.'),
        h('li', null, 'Buscá Gastos y elegí el tamaño. Muestra lo gastado del mes y carga un gasto con un toque.')),
      h('h3', { class: 'set-sub' }, 'Centro de control (iOS 18 o más)'),
      h('ol', { class: 'set-steps' },
        h('li', null, 'Abrí el Centro de control y mantené apretado un lugar vacío.'),
        h('li', null, 'Tocá Agregar un control y elegí Gastos → Nuevo gasto.')),
      h('h3', { class: 'set-sub' }, 'Atajo con monto fijo (opcional)'),
      h('p', { class: 'set-note wrap' }, 'Para un gasto que repetís (ej. el café), armá el enlace y pegalo en la app Atajos con la acción "Abrir URL".'),
      seg,
      h('div', { class: 'qa-grid' },
        h('div', { class: 'field' }, h('label', null, 'Categoría', catSel)),
        h('div', { class: 'field' }, h('label', null, 'Monto', amountEl))),
      urlEl,
      modeEl,
      h('div', { class: 'set-actions' }, copyBtn));
  }
  return section('set-shortcuts', 'Atajos, widgets y Centro de control',
    h('p', { class: 'set-note wrap' }, 'Armá un enlace para cargar un gasto en un toque desde la pantalla de inicio o el Centro de control.'),
    seg,
    h('div', { class: 'qa-grid' },
      h('div', { class: 'field' }, h('label', null, 'Categoría', catSel)),
      h('div', { class: 'field' }, h('label', null, 'Monto', amountEl))),
    urlEl,
    modeEl,
    h('div', { class: 'set-actions' }, copyBtn),
    h('h3', { class: 'set-sub' }, 'iPhone: widget de inicio'),
    h('ol', { class: 'set-steps' },
      h('li', null, 'Abrí la app Atajos y tocá + para crear uno nuevo.'),
      h('li', null, 'Agregá la acción "Abrir URL" y pegá el enlace.'),
      h('li', null, 'Ponele nombre (ej. "Gasto café") y guardalo.'),
      h('li', null, 'En la pantalla de inicio, mantené apretado, tocá Editar → Agregar widget → Atajos y elegilo.')),
    h('h3', { class: 'set-sub' }, 'iPhone: Centro de control (iOS 18 o más)'),
    h('ol', { class: 'set-steps' },
      h('li', null, 'Abrí el Centro de control y mantené apretado un lugar vacío.'),
      h('li', null, 'Tocá Agregar un control → Atajos y elegí el que creaste.')),
    h('p', { class: 'set-note wrap' }, 'Ojo: en iPhone el enlace abre la app en Safari, que guarda sus datos aparte de la app instalada en inicio. Usá siempre la misma.'),
    h('h3', { class: 'set-sub' }, 'Android'),
    h('ol', { class: 'set-steps' },
      h('li', null, 'Con la app instalada, mantené apretado su ícono: aparecen "Nuevo gasto" y "Reportes".'),
      h('li', null, 'Arrastrá el que quieras a la pantalla de inicio para tenerlo a un toque.')));
}

// ---------- Pantalla ----------

// Botón que corre una acción async y avisa el resultado.
function actionButton(label, fk, run, okText, errText, primary) {
  const btn = h('button', { class: 'btn' + (primary ? ' btn-primary' : ''), type: 'button', 'data-fk': fk }, label);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await run();
      showSnackbar({ text: okText });
    } catch (e) {
      showSnackbar({ text: errText });
    }
    btn.disabled = false;
  });
  return btn;
}

function segmented(label, options, current, onPick, fkPrefix) {
  return h('div', { class: 'seg seg-3', role: 'group', 'aria-label': label },
    ...options.map(([value, text]) => h('button', {
      class: 'seg-btn',
      type: 'button',
      'aria-pressed': String(value === current),
      'data-fk': fkPrefix + value,
      onclick: () => { if (value !== current) onPick(value); },
    }, text)));
}

export async function render(container) {
  const [pinHash, bioId, lastBackupAt, theme, currency, bioOk, cats] = await Promise.all([
    getSetting('pinHash', null),
    getSetting('biometricCredentialId', null),
    getSetting('lastBackupAt', null),
    getSetting('theme', 'auto'),
    getSetting('defaultCurrency', 'ARS'),
    isAvailable(),
    listCategories(),
  ]);
  const hasPin = typeof pinHash === 'string' && pinHash !== '';
  const hasBio = typeof bioId === 'string' ? bioId !== '' : !!bioId;

  // Datos y backup
  const backup = section('set-backup', 'Datos y backup',
    h('p', { class: 'set-note wrap' }, 'Tus datos viven solo en este navegador. Si borrás los datos del sitio o desinstalás la app, se pierden. Exportá un backup de vez en cuando.'),
    h('p', { class: 'set-status', role: 'status' }, lastBackupText(lastBackupAt)),
    h('div', { class: 'set-actions' },
      actionButton('Exportar backup', 'exp', exportBackup, 'Backup listo.', 'No se pudo exportar el backup.', true),
      h('button', { class: 'btn', type: 'button', 'data-fk': 'imp', onclick: pickBackupFile }, 'Importar backup'),
      actionButton('Exportar CSV', 'csv', exportCSV, 'CSV listo.', 'No se pudo exportar el CSV.')));

  // Seguridad
  const pinActions = hasPin
    ? [
      h('button', { class: 'btn', type: 'button', 'data-fk': 'pin-change', onclick: () => openPinFlow('change') }, 'Cambiar PIN'),
      h('button', { class: 'btn btn-danger', type: 'button', 'data-fk': 'pin-remove', onclick: () => openPinFlow('remove') }, 'Quitar PIN'),
    ]
    : [h('button', { class: 'btn btn-primary', type: 'button', 'data-fk': 'pin-set', onclick: () => openPinFlow('set') }, 'Activar PIN')];
  const seguridad = [
    h('p', { class: 'set-status' }, hasPin ? 'PIN activado.' : 'Sin PIN.'),
    h('p', { class: 'set-note wrap' }, 'Es un candado de pantalla, no cifra tus datos.'),
    h('div', { class: 'set-actions' }, ...pinActions),
  ];
  if (hasPin && bioOk) {
    seguridad.push(
      h('p', { class: 'set-note wrap' }, 'Huella / Face ID: sirve para entrar sin escribir el PIN. El PIN siempre queda como alternativa.'),
      h('div', { class: 'set-actions' }, hasBio
        ? actionButton('Desactivar huella / Face ID', 'bio-off', () => setSetting('biometricCredentialId', null), 'Huella desactivada.', 'No se pudo desactivar.')
        : actionButton('Activar huella / Face ID', 'bio-on', async () => {
          if (!(await register())) throw new Error('bio');
        }, 'Huella activada.', 'No se pudo activar la huella. Seguís con tu PIN.')));
  }

  // Apariencia
  const apariencia = section('set-look', 'Apariencia',
    h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Tema'),
      segmented('Tema', THEMES, theme, async (v) => { applyTheme(v); await setSetting('theme', v); }, 'theme-')),
    h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Moneda por defecto'),
      segmented('Moneda por defecto', CURRENCY_OPTIONS, currency, (v) => setSetting('defaultCurrency', v), 'cur-')));

  // Instalar (texto fijo, sin pop-ups)
  const instalar = section('set-install', 'Instalar en el celular',
    h('h3', { class: 'set-sub' }, 'iPhone'),
    h('ol', { class: 'set-steps' },
      h('li', null, 'Abrí esta página en Safari.'),
      h('li', null, 'Tocá Compartir.'),
      h('li', null, 'Elegí Agregar a inicio.')),
    h('h3', { class: 'set-sub' }, 'Android'),
    h('ol', { class: 'set-steps' },
      h('li', null, 'Abrí esta página en Chrome.'),
      h('li', null, 'Tocá el menú ⋮.'),
      h('li', null, 'Elegí Instalar app.')));

  container.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Ajustes')),
    h('ul', { class: 'rows' },
      linkRow('#/categorias', 'Categorías', 'Crear, editar, ordenar y borrar'),
      linkRow('#/fijos', 'Gastos fijos', 'Recurrentes, próximos vencimientos y repetidos'),
      linkRow('#/reportes', 'Reportes', 'Diario, semanal o mensual · PDF y CSV')),
    backup,
    section('set-security', 'Seguridad', ...seguridad),
    apariencia,
    shortcutsSection(cats),
    isNative() ? null : instalar);
}
