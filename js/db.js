// Wrapper de IndexedDB "gastos". Sin dependencias. Importes en centavos, fechas 'YYYY-MM-DD'.
// No toca indexedDB al importar: solo dentro de openDB() (así el archivo carga en Node).
import { monthRange, monthKey, addMonths, todayISO, dayOfWeek } from './utils/dates.js';
import { buildInstallments, groupInstallments, normalizeInstallments, installmentDate } from './utils/installments.js';
import { dueDate, pendingMonths, buildTx } from './utils/recurring.js';
import { validateDump, SCHEMA_VERSION, STORE_NAMES, DEVICE_SETTINGS, PAYMENT_METHODS } from './utils/dumpValidation.js';

export const DB_NAME = 'gastos';
export const DB_VERSION = 3;

// Emite 'change' tras cada escritura confirmada.
export const dbEvents = new EventTarget();

const DEFAULT_CATEGORIES = [
  { name: 'Comida', emoji: '🍽️', color: '#E4572E', kind: 'flexible' },
  { name: 'Transporte', emoji: '🚌', color: '#2E86AB', kind: 'essential' },
  { name: 'Alquiler', emoji: '🏠', color: '#6C4AB6', kind: 'essential' },
  { name: 'Servicios', emoji: '💡', color: '#E0A100', kind: 'essential' },
  { name: 'Salidas', emoji: '🎉', color: '#D6336C', kind: 'flexible' },
  { name: 'Salud', emoji: '💊', color: '#2F9E44', kind: 'essential' },
  { name: 'Compras', emoji: '🛍️', color: '#1C7ED6', kind: 'flexible' },
  { name: 'Otros', emoji: '📦', color: '#6B7280', kind: 'flexible' },
];

const newId = () => crypto.randomUUID();

// ---------- Apertura y migraciones ----------

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = (ev) => migrate(open.result, open.transaction, ev.oldVersion);
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    open.onerror = () => { dbPromise = null; reject(open.error); };
    open.onblocked = () => { dbPromise = null; reject(new Error('Base bloqueada por otra pestaña')); };
  });
  return dbPromise;
}

// Migraciones incrementales por versión.
function migrate(db, tx, oldVersion) {
  if (oldVersion < 1) {
    const txs = db.createObjectStore('transactions', { keyPath: 'id' });
    txs.createIndex('date', 'date');
    txs.createIndex('categoryId', 'categoryId');
    txs.createIndex('rec', ['recurringId', 'recurringMonth'], { unique: true });

    db.createObjectStore('categories', { keyPath: 'id' });

    const budgets = db.createObjectStore('budgets', { keyPath: 'id' });
    budgets.createIndex('catCur', ['categoryId', 'currency'], { unique: true });

    db.createObjectStore('recurring', { keyPath: 'id' });
    db.createObjectStore('settings', { keyPath: 'key' });

    const dis = db.createObjectStore('dismissed_insights', { keyPath: 'id' });
    dis.createIndex('month', 'month');

    // Siembra única de categorías por defecto (solo al crear la base).
    const cats = tx.objectStore('categories');
    DEFAULT_CATEGORIES.forEach((c, i) => cats.add({ id: newId(), sortOrder: i, ...c }));
  }
  if (oldVersion < 2) {
    // Fase 6: índice por compra en cuotas (solo indexa los que tienen purchaseGroupId) y medio de
    // pago 'efectivo' para los movimientos que ya existían. No se pierde ningún dato v1.
    const txs = tx.objectStore('transactions');
    txs.createIndex('purchaseGroupId', 'purchaseGroupId');
    if (oldVersion >= 1) {
      txs.openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        if (!c.value.paymentMethod) c.update({ ...c.value, paymentMethod: 'efectivo' });
        c.continue();
      };
    }
  }
  if (oldVersion < 3) {
    // Fase 7: fotos de recibos, una por movimiento (keyPath txId). Son Blobs: no van al backup JSON.
    db.createObjectStore('receipts', { keyPath: 'txId' });
  }
}

// ---------- Helpers ----------

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// Recorre un cursor; cb(cursor) devuelve false para cortar. cb decide update/delete.
const cursorEach = (request, cb) => new Promise((resolve, reject) => {
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const c = request.result;
    if (!c) return resolve();
    try {
      if (cb(c) === false) return resolve();
    } catch (e) { return reject(e); }
    c.continue();
  };
});

