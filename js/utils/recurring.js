// Gastos/ingresos fijos (puro, sin DOM). Meses 'YYYY-MM', fechas 'YYYY-MM-DD'.
import { toISO, clampDay, addMonths, addDays } from './dates.js';

// Fecha de vencimiento del fijo en ese mes (día recortado a fin de mes: 31 en febrero -> 28/29).
export function dueDate(rec, ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return toISO(y, m, clampDay(y, m, rec.dayOfMonth));
}

// Meses a generar: desde lastGeneratedMonth+1 hasta currentYm inclusive.
// Si nunca generó, solo currentYm. Inactivo = nada.
export function pendingMonths(rec, currentYm) {
  if (!rec || !rec.active) return [];
  const start = rec.lastGeneratedMonth ? addMonths(rec.lastGeneratedMonth, 1) : currentYm;
  const out = [];
  // Comparación de strings 'YYYY-MM' == comparación cronológica.
  for (let ym = start; ym <= currentYm; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

// Movimiento generado por el fijo para ese mes. `now` = ms (o Date).
export function buildTx(rec, ym, now = Date.now()) {
  const ts = now instanceof Date ? now.getTime() : now;
  return {
    id: crypto.randomUUID(),
    type: rec.type,
    amount: rec.amount,
    currency: rec.currency || 'ARS',
    categoryId: rec.categoryId,
    date: dueDate(rec, ym),
    note: rec.note || '',
    recurringId: rec.id,
    recurringMonth: ym,
    createdAt: ts,
    updatedAt: ts,
  };
}

// Próximos vencimientos de fijos activos entre hoy y hoy+days (inclusive), sin los meses ya cargados.
// Devuelve [{rec, date}] ordenado por fecha.
export function upcoming(recs, todayIso, days = 30) {
  const limit = addDays(todayIso, days);
  const start = todayIso.slice(0, 7);
  const out = [];
  for (const rec of recs || []) {
    if (!rec.active) continue;
    for (let i = 0; i <= Math.ceil(days / 28); i++) {
      const ym = addMonths(start, i);
      if (rec.lastGeneratedMonth && ym <= rec.lastGeneratedMonth) continue;
      const date = dueDate(rec, ym);
      if (date >= todayIso && date <= limit) out.push({ rec, date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Compromiso mensual de los fijos activos por moneda: {[currency]: {expense, income}}.
export function monthlyCommitment(recs) {
  const out = {};
  for (const r of recs || []) {
    if (!r.active) continue;
    const cur = r.currency || 'ARS';
    const a = out[cur] || (out[cur] = { expense: 0, income: 0 });
    a[r.type === 'income' ? 'income' : 'expense'] += r.amount;
  }
  return out;
}

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

// Gastos que se repiten todos los meses y todavía no son fijos (ej. "Netflix" 3 meses seguidos).
// txs: movimientos de los últimos meses. Misma nota + categoría + moneda, en `minMonths` meses
// distintos de los últimos `lookback` (contando el actual), con montos a ±15% de la mediana.
// Devuelve hasta 5 [{note, categoryId, currency, amount, dayOfMonth, months, lastDate}] (monto y día del último).
export function detectRecurring(txs, recs, todayIso, { minMonths = 3, lookback = 4 } = {}) {
  const firstYm = addMonths(todayIso.slice(0, 7), -(lookback - 1));
  const known = new Set((recs || []).map((r) => fold(r.note) + '|' + r.categoryId));
  const groups = new Map();
  for (const t of txs || []) {
    if (t.type !== 'expense' || t.recurringId || t.purchaseGroupId) continue;
    if (t.date.slice(0, 7) < firstYm || t.date > todayIso) continue;
    const note = fold(t.note);
    if (!note) continue;
    const key = note + '|' + t.categoryId + '|' + (t.currency || 'ARS');
    if (known.has(note + '|' + t.categoryId)) continue;
    const g = groups.get(key) || { list: [] };
    g.list.push(t);
    groups.set(key, g);
  }
  const out = [];
  for (const { list } of groups.values()) {
    const months = new Set(list.map((t) => t.date.slice(0, 7)));
    if (months.size < minMonths) continue;
    const sorted = list.map((t) => t.amount).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (sorted.some((a) => Math.abs(a - median) * 100 > median * 15)) continue;
    const last = [...list].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    out.push({
      note: last.note.trim(), categoryId: last.categoryId, currency: last.currency || 'ARS',
      amount: last.amount, dayOfMonth: Number(last.date.slice(8, 10)), months: months.size, lastDate: last.date,
    });
  }
  return out.sort((a, b) => b.amount - a.amount).slice(0, 5);
}
