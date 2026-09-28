// Compras en cuotas (puro, sin DOM). Importes en centavos enteros, fechas 'YYYY-MM-DD'.
import { parseISO, toISO, clampDay, addMonths, monthKey } from './dates.js';

export const MAX_INSTALLMENTS = 60;

// Cantidad de cuotas válida: entero 1..60. Cualquier otra cosa -> 1 (compra común).
export function normalizeInstallments(v) {
  const n = typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v;
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_INSTALLMENTS);
}

// Reparte total en n cuotas: floor(total/n) en las primeras n-1 y el resto exacto en la última.
// La suma siempre es igual a total.
export function splitAmount(total, n) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Total inválido (centavos enteros)');
  if (!Number.isInteger(n) || n < 1) throw new Error('Cantidad de cuotas inválida');
  const each = Math.floor(total / n);
  const out = new Array(n).fill(each);
  out[n - 1] = total - each * (n - 1);
  return out;
}

// Fecha de la cuota `i` (0 = la compra): mismo día en cada mes siguiente, siempre calculado desde
// el día original (31 ene -> 28 feb -> 31 mar), nunca encadenando el día ya recortado.
export function installmentDate(iso, i) {
  const { y, m, d } = parseISO(iso);
  const ym = addMonths(monthKey(iso), i);
  const ny = Number(ym.slice(0, 4));
  const nm = Number(ym.slice(5, 7));
  return toISO(ny, nm, clampDay(ny, nm, d));
}

// Arma las cuotas de una compra. base.amount = total de la compra. n=1 devuelve un movimiento común
// (sin campos de grupo). La cuota 1 lleva purchaseTotal. `now` = ms (o Date).
export function buildInstallments(base, n, groupId, now = Date.now()) {
  const count = normalizeInstallments(n);
  const ts = now instanceof Date ? now.getTime() : now;
  const common = { note: '', currency: 'ARS', paymentMethod: 'efectivo', ...base };
  if (count === 1) {
    return [{ ...common, id: base.id || crypto.randomUUID(), createdAt: ts, updatedAt: ts,
      installmentNumber: null, totalInstallments: null, purchaseGroupId: null, purchaseTotal: null }];
  }
  const parts = splitAmount(base.amount, count);
  if (parts[0] <= 0) throw new Error('El monto es menor que la cantidad de cuotas');
  const gid = groupId || crypto.randomUUID();
  return parts.map((amount, i) => ({
    ...common,
    id: crypto.randomUUID(),
    amount,
    date: installmentDate(base.date, i),
    installmentNumber: i + 1,
    totalInstallments: count,
    purchaseGroupId: gid,
    purchaseTotal: i === 0 ? base.amount : null,
    createdAt: ts,
    updatedAt: ts,
  }));
}

// Agrupa movimientos con purchaseGroupId y devuelve solo los planes ACTIVOS (con cuotas después de `today`).
// Solo gastos. paid = cuotas con fecha <= today; remainingCents = suma de las posteriores;
// endMonth = 'YYYY-MM' de la última cuota; count = total del plan (totalInstallments) o las presentes.
export function groupInstallments(txs, today) {
  const groups = new Map();
  for (const t of txs) {
    if (!t.purchaseGroupId || t.type === 'income') continue;
    if (!groups.has(t.purchaseGroupId)) groups.set(t.purchaseGroupId, []);
    groups.get(t.purchaseGroupId).push(t);
  }
  const out = [];
  for (const [groupId, list] of groups) {
    list.sort((a, b) => (a.installmentNumber || 0) - (b.installmentNumber || 0) || (a.date < b.date ? -1 : 1));
    const future = list.filter((t) => t.date > today);
    if (!future.length) continue;
    const first = list[0];
    const total = list.reduce((s, t) => s + t.amount, 0);
    out.push({
      groupId,
      categoryId: first.categoryId,
      note: first.note || '',
      currency: first.currency || 'ARS',
      count: Math.max(list.length, ...list.map((t) => t.totalInstallments || 0)),
      paid: list.length - future.length,
      remainingCents: future.reduce((s, t) => s + t.amount, 0),
      endMonth: monthKey(list.reduce((m, t) => (t.date > m ? t.date : m), first.date)),
      purchaseTotal: (list.find((t) => t.purchaseTotal != null) || {}).purchaseTotal ?? total,
    });
  }
  return out;
}