// Corre fn(tx) en una transacción. Si fn falla, aborta todo. Emite 'change' si fue escritura
// (y si shouldEmit(resultado), cuando se pasa).
async function run(stores, mode, fn, shouldEmit) {
  const db = await openDB();
  const tx = db.transaction(stores, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
  });
  done.catch(() => {});
  let result;
  try {
    result = await fn(tx);
  } catch (e) {
    try { tx.abort(); } catch { /* ya cerrada */ }
    await done.catch(() => {});
    throw e;
  }
  await done;
  if (mode === 'readwrite' && (!shouldEmit || shouldEmit(result))) dbEvents.dispatchEvent(new Event('change'));
  return result;
}

// Normaliza para guardar: en manuales las claves del índice `rec` quedan ausentes (no null).
// Igual con `purchaseGroupId` (índice de cuotas): ausente, no null, en los movimientos comunes.
function toStored(t) {
  const o = { ...t };
  if (o.recurringId == null) {
    delete o.recurringId;
    delete o.recurringMonth;
  }
  if (o.purchaseGroupId == null) delete o.purchaseGroupId;
  return o;
}

// Rellena los defaults (también sirve para datos v1: paymentMethod 'efectivo').
function fromStored(t) {
  if (!t) return t;
  return {
    ...t,
    recurringId: t.recurringId ?? null,
    recurringMonth: t.recurringMonth ?? null,
    paymentMethod: t.paymentMethod ?? 'efectivo',
    installmentNumber: t.installmentNumber ?? null,
    totalInstallments: t.totalInstallments ?? null,
    purchaseGroupId: t.purchaseGroupId ?? null,
    purchaseTotal: t.purchaseTotal ?? null,
  };
}

function validateTx(t) {
  if (t.type !== 'expense' && t.type !== 'income') throw new Error('Tipo inválido');
  if (!Number.isSafeInteger(t.amount) || t.amount <= 0) throw new Error('Monto inválido (centavos enteros > 0)');
  if (!t.categoryId) throw new Error('Falta la categoría');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) throw new Error('Fecha inválida');
  if (t.paymentMethod != null && !PAYMENT_METHODS.includes(t.paymentMethod)) throw new Error('Medio de pago inválido');
}

// ---------- Movimientos ----------

export async function addTransaction(t) {
  const now = Date.now();
  const tx = fromStored({
    note: '',
    currency: 'ARS',
    ...t,
    id: t.id || newId(),
    createdAt: t.createdAt ?? now,
    updatedAt: now,
  });
  validateTx(tx);
  await run(['transactions'], 'readwrite', (x) => req(x.objectStore('transactions').add(toStored(tx))));
  return tx;
}

export async function updateTransaction(t) {
  return run(['transactions'], 'readwrite', async (x) => {
    const store = x.objectStore('transactions');
    const prev = await req(store.get(t.id));
    if (!prev) throw new Error('Movimiento inexistente');
    const next = fromStored({ ...fromStored(prev), ...t, id: prev.id, createdAt: prev.createdAt, updatedAt: Date.now() });
    validateTx(next);
    await req(store.put(toStored(next)));
    return next;
  });
}

// Devuelve el movimiento borrado (para Deshacer).
export async function deleteTransaction(id) {
  return run(['transactions'], 'readwrite', async (x) => {
    const store = x.objectStore('transactions');
    const prev = await req(store.get(id));
    if (!prev) return null;
    await req(store.delete(id));
    return fromStored(prev);
  });
}

// Deshacer: vuelve a guardar el movimiento tal cual estaba.
export async function restoreTransaction(tx) {
  validateTx(tx);
  await run(['transactions'], 'readwrite', (x) => req(x.objectStore('transactions').put(toStored(tx))));
  return tx;
}

// ---------- Cuotas ----------

// Compra en cuotas: base.amount = total de la compra; n cuotas (1..60) en UNA transacción y un solo
// 'change'. n=1 = movimiento común. Con n>1 el medio de pago debe ser 'credito'.
export async function addInstallmentPurchase(base, n) {
  const count = normalizeInstallments(n);
  if (count > 1 && base.paymentMethod !== 'credito') throw new Error('Las cuotas son solo con crédito');
  validateTx(base);
  const list = buildInstallments(base, count, newId(), Date.now()).map(fromStored);
  list.forEach(validateTx);
  await run(['transactions'], 'readwrite', async (x) => {
    const store = x.objectStore('transactions');
    for (const t of list) await req(store.add(toStored(t)));
  });
  return list;
}

