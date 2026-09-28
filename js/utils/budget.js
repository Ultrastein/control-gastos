// Estado de un presupuesto (puro). Importes en centavos.

export const WARN_PCT = 80;
export const OVER_PCT = 100;

const RANK = { ok: 0, warn: 1, over: 2 };

// pct entero (piso) del gasto sobre el límite; límite <= 0 => 0% y 'ok' (sin dividir por 0).
export function budgetStatus(spent, limit) {
  if (!(limit > 0)) return { pct: 0, level: 'ok' };
  const pct = Math.floor((Math.max(spent, 0) * 100) / limit);
  const level = pct >= OVER_PCT ? 'over' : pct >= WARN_PCT ? 'warn' : 'ok';
  return { pct, level };
}

// Límite general de gasto del mes (setting 'spendLimit' = {amount, currency} o null).
export function normalizeLimit(v) {
  if (!v || typeof v !== 'object') return null;
  if (!Number.isSafeInteger(v.amount) || v.amount <= 0) return null;
  return { amount: v.amount, currency: typeof v.currency === 'string' && v.currency ? v.currency : 'ARS' };
}

// Cuánto queda para gastar y cuánto por día (hoy incluido) hasta fin de mes. Nunca negativo.
// daysLeft = días que faltan contando hoy (>= 1).
export function allowance(limit, spent, daysLeft) {
  const left = Math.max(0, limit - Math.max(spent, 0));
  return { left, perDay: Math.floor(left / Math.max(1, daysLeft)) };
}

// null si no cruzó un umbral nuevo; si no, el nivel alcanzado ('warn' | 'over').
export function crossedLevel(prevSpent, newSpent, limit) {
  const before = budgetStatus(prevSpent, limit).level;
  const after = budgetStatus(newSpent, limit).level;
  return RANK[after] > RANK[before] ? after : null;
}
