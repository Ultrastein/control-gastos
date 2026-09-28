// Cálculos puros del Resumen (sin DOM). Importes en centavos enteros.

// Variación porcentual entera de cur respecto de prev. null si no hay base (prev = 0).
export function pctChange(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) * 100) / prev);
}

// Reparto por categoría: [{catId, cents, pct}] ordenado de mayor a menor.
// pct es entero (0-100) y suma 100 (método del mayor resto). Vacío si el total es 0.
export function categoryShares(byCat) {
  const rows = Object.entries(byCat || {})
    .map(([catId, cents]) => ({ catId, cents }))
    .filter((r) => r.cents > 0)
    .sort((a, b) => b.cents - a.cents || (a.catId < b.catId ? -1 : 1));
  const total = rows.reduce((s, r) => s + r.cents, 0);
  if (!total) return [];
  let used = 0;
  for (const r of rows) {
    r.pct = Math.floor((r.cents * 100) / total);
    r.rem = (r.cents * 100) % total;
    used += r.pct;
  }
  // Repartir los puntos que faltan a los de mayor resto.
  const order = [...rows].sort((a, b) => b.rem - a.rem);
  for (let i = 0; i < 100 - used; i++) order[i].pct += 1;
  for (const r of rows) delete r.rem;
  return rows;
}

// Resumen de una moneda del mes contra el mes anterior.
// cur/prev: {income, expense, byCat} o undefined. Devuelve saldo y variaciones (null si no hay base).
export function summarize(cur, prev) {
  const c = { income: 0, expense: 0, byCat: {}, ...(cur || {}) };
  const p = { income: 0, expense: 0, byCat: {}, ...(prev || {}) };
  return {
    income: c.income,
    expense: c.expense,
    balance: c.income - c.expense,
    shares: categoryShares(c.byCat),
    incomeChange: pctChange(c.income, p.income),
    expenseChange: pctChange(c.expense, p.expense),
    hasPrev: p.income > 0 || p.expense > 0,
  };
}