// Edita una cuota. scope 'one' = solo esa; 'rest' = esa y las siguientes del grupo (por número).
// Qué se propaga con 'rest' (a las siguientes; la editada toma todo lo que venga en `t`):
//  - categoryId, note y paymentMethod: se copian a todas las del alcance.
//  - amount: si cambió, el monto editado se aplica IGUAL a cada cuota del alcance (no se re-reparte el total).
//  - date: si cambió, la editada toma esa fecha y las siguientes se corren en meses desde ella
//    (mismo día, clampDay a fin de mes calculado siempre desde el día elegido).
//  - No se tocan: id, type, currency, installmentNumber, totalInstallments, purchaseGroupId.
// Si cambió algún monto, purchaseTotal de la cuota 1 pasa a ser la suma actual de todas las cuotas.
// Sin grupo se comporta como 'one'. Devuelve las cuotas actualizadas. Un solo 'change'.
export async function updateInstallments(t, scope = 'one') {
  return run(['transactions'], 'readwrite', async (x) => {
    const store = x.objectStore('transactions');
    const prev = await req(store.get(t.id));
    if (!prev) throw new Error('Movimiento inexistente');
    const gid = prev.purchaseGroupId;
    let all = [fromStored(prev)];
    if (gid) all = (await req(store.index('purchaseGroupId').getAll(gid))).map(fromStored);
    const targets = gid && scope === 'rest' ? all.filter((c) => c.installmentNumber >= prev.installmentNumber) : all.filter((c) => c.id === prev.id);
    const now = Date.now();
    const dateChanged = t.date != null && t.date !== prev.date;
    const amountChanged = t.amount != null && t.amount !== prev.amount;
    const out = new Map();
    for (const c of targets) {
      const next = { ...c, updatedAt: now };
      const self = c.id === prev.id;
      for (const k of ['categoryId', 'note', 'paymentMethod']) if (t[k] !== undefined) next[k] = t[k];
      if (amountChanged) next.amount = t.amount;
      if (dateChanged) next.date = self ? t.date : installmentDate(t.date, c.installmentNumber - prev.installmentNumber);
      validateTx(next);
      out.set(c.id, next);
    }
    if (amountChanged && gid) {
      const sum = all.reduce((s, c) => s + (out.get(c.id) || c).amount, 0);
      const first = all.find((c) => c.installmentNumber === 1);
      if (first) out.set(first.id, { ...(out.get(first.id) || first), purchaseTotal: sum, updatedAt: now });
    }
    for (const c of out.values()) await req(store.put(toStored(c)));
    return [...out.values()];
  });
}

// Borra una cuota ('one') o esa y las siguientes ('rest'). Devuelve las borradas (para Deshacer en bloque).
export async function deleteInstallments(id, scope = 'one') {
  return run(['transactions'], 'readwrite', async (x) => {
    const store = x.objectStore('transactions');
    const prev = await req(store.get(id));
    if (!prev) return [];
    let targets = [prev];
    if (scope === 'rest' && prev.purchaseGroupId) {
      const all = await req(store.index('purchaseGroupId').getAll(prev.purchaseGroupId));
      targets = all.filter((c) => c.installmentNumber >= prev.installmentNumber);
    }
    for (const c of targets) await req(store.delete(c.id));
    return targets.map(fromStored);
  }, (r) => r.length > 0);
}

// Deshacer en bloque: vuelve a guardar todos los movimientos en una sola transacción.
export async function restoreTransactions(txs) {
  const list = txs.map(fromStored);
  list.forEach(validateTx);
  await run(['transactions'], 'readwrite', async (x) => {
    const store = x.objectStore('transactions');
    for (const t of list) await req(store.put(toStored(t)));
  });
  return list;
}

// Compras en cuotas ACTIVAS (con cuotas posteriores a hoy). Recorre solo el índice purchaseGroupId.
export async function listInstallmentGroups() {
  const rows = await run(['transactions'], 'readonly', async (x) => {
    const list = [];
    await cursorEach(x.objectStore('transactions').index('purchaseGroupId').openCursor(), (c) => { list.push(c.value); });
    return list;
  });
  return groupInstallments(rows, todayISO());
}

