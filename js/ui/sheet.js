// Hoja de carga rápida (y de edición): Gasto/Ingreso, monto, categoría, fecha y nota.
// Guardado optimista: la hoja se cierra al tocar Guardar y si falla se ofrece Reintentar.
import { h, icon } from './dom.js';
import { openModal } from './modal.js';
import { showSnackbar, hideSnackbar } from './snackbar.js';
import { createKeypad, attachKeyboard, formatBuffer, centsToBuffer } from './keypad.js';
import { CURRENCIES, formatMoney } from '../utils/money.js';
import { todayISO, monthKey, addMonths } from '../utils/dates.js';
import { crossedLevel, normalizeLimit } from '../utils/budget.js';
import { pickImage, shrinkImage, readReceipt, canReadText } from '../io/receipt.js';
import { PAYMENT_METHODS } from '../utils/dumpValidation.js';
import { MAX_INSTALLMENTS, normalizeInstallments } from '../utils/installments.js';
import {
  listCategories, getSetting, setSetting, addTransaction, updateTransaction, deleteTransaction, restoreTransaction,
  listBudgets, getMonthAgg, addInstallmentPurchase, updateInstallments, deleteInstallments, restoreTransactions,
  queryTransactions, saveReceipt, getReceipt, deleteReceipt,
} from '../db.js';

// Solo etiquetas: no se guarda ningún dato real de tarjeta.
export const METHOD_LABEL = { efectivo: 'Efectivo', debito: 'Débito', mp: 'MP', credito: 'Crédito' };
const INST_CHIPS = [1, 3, 6, 12];

export const isInstallment = (tx) => !!(tx && tx.purchaseGroupId && tx.totalInstallments > 1);

// Para no pedir de nuevo: la última categoría usada en esta sesión queda preseleccionada.
let lastCategoryId = null;
let persistAsked = false;

function vibrate() {
  try {
    if (navigator.vibrate) navigator.vibrate(15);
  } catch (e) { /* no soportado */ }
}

// Pide almacenamiento persistente una sola vez, en silencio, tras el primer guardado.
function askPersistOnce() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) { /* ignorar */ }
}

const symbolOf = (code) => (CURRENCIES.find((c) => c.code === code) || { symbol: code + ' ' }).symbol;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Borra y ofrece Deshacer 5 s.
export async function deleteWithUndo(id) {
  try {
    const removed = await deleteTransaction(id);
    if (!removed) return;
    showSnackbar({
      text: 'Movimiento borrado',
      actionLabel: 'Deshacer',
      onAction: () => restoreTransaction(removed).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
    });
  } catch (e) {
    showSnackbar({ text: 'No se pudo borrar.' });
  }
}

