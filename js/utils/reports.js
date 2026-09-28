// Reportes por día, semana o mes (puro, sin DOM). Importes en centavos, fechas 'YYYY-MM-DD'.
import { addDays, addMonths, dayOfWeek, dayLabel, monthKey, monthLabel, monthRange, parseISO } from './dates.js';
import { categoryShares, pctChange } from './summary.js';

export const PERIODS = ['dia', 'semana', 'mes'];
export const PERIOD_LABEL = { dia: 'Día', semana: 'Semana', mes: 'Mes' };

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const normalizePeriod = (p) => (PERIODS.includes(p) ? p : 'mes');

// Rango del período que contiene `iso`. La semana va de lunes a domingo.
export function periodRange(kind, iso) {
  if (kind === 'dia') return { from: iso, to: iso };
  if (kind === 'semana') {
    const back = (dayOfWeek(iso) + 6) % 7; // lunes = 0
    const from = addDays(iso, -back);
    return { from, to: addDays(from, 6) };
  }
  return monthRange(monthKey(iso));
}

// Corre el período n veces (n negativo = hacia atrás). Devuelve una fecha dentro del período nuevo.
export function shiftPeriod(kind, iso, n) {
  if (kind === 'dia') return addDays(iso, n);
  if (kind === 'semana') return addDays(periodRange('semana', iso).from, 7 * n);
  return addMonths(monthKey(iso), n) + '-01';
}

const shortDay = (iso) => {
  const { m, d } = parseISO(iso);
  return d + ' ' + MESES_CORTOS[m - 1];
};

// "Lun 21 sep" · "21 sep al 27 sep" · "Septiembre 2026"
export function periodLabel(kind, from, to) {
  if (kind === 'dia') return dayLabel(from);
  if (kind === 'semana') return shortDay(from) + ' al ' + shortDay(to);
  return monthLabel(monthKey(from));
}

// Días entre dos fechas, inclusive (from <= to).
export function daysBetween(from, to) {
  let n = 1;
  for (let d = from; d < to; d = addDays(d, 1)) n++;
  return n;
}

// Días del período ya transcurridos a `today` (mínimo 1; período pasado = todos).
export function elapsedDays(from, to, today) {
  if (today < from) return 1;
  return daysBetween(from, today < to ? today : to);
}

function emptyCur() {
  return {
    income: 0, expense: 0, count: 0,
    byCatMap: {}, byDayMap: {}, byMethod: {},
    fixed: 0, installments: 0, expenses: [],
  };
}

// Reporte del período por moneda.
// txs: movimientos (se filtran por rango). prevTxs: los del período anterior (para comparar).
// Devuelve {[currency]: {income, expense, balance, count, shares, byDay, avgPerDay, maxDay,
//   topExpenses, byMethod, fixed, installments, variable, incomeChange, expenseChange, projection}}.
export function buildReport(txs, { from, to, today }, prevTxs = []) {
  const acc = {};
  for (const t of txs || []) {
    if (t.date < from || t.date > to) continue;
    const cur = t.currency || 'ARS';
    const a = acc[cur] || (acc[cur] = emptyCur());
    a.count++;
    if (t.type === 'income') {
      a.income += t.amount;
      continue;
    }
    a.expense += t.amount;
    a.byCatMap[t.categoryId] = (a.byCatMap[t.categoryId] || 0) + t.amount;
    a.byDayMap[t.date] = (a.byDayMap[t.date] || 0) + t.amount;
    const m = t.paymentMethod || 'efectivo';
    a.byMethod[m] = (a.byMethod[m] || 0) + t.amount;
    if (t.recurringId) a.fixed += t.amount;
    else if (t.purchaseGroupId) a.installments += t.amount;
    a.expenses.push(t);
  }

  const prev = {};
  for (const t of prevTxs || []) {
    const cur = t.currency || 'ARS';
    const p = prev[cur] || (prev[cur] = { income: 0, expense: 0 });
    if (t.type === 'income') p.income += t.amount;
    else p.expense += t.amount;
  }

  const elapsed = elapsedDays(from, to, today);
  const total = daysBetween(from, to);
  const out = {};
  for (const [cur, a] of Object.entries(acc)) {
    const byDay = [];
    for (let d = from; d <= to; d = addDays(d, 1)) byDay.push({ date: d, cents: a.byDayMap[d] || 0 });
    let maxDay = null;
    for (const r of byDay) if (r.cents > 0 && (!maxDay || r.cents > maxDay.cents)) maxDay = r;
    const p = prev[cur] || { income: 0, expense: 0 };
    // Proyección: solo si el período está en curso y ya pasó al menos un día completo.
    const running = today >= from && today < to && total > 1;
    out[cur] = {
      income: a.income,
      expense: a.expense,
      balance: a.income - a.expense,
      count: a.count,
      shares: categoryShares(a.byCatMap),
      byDay,
      avgPerDay: Math.floor(a.expense / elapsed),
      maxDay,
      topExpenses: [...a.expenses].sort((x, y) => y.amount - x.amount || (x.date < y.date ? 1 : -1)).slice(0, 5),
      byMethod: a.byMethod,
      fixed: a.fixed,
      installments: a.installments,
      variable: a.expense - a.fixed - a.installments,
      incomeChange: pctChange(a.income, p.income),
      expenseChange: pctChange(a.expense, p.expense),
      projection: running ? Math.floor((a.expense * total) / elapsed) : null,
    };
  }
  return out;
}

// Agrupa byDay para el gráfico: día = 1 barra, semana = 7, mes = hasta 12 barras (bloques de días).
export function chartBuckets(byDay) {
  if (byDay.length <= 12) return byDay.map((r) => ({ from: r.date, to: r.date, cents: r.cents }));
  const size = Math.ceil(byDay.length / 12);
  const out = [];
  for (let i = 0; i < byDay.length; i += size) {
    const chunk = byDay.slice(i, i + size);
    out.push({ from: chunk[0].date, to: chunk[chunk.length - 1].date, cents: chunk.reduce((s, r) => s + r.cents, 0) });
  }
  return out;
}