export async function getTransaction(id) {
  return run(['transactions'], 'readonly', async (x) => fromStored(await req(x.objectStore('transactions').get(id))));
}

// Minúsculas y sin tildes, para buscar en la nota.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Orden: fecha desc (y id desc dentro del mismo día). `after` = {date, id} del `next` anterior.
// Devuelve {items, next}; next es null si no hay más.
export async function queryTransactions({ from, to, categoryId, type, text, limit = 50, after } = {}) {
  const needle = text ? fold(text.trim()) : '';
  const max = limit > 0 ? limit : Infinity;

  let upper = to;
  if (after && (upper == null || after.date < upper)) upper = after.date;
  let range = null;
  if (from != null && upper != null) range = IDBKeyRange.bound(from, upper);
  else if (from != null) range = IDBKeyRange.lowerBound(from);
  else if (upper != null) range = IDBKeyRange.upperBound(upper);

  return run(['transactions'], 'readonly', async (x) => {
    const items = [];
    let next = null;
    await cursorEach(x.objectStore('transactions').index('date').openCursor(range, 'prev'), (c) => {
      const v = c.value;
      // Saltar lo ya entregado en la página anterior (mismo día, id >= after.id).
      if (after && v.date === after.date && v.id >= after.id) return;
      if (categoryId && v.categoryId !== categoryId) return;
      if (type && v.type !== type) return;
      if (needle && !fold(v.note).includes(needle)) return;
      if (items.length >= max) {
        const last = items[items.length - 1];
        next = { date: last.date, id: last.id };
        return false;
      }
      items.push(fromStored(v));
    });
    return { items, next };
  });
}

// Totales del mes por moneda. byCat cuenta solo gastos.
export async function getMonthAgg(ym) {
  const { from, to } = monthRange(ym);
  return run(['transactions'], 'readonly', async (x) => {
    const out = {};
    await cursorEach(x.objectStore('transactions').index('date').openCursor(IDBKeyRange.bound(from, to)), (c) => {
      const v = c.value;
      const cur = v.currency || 'ARS';
      const a = out[cur] || (out[cur] = { income: 0, expense: 0, byCat: {} });
      if (v.type === 'income') {
        a.income += v.amount;
      } else {
        a.expense += v.amount;
        a.byCat[v.categoryId] = (a.byCat[v.categoryId] || 0) + v.amount;
      }
    });
    return out;
  });
}

// ---------- Categorías ----------

