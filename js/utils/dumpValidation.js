// Validación pura de un backup (dump) ANTES de tocar la base. Sin DOM ni IndexedDB.
// Devuelve {ok:true} o {ok:false, error:'mensaje en español'}.

// v1: sin medios de pago ni cuotas (se acepta y se rellena al importar). v2: campos de la fase 6.
export const SCHEMA_VERSION = 2;
export const PAYMENT_METHODS = ['efectivo', 'debito', 'mp', 'credito'];
const MAX_INSTALLMENTS = 60;
export const STORE_NAMES = ['transactions', 'categories', 'budgets', 'recurring', 'settings', 'dismissed_insights'];
// Claves de settings que un backup nunca exporta ni importa (candado del dispositivo).
export const DEVICE_SETTINGS = ['pinHash', 'pinSalt', 'biometricCredentialId'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isCents = (v) => Number.isSafeInteger(v) && v > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Fecha real YYYY-MM-DD (rechaza 2026-02-30). Sin new Date(string).
function isISODate(s) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(y, mo, 0).getDate();
}

const isYM = (s) => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const optStr = (v) => v === undefined || v === null || typeof v === 'string';

function checkIds(name, rows) {
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!isObj(r)) return `${name}[${i}]: registro inválido`;
    if (!isStr(r.id)) return `${name}[${i}]: falta el id`;
    if (seen.has(r.id)) return `${name}[${i}]: id repetido`;
    seen.add(r.id);
  }
  return null;
}