// Pregunta "¿solo esta cuota o las restantes?". Devuelve 'one' | 'rest' | null (canceló).
// Se apila sobre la hoja: Atrás o Esc lo cierran primero. Tras elegir espera al popstate
// del propio modal para no encimar dos history.go(-1) seguidos.
export function askScope(verb) {
  const isDelete = verb === 'delete';
  hideSnackbar(); // el aviso anterior taparía los botones
  return new Promise((resolve) => {
    let choice = null;
    let close = () => {};
    const pick = (v) => { choice = v; close(); };
    const panel = h('div', { class: 'sheet scope-sheet' },
      h('h2', { class: 'sheet-title' }, '¿Solo esta cuota o todas las restantes de esta compra?'),
      h('p', { class: 'an-muted' }, isDelete
        ? 'Las restantes son esta cuota y las que siguen.'
        : 'Si elegís las restantes, el cambio se aplica a esta cuota y a las que siguen.'),
      h('div', { class: 'scope-actions' },
        h('button', { class: 'btn ' + (isDelete ? 'btn-danger' : ''), type: 'button', onclick: () => pick('one') }, 'Solo esta'),
        h('button', { class: 'btn ' + (isDelete ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: () => pick('rest') }, 'Esta y las restantes'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancelar')));
    close = openModal(panel, {
      label: 'Alcance del cambio en cuotas',
      onClose: () => {
        if (!choice) { resolve(null); return; }
        let done = false;
        const go = () => { if (done) return; done = true; window.removeEventListener('popstate', go); resolve(choice); };
        window.addEventListener('popstate', go);
        setTimeout(go, 400);
      },
    });
  });
}

// Borra una cuota ('one') o esa y las siguientes ('rest') con Deshacer en bloque.
export async function deleteInstallmentsWithUndo(id, scope) {
  try {
    const removed = await deleteInstallments(id, scope);
    if (!removed.length) return;
    showSnackbar({
      text: removed.length > 1 ? removed.length + ' cuotas borradas' : 'Cuota borrada',
      actionLabel: 'Deshacer',
      onAction: () => restoreTransactions(removed).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
    });
  } catch (e) {
    showSnackbar({ text: 'No se pudo borrar.' });
  }
}

// Foto de todas las cuotas de la compra (para Deshacer una edición). Vacía si no se pudo leer.
async function snapshotGroup(tx) {
  try {
    const from = addMonths(monthKey(tx.date), -(tx.installmentNumber + 1)) + '-01';
    const res = await queryTransactions({ from, type: tx.type, limit: 0 });
    return res.items.filter((t) => t.purchaseGroupId === tx.purchaseGroupId);
  } catch (e) {
    return [];
  }
}

// Guarda un movimiento nuevo (con n cuotas si n > 1; data.amount = total de la compra).
// Devuelve {list, undo}: `undo` borra lo que se guardó.
export async function saveNewMovement(data, n = 1) {
  let list;
  let undoRaw;
  if (n > 1) {
    list = await addInstallmentPurchase(data, n);
    undoRaw = () => deleteInstallments(list[0].id, 'rest');
  } else {
    const saved = await addTransaction(data);
    list = [saved];
    undoRaw = () => deleteTransaction(saved.id);
  }
  askPersistOnce();
  setSetting('lastPaymentMethod', data.paymentMethod).catch(() => {});
  return { list, undo: () => undoRaw().catch(() => showSnackbar({ text: 'No se pudo deshacer.' })) };
}

// Aviso de presupuesto (80% / 100%) después de guardar un gasto; reemplaza al aviso anterior si cruzó un umbral.
// También avisa si cruzó el 80% / 100% del límite general de gasto del mes (Presupuestos).
export function notifyBudget(first, cats, undo) {
  const cat = cats.find((c) => c.id === first.categoryId);
  Promise.all([
    budgetNotice(first, cat ? cat.name : 'La categoría').catch(() => null),
    limitNotice(first).catch(() => null),
  ]).then((texts) => {
    const text = texts.filter(Boolean).join(' · ');
    if (text) showSnackbar({ text, actionLabel: 'Deshacer', onAction: undo, ms: 7000 });
  });
}

// Límite general del mes (setting 'spendLimit'): texto si este gasto cruzó un umbral, si no null.
async function limitNotice(saved) {
  const limit = normalizeLimit(await getSetting('spendLimit', null));
  if (!limit || limit.currency !== saved.currency) return null;
  const agg = await getMonthAgg(monthKey(saved.date)); // ya incluye este gasto
  const now = (agg[saved.currency] && agg[saved.currency].expense) || 0;
  const level = crossedLevel(now - saved.amount, now, limit.amount);
  if (level === 'over') return 'Superaste tu límite de gasto del mes';
  if (level === 'warn') return 'Llegaste al 80% de tu límite de gasto del mes';
  return null;
}

// Hoja con la foto del recibo en grande.
function openReceiptViewer(blob) {
  const url = URL.createObjectURL(blob);
  let close = () => {};
  const panel = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, 'Recibo'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    h('img', { class: 'receipt-img', src: url, alt: 'Foto del recibo' }));
  close = openModal(panel, { label: 'Recibo', onClose: () => URL.revokeObjectURL(url) });
}

// Devuelve el texto de aviso si el gasto recién guardado cruzó el 80% o el 100% del presupuesto
// de su categoría en el mes de su fecha; si no, null. Solo gastos nuevos (editar no avisa).
async function budgetNotice(saved, categoryName) {
  const budgets = await listBudgets();
  const b = budgets.find((x) => x.categoryId === saved.categoryId && x.currency === saved.currency);
  if (!b) return null;
  const agg = await getMonthAgg(monthKey(saved.date)); // ya incluye este gasto
  const cur = agg[saved.currency];
  const now = (cur && cur.byCat[saved.categoryId]) || 0;
  const level = crossedLevel(now - saved.amount, now, b.monthlyLimit);
  if (level === 'over') return categoryName + ' superó su presupuesto';
  if (level === 'warn') return categoryName + ' llegó al 80% de su presupuesto';
  return null;
}

// openSheet() = movimiento nuevo · openSheet({tx}) = editar · openSheet({prefill}) = reabrir con datos.
export async function openSheet({ tx = null, prefill = null } = {}) {
  const [cats, defCur, lastMethod] = await Promise.all([
    listCategories(), getSetting('defaultCurrency', 'ARS'), getSetting('lastPaymentMethod', 'efectivo'),
  ]);
  if (!cats.length) {
    showSnackbar({ text: 'Primero creá una categoría.' });
    location.hash = '#/categorias';
    return;
  }

  const src = tx || prefill || {};
  const st = {
    type: src.type || 'expense',
    currency: src.currency || defCur || 'ARS',
    date: src.date || todayISO(),
    note: src.note || '',
    categoryId: [src.categoryId, lastCategoryId].find((id) => id && cats.some((c) => c.id === id)) || cats[0].id,
    method: [src.paymentMethod, src.method, lastMethod].find((m) => PAYMENT_METHODS.includes(m)) || 'efectivo',
    inst: normalizeInstallments(src.installments),
  };
  const editingCuota = isInstallment(tx); // editar una cuota: sin selector de cuotas, solo aviso
  // Recibo: blob en memoria hasta Guardar. changed = hay que escribir (foto nueva o quitada).
  const receipt = { blob: (prefill && prefill.receipt) || null, changed: !!(prefill && prefill.receipt) };
  const initialBuf = tx ? centsToBuffer(tx.amount) : (prefill && prefill.buffer) || '';

  // --- Monto ---
  const amountEl = h('input', {
    class: 'amount-input',
    type: 'text',
    inputmode: 'none',
    readOnly: true,
    autocomplete: 'off',
    'aria-label': 'Monto',
  });
  const curSel = h('select', {
    class: 'input cur-select',
    'aria-label': 'Moneda',
    onchange: () => { st.currency = curSel.value; paint(); },
  }, ...CURRENCIES.map((c) => h('option', { value: c.code }, c.code)));
  curSel.value = st.currency;
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });

  const kp = createKeypad({
    initial: initialBuf,
    onChange: () => { errEl.textContent = ''; paint(); },
    onSubmit: () => save(),
  });

  function paint() {
    amountEl.value = symbolOf(st.currency) + formatBuffer(kp.buffer);
    paintHint();
  }

  // --- Tipo ---
  const typeBtns = {};
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de movimiento' },
    ...[['expense', 'Gasto'], ['income', 'Ingreso']].map(([value, label]) => {
      typeBtns[value] = h('button', { class: 'seg-btn', type: 'button', onclick: () => setType(value) }, label);
      return typeBtns[value];
    }));

  // --- Categorías ---
  const chipBtns = new Map();
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Categoría' },
    ...cats.map((c) => {
      const b = h('button', { class: 'chip', type: 'button', vars: { '--cat': c.color }, onclick: () => setCat(c.id) },
        h('span', { class: 'chip-emoji', 'aria-hidden': 'true' }, c.emoji),
        h('span', null, c.name));
      chipBtns.set(c.id, b);
      return b;
    }));

  // --- Medio de pago (solo etiqueta) ---
  const methodBtns = {};
  const methodRow = h('div', { class: 'pay-row', role: 'group', 'aria-label': 'Medio de pago' },
    ...PAYMENT_METHODS.map((m) => {
      methodBtns[m] = h('button', { class: 'chip pay-chip', type: 'button', onclick: () => setMethod(m) }, METHOD_LABEL[m]);
      return methodBtns[m];
    }));

  // --- Cuotas (solo gasto con crédito) ---
  const instBtns = new Map();
  const otherEl = h('input', {
    class: 'input inst-other', type: 'number', inputmode: 'numeric', min: 1, max: MAX_INSTALLMENTS, step: 1,
    placeholder: 'Otra', 'aria-label': 'Otra cantidad de cuotas (hasta ' + MAX_INSTALLMENTS + ')',
    oninput: () => {
      errEl.textContent = '';
      if (otherEl.value === '') { setInst(1); return; }
      const v = Math.floor(Number(otherEl.value));
      if (v > MAX_INSTALLMENTS) otherEl.value = String(MAX_INSTALLMENTS);
      setInst(v >= 1 ? Math.min(v, MAX_INSTALLMENTS) : 1, true);
    },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } },
  });
  const instRow = h('div', { class: 'inst-row', role: 'group', 'aria-label': 'Cantidad de cuotas' },
    ...INST_CHIPS.map((n) => {
      const b = h('button', {
        class: 'chip pay-chip', type: 'button', 'aria-label': n === 1 ? '1 pago, sin cuotas' : n + ' cuotas',
        onclick: () => { otherEl.value = ''; setInst(n); },
      }, String(n));
      instBtns.set(n, b);
      return b;
    }),
    otherEl);
  const hintEl = h('p', { class: 'inst-hint', 'aria-live': 'polite' });

  // --- Fecha y nota ---
  const dateEl = h('input', {
    class: 'input', type: 'date', value: st.date, 'aria-label': 'Fecha',
    onchange: () => { st.date = dateEl.value; },
  });
  const noteEl = h('input', {
    class: 'input note-input', type: 'text', maxlength: 120, autocomplete: 'off',
    placeholder: 'Nota (opcional)', 'aria-label': 'Nota', value: st.note,
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } },
  });

  // --- Recibo (foto) ---
  const receiptText = h('span', { class: 'receipt-text', 'aria-live': 'polite' });
  const receiptRow = h('p', { class: 'receipt-row', hidden: true },
    receiptText,
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { if (receipt.blob) openReceiptViewer(receipt.blob); } }, 'Ver'),
    h('button', {
      class: 'btn btn-ghost', type: 'button',
      onclick: () => { receipt.blob = null; receipt.changed = true; paintReceipt(''); },
    }, 'Quitar'));
  function paintReceipt(text) {
    receiptRow.hidden = !receipt.blob;
    receiptText.textContent = text || '📎 Recibo adjunto';
  }
  async function attachReceipt() {
    const file = await pickImage();
    if (!file) return;
    receipt.blob = await shrinkImage(file);
    receipt.changed = true;
    if (!canReadText()) {
      paintReceipt('📎 Recibo adjunto. Cargá el monto a mano.');
      return;
    }
    paintReceipt('Leyendo el recibo…');
    const found = await readReceipt(receipt.blob);
    const parts = [];
    if (found.amount && kp.cents === 0) {
      kp.set(centsToBuffer(found.amount));
      parts.push('monto ' + formatMoney(found.amount, st.currency));
    }
    if (found.date && !tx && found.date <= todayISO()) {
      dateEl.value = found.date;
      st.date = found.date;
      parts.push('fecha');
    }
    paintReceipt(parts.length ? '📎 Leímos ' + parts.join(' y ') + '. Revisalo.' : '📎 Recibo adjunto. No pudimos leer el total.');
  }
  const camBtn = h('button', {
    class: 'icon-btn', type: 'button', 'aria-label': 'Adjuntar foto del recibo', onclick: () => { attachReceipt().catch(() => {}); },
  }, icon('camera'));

  // --- Panel ---
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'));
  const delBtn = tx
    ? h('button', {
      class: 'icon-btn icon-btn-danger', type: 'button', 'aria-label': 'Borrar movimiento',
      onclick: async () => {
        const id = tx.id;
        if (!editingCuota) { close(); deleteWithUndo(id); return; }
        const scope = await askScope('delete');
        if (!scope) return;
        close();
        deleteInstallmentsWithUndo(id, scope);
      },
    }, icon('trash'))
    : null;

  const panel = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' }, seg, camBtn, delBtn, closeBtn),
    h('div', { class: 'amount-row' }, amountEl, curSel),
    errEl,
    chips,
    methodRow,
    instRow,
    hintEl,
    receiptRow,
    h('div', { class: 'meta-row' }, dateEl, noteEl),
    kp.el);

  // Cuotas: solo al cargar un gasto nuevo con crédito.
  const instOn = () => !tx && st.type === 'expense' && st.method === 'credito';
  function paintHint() {
    let text = '';
    if (editingCuota) {
      text = 'Cuota ' + tx.installmentNumber + ' de ' + tx.totalInstallments + ' de una compra en cuotas.';
    } else if (instOn()) {
      const cents = kp.cents;
      text = st.inst === 1 ? 'En 1 pago, sin cuotas.'
        : st.inst + ' cuotas' + (cents >= st.inst ? ' de ' + formatMoney(Math.floor(cents / st.inst), st.currency) : '') + '.';
    }
    hintEl.textContent = text;
    hintEl.hidden = !text;
    hintEl.classList.toggle('is-calc', instOn()); // en pantallas bajas se oculta el cálculo para que entre el teclado
  }
  function paintInst() {
    instRow.hidden = !instOn();
    const other = otherEl.value !== '';
    for (const [n, b] of instBtns) b.setAttribute('aria-pressed', String(!other && st.inst === n));
    otherEl.classList.toggle('is-active', other);
    paintHint();
  }
  function setInst(n) {
    st.inst = n;
    paintInst();
  }
  function setMethod(m) {
    st.method = m;
    for (const [k, b] of Object.entries(methodBtns)) b.setAttribute('aria-pressed', String(k === m));
    paintInst();
  }
  function setType(t) {
    st.type = t;
    panel.classList.toggle('is-income', t === 'income');
    for (const [k, b] of Object.entries(typeBtns)) b.setAttribute('aria-pressed', String(k === t));
    paintInst();
  }
  function setCat(id) {
    st.categoryId = id;
    for (const [k, b] of chipBtns) b.setAttribute('aria-pressed', String(k === id));
  }

  async function save() {
    const cents = kp.cents;
    if (cents <= 0) {
      errEl.textContent = 'Ingresá un monto.';
      return;
    }
    const n = instOn() ? st.inst : 1;
    if (n > 1 && cents < n) {
      errEl.textContent = 'El monto es muy chico para ' + n + ' cuotas.';
      return;
    }
    const data = {
      type: st.type,
      amount: cents,
      currency: st.currency,
      categoryId: st.categoryId,
      date: ISO_RE.test(dateEl.value) ? dateEl.value : todayISO(),
      note: noteEl.value.trim(),
      paymentMethod: st.method,
    };
    // Editar una cuota: primero se pregunta el alcance (la hoja sigue abierta si cancela).
    let scope = 'one';
    if (editingCuota) {
      scope = await askScope('edit');
      if (!scope) return;
    }
    lastCategoryId = st.categoryId;
    const retry = {
      type: data.type, currency: data.currency, categoryId: data.categoryId, date: data.date, note: data.note,
      buffer: kp.buffer, method: data.paymentMethod, installments: n,
      receipt: receipt.changed ? receipt.blob : null,
    };
    // Guarda o quita la foto del recibo del movimiento `id` (si falla, el movimiento ya quedó).
    const syncReceipt = (id) => {
      if (!receipt.changed) return;
      (receipt.blob ? saveReceipt(id, receipt.blob) : deleteReceipt(id)).catch(() => showSnackbar({ text: 'No se pudo guardar la foto del recibo.' }));
    };

    close(); // optimista: no esperamos a la base
    vibrate();
    try {
      if (editingCuota) {
        const before = await snapshotGroup(tx);
        await updateInstallments({ id: tx.id, ...data }, scope);
        syncReceipt(tx.id);
        showSnackbar({
          text: 'Cambios guardados',
          actionLabel: before.length ? 'Deshacer' : undefined,
          onAction: before.length ? () => restoreTransactions(before).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })) : undefined,
        });
      } else if (tx) {
        await updateTransaction({ id: tx.id, ...data });
        syncReceipt(tx.id);
        showSnackbar({ text: 'Cambios guardados' });
      } else {
        const { list, undo } = await saveNewMovement(data, n);
        const first = list[0];
        syncReceipt(first.id);
        showSnackbar({
          text: n > 1
            ? 'Compra en ' + n + ' cuotas de ' + formatMoney(first.amount, data.currency)
            : (data.type === 'income' ? 'Ingreso' : 'Gasto') + ' guardado',
          actionLabel: 'Deshacer',
          onAction: undo,
        });
        if (data.type === 'expense') notifyBudget(first, cats, undo);
      }
    } catch (e) {
      showSnackbar({
        text: 'No se pudo guardar.',
        actionLabel: 'Reintentar',
        onAction: () => openSheet({ tx, prefill: retry }),
        ms: 8000,
      });
    }
  }

  const detach = attachKeyboard(kp, { amountEl });
  const close = openModal(panel, {
    label: tx ? 'Editar movimiento' : 'Nuevo movimiento',
    onClose: detach,
  });

  if (!INST_CHIPS.includes(st.inst)) otherEl.value = String(st.inst);
  setType(st.type);
  setMethod(st.method);
  setCat(st.categoryId);
  paint();
  paintReceipt(receipt.blob ? '' : null);
  if (tx && !receipt.blob) {
    getReceipt(tx.id).then((blob) => {
      if (blob && !receipt.changed) { receipt.blob = blob; paintReceipt(''); }
    }).catch(() => {});
  }
  const active = chipBtns.get(st.categoryId);
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}