export async function listCategories() {
  const all = await run(['categories'], 'readonly', (x) => req(x.objectStore('categories').getAll()));
  return all.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function saveCategory(c) {
  const name = String(c.name || '').trim();
  if (!name) throw new Error('Falta el nombre');
  return run(['categories'], 'readwrite', async (x) => {
    const store = x.objectStore('categories');
    let sortOrder = c.sortOrder;
    if (sortOrder == null) {
      const all = await req(store.getAll());
      sortOrder = all.reduce((m, k) => Math.max(m, k.sortOrder), -1) + 1;
    }
    const cat = {
      emoji: '📦',
      color: '#6B7280',
      kind: 'flexible',
      ...c,
      name,
      id: c.id || newId(),
      sortOrder,
    };
    await req(store.put(cat));
    return cat;
  });
}

// Borra la categoría y reasigna movimientos y fijos a reassignToId, todo en una transacción.
// Los presupuestos de la categoría borrada se eliminan (evita choque con el índice único).
export async function deleteCategory(id, reassignToId) {
  return run(['categories', 'transactions', 'budgets', 'recurring'], 'readwrite', async (x) => {
    const cats = x.objectStore('categories');
    const txs = x.objectStore('transactions');
    const recs = x.objectStore('recurring');
    const buds = x.objectStore('budgets');

    const inUse = (await req(txs.index('categoryId').count(id))) > 0;
    const recAll = await req(recs.getAll());
    const recUse = recAll.filter((r) => r.categoryId === id);

    if (reassignToId != null) {
      if (reassignToId === id) throw new Error('El destino no puede ser la misma categoría');
      if (!(await req(cats.get(reassignToId)))) throw new Error('Categoría destino inexistente');
    } else if (inUse || recUse.length) {
      throw new Error('Hay movimientos en esta categoría: elegí a cuál pasarlos');
    }

    if (reassignToId != null) {
      const now = Date.now();
      await cursorEach(txs.index('categoryId').openCursor(IDBKeyRange.only(id)), (c) => {
        c.update({ ...c.value, categoryId: reassignToId, updatedAt: now });
      });
      for (const r of recUse) await req(recs.put({ ...r, categoryId: reassignToId }));
    }
    await cursorEach(buds.openCursor(), (c) => {
      if (c.value.categoryId === id) c.delete();
    });
    await req(cats.delete(id));
  });
}

// ids en el orden deseado; las no listadas quedan al final conservando su orden.
export async function reorderCategories(ids) {
  return run(['categories'], 'readwrite', async (x) => {
    const store = x.objectStore('categories');
    const all = (await req(store.getAll())).sort((a, b) => a.sortOrder - b.sortOrder);
    const byId = new Map(all.map((c) => [c.id, c]));
    const order = [...ids.filter((i) => byId.has(i))];
    for (const c of all) if (!order.includes(c.id)) order.push(c.id);
    for (let i = 0; i < order.length; i++) {
      const c = byId.get(order[i]);
      if (c.sortOrder !== i) await req(store.put({ ...c, sortOrder: i }));
    }
  });
}

// ---------- Ajustes ----------

export async function getSetting(key, def) {
  const rec = await run(['settings'], 'readonly', (x) => req(x.objectStore('settings').get(key)));
  return rec === undefined ? def : rec.value;
}

export async function setSetting(key, value) {
  await run(['settings'], 'readwrite', (x) => req(x.objectStore('settings').put({ key, value })));
}

// ---------- Presupuestos ----------
// El gasto del mes por categoría sale de getMonthAgg(ym)[currency]?.byCat[categoryId] || 0
// (alcanza: un solo recorrido del mes, sin función extra).

export async function listBudgets() {
  return run(['budgets'], 'readonly', (x) => req(x.objectStore('budgets').getAll()));
}

// Único por [categoryId, currency]: si ya existe, actualiza ese registro.
export async function saveBudget(b) {
  if (!b.categoryId) throw new Error('Falta la categoría');
  if (!Number.isSafeInteger(b.monthlyLimit) || b.monthlyLimit <= 0) throw new Error('Límite inválido (centavos enteros > 0)');
  const currency = b.currency || 'ARS';
  return run(['budgets'], 'readwrite', async (x) => {
    const store = x.objectStore('budgets');
    const existing = await req(store.index('catCur').get([b.categoryId, currency]));
    const saved = { ...b, currency, id: existing ? existing.id : (b.id || newId()) };
    // Si venía editando otro id con la misma clave, ese queda absorbido por el existente.
    if (existing && b.id && b.id !== existing.id) await req(store.delete(b.id));
    await req(store.put(saved));
    return saved;
  });
}

export async function deleteBudget(id) {
  await run(['budgets'], 'readwrite', (x) => req(x.objectStore('budgets').delete(id)));
}

// ---------- Fijos ----------

export async function listRecurring() {
  return run(['recurring'], 'readonly', (x) => req(x.objectStore('recurring').getAll()));
}

// Guarda el fijo y genera lo pendiente (si el día de este mes ya pasó, queda cargado hoy mismo).
export async function saveRecurring(r) {
  if (r.type !== 'expense' && r.type !== 'income') throw new Error('Tipo inválido');
  if (!Number.isSafeInteger(r.amount) || r.amount <= 0) throw new Error('Monto inválido (centavos enteros > 0)');
  if (!r.categoryId) throw new Error('Falta la categoría');
  if (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 31) throw new Error('Día inválido');
  const today = todayISO();
  const saved = await run(['recurring'], 'readwrite', async (x) => {
    const store = x.objectStore('recurring');
    const prev = r.id ? await req(store.get(r.id)) : null;
    const rec = {
      currency: 'ARS',
      note: '',
      active: true,
      lastGeneratedMonth: prev ? prev.lastGeneratedMonth : null,
      ...r,
      id: r.id || newId(),
    };
    // Reactivar no debe cargar los meses en que estuvo pausado: se retoma desde el mes actual.
    if (prev && !prev.active && rec.active) rec.lastGeneratedMonth = addMonths(monthKey(today), -1);
    await req(store.put(rec));
    return rec;
  });
  await generateRecurring(today);
  return saved;
}

export async function deleteRecurring(id) {
  await run(['recurring'], 'readwrite', (x) => req(x.objectStore('recurring').delete(id)));
}

// add() que tolera el índice único `rec`: ConstraintError = ya existe (otra pestaña) = false.
const addIgnoringDup = (store, value) => new Promise((resolve, reject) => {
  const r = store.add(value);
  r.onsuccess = () => resolve(true);
  r.onerror = (e) => {
    if (r.error && r.error.name === 'ConstraintError') {
      e.preventDefault(); // evita que aborte toda la transacción
      e.stopPropagation();
      resolve(false);
    } else reject(r.error);
  };
});

// Genera los movimientos de fijos vencidos hasta hoy. Una sola transacción readwrite:
// dos pestañas se serializan y el índice `rec` evita duplicados. Devuelve la cantidad creada.
// Un mes cuyo día todavía no llegó no se genera (queda pendiente para cuando llegue).
export async function generateRecurring(todayIso) {
  const currentYm = monthKey(todayIso);
  return run(['recurring', 'transactions'], 'readwrite', async (x) => {
    const recs = x.objectStore('recurring');
    const txs = x.objectStore('transactions');
    const now = Date.now();
    let created = 0;
    for (const rec of await req(recs.getAll())) {
      let last = null;
      for (const ym of pendingMonths(rec, currentYm)) {
        if (dueDate(rec, ym) > todayIso) break;
        if (await addIgnoringDup(txs, buildTx(rec, ym, now))) created++;
        last = ym;
      }
      if (last) await req(recs.put({ ...rec, lastGeneratedMonth: last }));
    }
    return created;
  }, (n) => n > 0);
}

// ---------- Análisis ----------

// Descarta una recomendación para un mes (idempotente).
export async function dismissInsight(key, month) {
  return run(['dismissed_insights'], 'readwrite', async (x) => {
    const store = x.objectStore('dismissed_insights');
    const rows = await req(store.index('month').getAll(month));
    if (rows.some((r) => r.insightKey === key)) return false;
    await req(store.add({ id: newId(), insightKey: key, month }));
    return true;
  }, (added) => added);
}

// Claves (string[]) de las recomendaciones descartadas en ese mes.
export async function listDismissed(month) {
  const rows = await run(['dismissed_insights'], 'readonly', (x) => req(x.objectStore('dismissed_insights').index('month').getAll(month)));
  return rows.map((r) => r.insightKey);
}

// Arma el input de analyze() en UNA pasada por el índice `date` (hasta el fin del mes pedido).
// En memoria solo quedan enteros (amounts), agregados por mes y los movimientos del mes.
export async function getAnalysisInput(ym, currency) {
  const { from, to } = monthRange(ym);
  const agg = await run(['transactions'], 'readonly', async (x) => {
    const r = { firstDate: null, totalCount: 0, monthly: {}, all: [], byCat: {}, monthTxs: [] };
    await cursorEach(x.objectStore('transactions').index('date').openCursor(IDBKeyRange.upperBound(to)), (c) => {
      const v = c.value;
      if ((v.currency || 'ARS') !== currency) return;
      r.totalCount++;
      if (!r.firstDate) r.firstDate = v.date; // el índice viene ordenado por fecha
      const k = monthKey(v.date);
      const m = r.monthly[k] || (r.monthly[k] = { income: 0, expense: 0, byCat: {}, byDow: [0, 0, 0, 0, 0, 0, 0] });
      if (v.type === 'income') {
        m.income += v.amount;
      } else {
        m.expense += v.amount;
        const bc = m.byCat[v.categoryId] || (m.byCat[v.categoryId] = { total: 0, count: 0 });
        bc.total += v.amount;
        bc.count++;
        m.byDow[dayOfWeek(v.date)] += v.amount;
        r.all.push(v.amount);
        (r.byCat[v.categoryId] || (r.byCat[v.categoryId] = [])).push(v.amount);
      }
      if (v.date >= from) r.monthTxs.push(fromStored(v));
    });
    return r;
  });
  const [categories, allBudgets, allRecurring, dismissed, groups] = await Promise.all([
    listCategories(), listBudgets(), listRecurring(), listDismissed(ym), listInstallmentGroups(),
  ]);
  return {
    month: ym, today: todayISO(), currency, firstDate: agg.firstDate, totalCount: agg.totalCount,
    monthly: agg.monthly, amounts: { all: agg.all, byCat: agg.byCat }, monthTxs: agg.monthTxs,
    categories, budgets: allBudgets.filter((b) => (b.currency || 'ARS') === currency),
    recurring: allRecurring.filter((r) => (r.currency || 'ARS') === currency),
    installments: groups.filter((g) => g.currency === currency),
    dismissed, // claves ya descartadas: analyze() las excluye antes de limitar a 5
  };
}

// ---------- Recibos (fase 7) ----------
// Una foto por movimiento: {txId, blob, createdAt}. Emiten 'change' (Historial marca los que tienen recibo).
// Al borrar un movimiento la foto queda hasta el próximo arranque (así Deshacer la recupera);
// pruneReceipts() limpia las huérfanas.

export async function saveReceipt(txId, blob) {
  if (!txId || !blob) throw new Error('Falta el recibo');
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const x = db.transaction(['receipts'], 'readwrite');
    x.objectStore('receipts').put({ txId, blob, createdAt: Date.now() });
    x.oncomplete = () => { dbEvents.dispatchEvent(new Event('change')); resolve(); };
    x.onerror = () => reject(x.error);
    x.onabort = () => reject(x.error || new Error('Transacción abortada'));
  });
}