export function validateDump(dump) {
  const fail = (error) => ({ ok: false, error });
  if (!isObj(dump)) return fail('El archivo no es un backup válido');
  if (!Number.isInteger(dump.schemaVersion) || dump.schemaVersion < 1) return fail('Falta la versión del backup');
  if (dump.schemaVersion > SCHEMA_VERSION) return fail('El backup es de una versión más nueva de la app');
  if (!isObj(dump.stores)) return fail('Faltan los datos del backup');
  for (const n of STORE_NAMES) {
    if (!Array.isArray(dump.stores[n])) return fail(`Falta la sección ${n}`);
  }
  const s = dump.stores;

  for (const n of ['transactions', 'categories', 'budgets', 'recurring', 'dismissed_insights']) {
    const e = checkIds(n, s[n]);
    if (e) return fail(e);
  }

  // Categorías
  for (let i = 0; i < s.categories.length; i++) {
    const c = s.categories[i];
    const p = `categories[${i}]`;
    if (!isStr(c.name)) return fail(`${p}: falta el nombre`);
    if (typeof c.emoji !== 'string') return fail(`${p}: emoji inválido`);
    if (!isStr(c.color)) return fail(`${p}: color inválido`);
    if (!isNum(c.sortOrder)) return fail(`${p}: orden inválido`);
    if (c.kind !== 'essential' && c.kind !== 'flexible') return fail(`${p}: tipo de categoría inválido`);
  }
  const catIds = new Set(s.categories.map((c) => c.id));

  // Movimientos
  const recKeys = new Set();
  const cuotaKeys = new Set();
  for (let i = 0; i < s.transactions.length; i++) {
    const t = s.transactions[i];
    const p = `transactions[${i}]`;
    if (t.type !== 'expense' && t.type !== 'income') return fail(`${p}: tipo inválido`);
    if (!isCents(t.amount)) return fail(`${p}: el monto debe ser un entero en centavos mayor a 0`);
    if (!isStr(t.currency)) return fail(`${p}: moneda inválida`);
    if (!isStr(t.categoryId)) return fail(`${p}: falta la categoría`);
    if (!catIds.has(t.categoryId)) return fail(`${p}: la categoría no existe en el backup`);
    if (!isISODate(t.date)) return fail(`${p}: fecha inválida`);
    if (!optStr(t.note)) return fail(`${p}: nota inválida`);
    if (!optStr(t.recurringId) || !optStr(t.recurringMonth)) return fail(`${p}: datos de fijo inválidos`);
    if (t.recurringId != null) {
      if (!isYM(t.recurringMonth)) return fail(`${p}: mes de fijo inválido`);
      const k = t.recurringId + '|' + t.recurringMonth;
      if (recKeys.has(k)) return fail(`${p}: fijo duplicado en el mismo mes`);
      recKeys.add(k);
    }
    for (const f of ['createdAt', 'updatedAt']) {
      if (t[f] !== undefined && !isNum(t[f])) return fail(`${p}: ${f} inválido`);
    }
    // Fase 6 (opcionales: en v1 no existen; ausente o null = valor por defecto).
    if (t.paymentMethod != null && !PAYMENT_METHODS.includes(t.paymentMethod)) return fail(`${p}: medio de pago inválido`);
    const num = t.installmentNumber;
    const tot = t.totalInstallments;
    if (num != null && !(Number.isSafeInteger(num) && num >= 1 && num <= MAX_INSTALLMENTS)) return fail(`${p}: número de cuota inválido`);
    if (tot != null && !(Number.isSafeInteger(tot) && tot >= 1 && tot <= MAX_INSTALLMENTS)) return fail(`${p}: total de cuotas inválido`);
    if (num != null && tot != null && num > tot) return fail(`${p}: la cuota supera el total de cuotas`);
    if (t.purchaseTotal != null && !isCents(t.purchaseTotal)) return fail(`${p}: total de la compra inválido`);
    if (t.purchaseGroupId != null) {
      if (!isStr(t.purchaseGroupId)) return fail(`${p}: grupo de compra inválido`);
      if (num == null || tot == null) return fail(`${p}: falta el número o total de cuotas`);
      const k = t.purchaseGroupId + '|' + num;
      if (cuotaKeys.has(k)) return fail(`${p}: cuota repetida en el mismo grupo`);
      cuotaKeys.add(k);
    }
  }

  // Presupuestos
  const budKeys = new Set();
  for (let i = 0; i < s.budgets.length; i++) {
    const b = s.budgets[i];
    const p = `budgets[${i}]`;
    if (!isStr(b.categoryId) || !catIds.has(b.categoryId)) return fail(`${p}: la categoría no existe en el backup`);
    if (!isCents(b.monthlyLimit)) return fail(`${p}: el límite debe ser un entero en centavos mayor a 0`);
    if (!isStr(b.currency)) return fail(`${p}: moneda inválida`);
    const k = b.categoryId + '|' + b.currency;
    if (budKeys.has(k)) return fail(`${p}: presupuesto repetido para la categoría y moneda`);
    budKeys.add(k);
  }

  // Fijos
  for (let i = 0; i < s.recurring.length; i++) {
    const r = s.recurring[i];
    const p = `recurring[${i}]`;
    if (r.type !== 'expense' && r.type !== 'income') return fail(`${p}: tipo inválido`);
    if (!isCents(r.amount)) return fail(`${p}: el monto debe ser un entero en centavos mayor a 0`);
    if (!isStr(r.currency)) return fail(`${p}: moneda inválida`);
    if (!isStr(r.categoryId) || !catIds.has(r.categoryId)) return fail(`${p}: la categoría no existe en el backup`);
    if (!Number.isInteger(r.dayOfMonth) || r.dayOfMonth < 1 || r.dayOfMonth > 31) return fail(`${p}: día inválido`);
    if (!optStr(r.note)) return fail(`${p}: nota inválida`);
    if (typeof r.active !== 'boolean') return fail(`${p}: estado inválido`);
    if (r.lastGeneratedMonth != null && !isYM(r.lastGeneratedMonth)) return fail(`${p}: último mes generado inválido`);
  }

  // Ajustes
  const setKeys = new Set();
  for (let i = 0; i < s.settings.length; i++) {
    const r = s.settings[i];
    if (!isObj(r) || !isStr(r.key)) return fail(`settings[${i}]: falta la clave`);
    if (!('value' in r)) return fail(`settings[${i}]: falta el valor`);
    if (setKeys.has(r.key)) return fail(`settings[${i}]: clave repetida`);
    setKeys.add(r.key);
  }

  // Recomendaciones descartadas
  for (let i = 0; i < s.dismissed_insights.length; i++) {
    const d = s.dismissed_insights[i];
    if (!isStr(d.insightKey)) return fail(`dismissed_insights[${i}]: clave inválida`);
    if (!isYM(d.month)) return fail(`dismissed_insights[${i}]: mes inválido`);
  }

  return { ok: true };
}