export async function getReceipt(txId) {
  const r = await run(['receipts'], 'readonly', (x) => req(x.objectStore('receipts').get(txId)));
  return r ? r.blob : null;
}

export async function deleteReceipt(txId) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const x = db.transaction(['receipts'], 'readwrite');
    x.objectStore('receipts').delete(txId);
    x.oncomplete = () => { dbEvents.dispatchEvent(new Event('change')); resolve(); };
    x.onerror = () => reject(x.error);
  });
}

// Ids de movimientos con recibo (para marcar el ícono en Historial).
export async function listReceiptIds() {
  return run(['receipts'], 'readonly', (x) => req(x.objectStore('receipts').getAllKeys()));
}

// Borra recibos cuyo movimiento ya no existe. Devuelve cuántos borró.
export async function pruneReceipts() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const x = db.transaction(['receipts', 'transactions'], 'readwrite');
    const txs = x.objectStore('transactions');
    let n = 0;
    x.objectStore('receipts').openCursor().onsuccess = (e) => {
      const c = e.target.result;
      if (!c) return;
      const key = c.primaryKey;
      txs.getKey(key).onsuccess = (ev) => {
        if (ev.target.result === undefined) { c.delete(); n++; }
        c.continue();
      };
    };
    x.oncomplete = () => resolve(n);
    x.onerror = () => reject(x.error);
  });
}

// ---------- Backup ----------

export { validateDump };

// Vuelca todos los stores en una sola transacción de lectura (foto consistente).
// Los ajustes del candado (PIN, biometría) no salen: un backup no lleva el candado del dispositivo.
// lastBackupAt lo actualiza la UI/io con setSetting tras exportar.
export async function exportAll() {
  const stores = await run(STORE_NAMES, 'readonly', async (x) => {
    const out = {};
    for (const n of STORE_NAMES) out[n] = await req(x.objectStore(n).getAll());
    out.settings = out.settings.filter((r) => !DEVICE_SETTINGS.includes(r.key));
    return out;
  });
  return { schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), stores };
}

// Valida TODO antes de tocar la base y reemplaza en UNA transacción (si algo falla, aborta y no cambia nada).
// Conserva los ajustes del candado locales (pinHash, pinSalt, biometricCredentialId).
export async function importAll(dump) {
  const v = validateDump(dump);
  if (!v.ok) throw new Error(v.error);
  const s = dump.stores;
  await run(STORE_NAMES, 'readwrite', async (x) => {
    for (const n of STORE_NAMES) {
      const store = x.objectStore(n);
      if (n === 'settings') {
        const keys = await req(store.getAllKeys());
        for (const k of keys) if (!DEVICE_SETTINGS.includes(k)) await req(store.delete(k));
      } else {
        await req(store.clear());
      }
    }
    for (const n of STORE_NAMES) {
      const store = x.objectStore(n);
      for (const r of s[n]) {
        if (n === 'settings') {
          if (DEVICE_SETTINGS.includes(r.key)) continue;
          await req(store.put({ key: r.key, value: r.value }));
        } else {
          await req(store.put(n === 'transactions' ? toStored(fromStored(r)) : r)); // v1: rellena defaults
        }
      }
    }
  });
}
