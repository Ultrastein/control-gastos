// Análisis de gastos (puro, sin DOM). Importes en centavos enteros; una moneda por llamada.
// Porcentajes: enteros redondeados. Nunca se recomienda nada sobre categorías 'essential'.
import { CONFIG } from './analysisConfig.js';
import { formatMoney } from './money.js';
import { parseISO, daysInMonth, monthKey, addMonths, dayLabel } from './dates.js';

const EMPTY_MONTH = Object.freeze({ income: 0, expense: 0, byCat: {}, byDow: [0, 0, 0, 0, 0, 0, 0] });

const pct = (a, b) => (b > 0 ? Math.round((a * 100) / b) : null);
const sum = (arr) => arr.reduce((s, x) => s + x, 0);

// Días entre dos ISO (aritmética UTC, sin parsear strings con Date).
function daysBetween(a, b) {
  const p = parseISO(a);
  const q = parseISO(b);
  return Math.round((Date.UTC(q.y, q.m - 1, q.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000);
}

const sortedCopy = (arr) => Float64Array.from(arr).sort();

// Percentil por rango más cercano sobre un arreglo ordenado.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil((sorted.length * p) / 100) - 1)];
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return null;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function ctx(input) {
  const cats = {};
  for (const c of input.categories || []) cats[c.id] = c;
  const cur = input.currency;
  return {
    cats,
    cur,
    name: (id) => (cats[id] ? cats[id].name : 'Sin categoría'),
    // Categoría desconocida (borrada) cuenta como flexible.
    essential: (id) => !!cats[id] && cats[id].kind === 'essential',
    fm: (c) => formatMoney(c, cur),
    month: (ym) => (input.monthly && input.monthly[ym]) || EMPTY_MONTH,
  };
}

function radiography(input, x, cfg) {
  const m = x.month(input.month);
  const cats = Object.entries(m.byCat).map(([catId, v]) => ({ catId, total: v.total, count: v.count }));
  cats.sort((a, b) => b.total - a.total);
  let essential = 0;
  for (const c of cats) if (x.essential(c.catId)) essential += c.total;
  const balance = m.income - m.expense;
  return {
    month: input.month,
    currency: input.currency,
    income: m.income,
    expense: m.expense,
    balance,
    savingsRate: pct(balance, m.income), // null si no hay ingresos
    count: sum(cats.map((c) => c.count)),
    topCategories: cats.filter((c) => c.total > 0).slice(0, cfg.topCategories).map((c) => ({
      catId: c.catId,
      total: c.total,
      pctOfExpense: pct(c.total, m.expense),
      pctOfIncome: pct(c.total, m.income),
    })),
    essential: { total: essential, pct: pct(essential, m.expense) },
    flexible: { total: m.expense - essential, pct: pct(m.expense - essential, m.expense) },
  };
}

function fixedWeight(input, x, income) {
  const items = (input.recurring || [])
    .filter((r) => r.active !== false && r.type === 'expense' && (r.currency || x.cur) === x.cur)
    .map((r) => ({
      id: r.id, note: r.note || '', catId: r.categoryId, amount: r.amount,
      yearly: r.amount * 12, pctOfIncome: pct(r.amount, income),
    }))
    .sort((a, b) => b.amount - a.amount);
  const total = sum(items.map((i) => i.amount));
  // Compras en cuotas activas (input.installments = listInstallmentGroups de la moneda): lo que queda por pagar.
  const installments = (input.installments || [])
    .filter((g) => g.remainingCents > 0 && (g.currency || x.cur) === x.cur)
    .map((g) => ({ groupId: g.groupId, catId: g.categoryId, note: g.note || '', remaining: g.remainingCents,
      endMonth: g.endMonth, count: g.count, paid: g.paid }))
    .sort((a, b) => b.remaining - a.remaining);
  return { income, total, yearlyTotal: total * 12, pctOfIncome: pct(total, income), items, installments };
}

function weekly(input, x, cfg) {
  const months = Object.keys(input.monthly || {}).filter((k) => x.month(k).expense > 0);
  if (months.length < cfg.weeklyMinMonths) return null;
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  for (const k of months) for (let i = 0; i < 7; i++) byDow[i] += x.month(k).byDow[i] || 0;
  const total = sum(byDow);
  if (total <= 0) return null;
  let peak = 0;
  for (let i = 1; i < 7; i++) if (byDow[i] > byDow[peak]) peak = i;
  return {
    months: months.length, byDow, pctByDow: byDow.map((v) => pct(v, total)),
    peakDow: peak, peakTotal: byDow[peak], peakPct: pct(byDow[peak], total),
  };
}

// Meses previos con datos (gasto > 0) dentro de la ventana de promedio.
function priorMonths(input, x, cfg) {
  const out = [];
  for (let i = 1; i <= cfg.avgMonths; i++) {
    const ym = addMonths(input.month, -i);
    if (x.month(ym).expense > 0) out.push(ym);
  }
  return out;
}

function trends(input, x, cfg, prior) {
  const ym = input.month;
  const m1 = addMonths(ym, -1);
  const m2 = addMonths(ym, -2);
  const hasAvg = prior.length === cfg.avgMonths;
  const build = (catId, get) => {
    const current = get(x.month(ym));
    const prev = get(x.month(m1));
    const avg = hasAvg ? Math.round(sum(prior.map((k) => get(x.month(k)))) / prior.length) : null;
    const v2 = get(x.month(m2));
    const rising = cfg.streakMonths === 3 && v2 > 0 && v2 < prev && prev < current;
    const aboveAvg = avg != null && avg > 0 && current * 100 > avg * (100 + cfg.aboveAvgPct);
    return {
      scope: catId == null ? 'total' : 'category', catId, current, prev,
      deltaPrevPct: prev > 0 ? Math.round(((current - prev) * 100) / prev) : null,
      avg, deltaAvgPct: avg > 0 ? Math.round(((current - avg) * 100) / avg) : null,
      rising, aboveAvg, flagged: rising || aboveAvg,
    };
  };
  const ids = new Set();
  for (const k of [ym, m1, m2, ...prior]) for (const id of Object.keys(x.month(k).byCat)) ids.add(id);
  const list = [build(null, (m) => m.expense)];
  for (const id of ids) {
    const t = build(id, (m) => (m.byCat[id] ? m.byCat[id].total : 0));
    if (t.current > 0 || t.prev > 0) list.push(t);
  }
  return list;
}

function projection(input, x, cfg) {
  const today = parseISO(input.today);
  if (monthKey(input.today) !== input.month || today.d < cfg.projectionMinDay) return null;
  const dim = daysInMonth(today.y, today.m);
  const m = x.month(input.month);
  const proj = (v) => Math.round((v * dim) / today.d);
  const projectedExpense = proj(m.expense);
  return {
    day: today.d, daysInMonth: dim, spent: m.expense,
    dailyAverage: Math.round(m.expense / today.d),
    projectedExpense, income: m.income, projectedBalance: m.income - projectedExpense,
    exceedsIncome: m.income > 0 && projectedExpense > m.income,
    budgets: (input.budgets || []).filter((b) => (b.currency || x.cur) === x.cur).map((b) => {
      const spent = m.byCat[b.categoryId] ? m.byCat[b.categoryId].total : 0;
      const projected = proj(spent);
      return {
        catId: b.categoryId, limit: b.monthlyLimit, spent, projected,
        alreadyOver: b.monthlyLimit > 0 && spent >= b.monthlyLimit,
        willExceed: b.monthlyLimit > 0 && projected > b.monthlyLimit,
      };
    }),
  };
}

function levelFor(p, cfg) {
  return p >= cfg.budgetOverPct ? 'over' : p >= cfg.budgetWarnPct ? 'warn' : 'ok';
}

// Gastos manuales de la moneda (los fijos generados no cuentan como hormiga/duplicado/inusual).
function manualExpenses(input, x) {
  return (input.monthTxs || []).filter((t) => t.type === 'expense' && !t.recurringId && (t.currency || x.cur) === x.cur);
}

function findDuplicates(input, x, cfg) {
  const groups = new Map();
  for (const t of manualExpenses(input, x)) {
    const k = t.categoryId + '|' + t.amount;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  const out = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let cluster = [list[0]];
    const flush = () => {
      if (cluster.length >= 2) {
        const first = cluster[0];
        out.push({
          key: 'dup:' + first.categoryId + ':' + first.amount + ':' + first.date,
          catId: first.categoryId, amount: first.amount, count: cluster.length,
          extra: first.amount * (cluster.length - 1), essential: x.essential(first.categoryId),
          txIds: cluster.map((t) => t.id), dates: cluster.map((t) => t.date),
        });
      }
    };
    for (let i = 1; i < list.length; i++) {
      if (daysBetween(list[i - 1].date, list[i].date) <= cfg.duplicateDayWindow) cluster.push(list[i]);
      else { flush(); cluster = [list[i]]; }
    }
    flush();
  }
  return out.sort((a, b) => b.extra - a.extra);
}

function buildInsights(input, x, cfg, ctxData) {
  const { trendList, prior, duplicates, budgetList } = ctxData;
  const fm = x.fm;
  const out = [];
  const m = x.month(input.month);
  const push = (i) => { if (!i.catId || !x.essential(i.catId)) out.push(i); };

  // Tendencia por categoría flexible.
  const trendCats = new Set();
  for (const t of trendList) {
    if (t.scope !== 'category' || !t.flagged || x.essential(t.catId)) continue;
    const name = x.name(t.catId);
    let saving;
    let text;
    if (t.aboveAvg) {
      saving = t.current - t.avg;
      text = name + ': ' + fm(t.current) + ' este mes, ' + t.deltaAvgPct + '% más que tu promedio de ' +
        cfg.avgMonths + ' meses (' + fm(t.avg) + '). Volver al promedio te ahorra ' + fm(saving) + '.';
    } else {
      saving = t.current - t.prev;
      text = name + ' subió ' + cfg.streakMonths + ' meses seguidos, hasta ' + fm(t.current) +
        ' este mes (' + fm(t.prev) + ' el mes pasado). Volver al nivel anterior te ahorra ' + fm(saving) + '.';
    }
    if (saving <= 0) continue;
    trendCats.add(t.catId);
    push({
      key: 'trend:' + t.catId, type: 'trend', catId: t.catId, text,
      evidence: { current: t.current, prev: t.prev, avg: t.avg, deltaAvgPct: t.deltaAvgPct, rising: t.rising },
      savingsMonthly: saving, savingsYearly: saving * 12,
      action: { kind: 'open-simulator', catId: t.catId, pct: Math.min(100, pct(saving, t.current)) },
    });
  }

  // Gastos hormiga: chicos (< p25 de todos los gastos) en categorías flexibles.
  const all = input.amounts && input.amounts.all;
  if (all && all.length) {
    const thr = percentile(sortedCopy(all), cfg.antPercentile);
    const ants = {};
    for (const t of manualExpenses(input, x)) {
      if (x.essential(t.categoryId) || !(t.amount < thr)) continue;
      const a = ants[t.categoryId] || (ants[t.categoryId] = { count: 0, total: 0 });
      a.count++;
      a.total += t.amount;
    }
    for (const [catId, a] of Object.entries(ants)) {
      if (a.count < cfg.antMinCount) continue;
      const saving = Math.floor(a.total * cfg.antSavingsRatio);
      if (saving <= 0) continue;
      const catTotal = m.byCat[catId] ? m.byCat[catId].total : a.total;
      push({
        key: 'ants:' + catId, type: 'ants', catId,
        text: x.name(catId) + ': ' + a.count + ' gastos chicos (menos de ' + fm(thr) + ' cada uno) sumaron ' +
          fm(a.total) + ' este mes. Recortar la mitad te ahorra ' + fm(saving) + '.',
        evidence: { count: a.count, total: a.total, threshold: thr },
        savingsMonthly: saving, savingsYearly: saving * 12,
        action: { kind: 'open-simulator', catId, pct: Math.min(100, pct(saving, catTotal)) },
      });
    }
  }

  // Inusuales: > factor × mediana de su categoría, con historia suficiente.
  const medians = {};
  const byCat = (input.amounts && input.amounts.byCat) || {};
  for (const t of manualExpenses(input, x)) {
    if (x.essential(t.categoryId)) continue;
    const hist = byCat[t.categoryId];
    if (!hist || hist.length - 1 < cfg.unusualMinHistory) continue;
    const med = medians[t.categoryId] !== undefined ? medians[t.categoryId] : (medians[t.categoryId] = median(sortedCopy(hist)));
    if (!(med > 0) || !(t.amount > med * cfg.unusualFactor)) continue;
    const saving = t.amount - med;
    const times = (t.amount / med).toFixed(1).replace('.', ',');
    push({
      key: 'unusual:' + t.id, type: 'unusual', catId: t.categoryId,
      text: x.name(t.categoryId) + ': un gasto de ' + fm(t.amount) + ' (' + dayLabel(t.date) + ') es ' + times +
        ' veces tu gasto típico en esta categoría (' + fm(med) + '). Llevarlo a lo típico habría ahorrado ' + fm(saving) + '.',
      evidence: { txId: t.id, amount: t.amount, median: med, date: t.date },
      savingsMonthly: saving, savingsYearly: saving, // puntual: no se anualiza
      action: { kind: 'none' },
    });
  }

  // Duplicados (mismo monto y categoría en fechas cercanas), solo flexibles.
  for (const d of duplicates) {
    if (d.essential) continue;
    push({
      key: d.key, type: 'duplicate', catId: d.catId,
      text: x.name(d.catId) + ': ' + d.count + ' gastos de ' + fm(d.amount) + ' en fechas cercanas (' +
        dayLabel(d.dates[0]) + ' a ' + dayLabel(d.dates[d.dates.length - 1]) + '). Si uno fue un error, revisarlo te ahorra ' + fm(d.extra) + '.',
      evidence: { amount: d.amount, count: d.count, dates: d.dates },
      savingsMonthly: d.extra, savingsYearly: d.extra,
      action: { kind: 'review-duplicates', txIds: d.txIds },
    });
  }

  // Tope sugerido: categorías flexibles sin tope o con tope superado, sin insight de tendencia.
  for (const b of budgetList) {
    if (b.suggestedLimit == null || x.essential(b.catId) || trendCats.has(b.catId)) continue;
    if (!(b.spent > b.suggestedLimit)) continue;
    const hasBudget = b.budgetId != null;
    if (hasBudget && (b.level !== 'over' || b.suggestedLimit >= b.limit)) continue;
    const saving = b.spent - b.suggestedLimit;
    const basis = ' (tu promedio de ' + cfg.avgMonths + ' meses menos ' + cfg.budgetDiscountPct + '%)';
    push({
      key: 'budget:' + b.catId, type: 'budget', catId: b.catId,
      text: hasBudget
        ? x.name(b.catId) + ': gastaste ' + fm(b.spent) + ' y tu tope es ' + fm(b.limit) + '. Un tope de ' + fm(b.suggestedLimit) + basis + ' te ahorra ' + fm(saving) + '.'
        : x.name(b.catId) + ': gastaste ' + fm(b.spent) + ' este mes y no tenés tope. Uno de ' + fm(b.suggestedLimit) + basis + ' te ahorra ' + fm(saving) + '.',
      evidence: { spent: b.spent, limit: b.limit, suggestedLimit: b.suggestedLimit },
      savingsMonthly: saving, savingsYearly: saving * 12,
      action: { kind: 'apply-budget', catId: b.catId, monthlyLimit: b.suggestedLimit, currency: x.cur, budgetId: b.budgetId },
    });
  }

  const dismissed = new Set(input.dismissed || []);
  return out
    .filter((i) => !dismissed.has(i.key))
    .sort((a, b) => b.savingsMonthly - a.savingsMonthly || (a.key < b.key ? -1 : 1))
    .slice(0, cfg.maxInsights);
}

function budgets(input, x, cfg, prior) {
  const m = x.month(input.month);
  const hasAvg = prior.length === cfg.avgMonths;
  return (input.budgets || []).filter((b) => (b.currency || x.cur) === x.cur).map((b) => {
    const spent = m.byCat[b.categoryId] ? m.byCat[b.categoryId].total : 0;
    const p = b.monthlyLimit > 0 ? Math.floor((spent * 100) / b.monthlyLimit) : 0;
    return { budgetId: b.id, catId: b.categoryId, limit: b.monthlyLimit, spent, pct: p, level: levelFor(p, cfg),
      ...suggestion(input, x, cfg, prior, hasAvg, b.categoryId) };
  });
}

// Tope sugerido = promedio de los meses previos - descuento. Solo flexibles.
function suggestion(input, x, cfg, prior, hasAvg, catId) {
  if (!hasAvg || x.essential(catId)) return { suggestedLimit: null };
  const avg = sum(prior.map((k) => (x.month(k).byCat[catId] ? x.month(k).byCat[catId].total : 0))) / prior.length;
  const s = Math.round((avg * (100 - cfg.budgetDiscountPct)) / 100);
  return { suggestedLimit: s > 0 ? s : null };
}

export function analyze(input, config = CONFIG) {
  const cfg = { ...CONFIG, ...config };
  const x = ctx(input);
  const radio = radiography(input, x, cfg);
  const fixed = fixedWeight(input, x, radio.income);
  const days = input.firstDate ? daysBetween(input.firstDate, input.today) + 1 : 0;
  const count = input.totalCount || 0;
  const base = { currency: input.currency, radiography: radio, trends: [], projection: null, insights: [],
    duplicates: [], fixedWeight: fixed, weekly: null, budgets: [] };
  if (count < cfg.minTransactions || days < cfg.minDaysOfUse) {
    return { status: 'insufficient', ...base,
      progress: { count, days, minCount: cfg.minTransactions, minDays: cfg.minDaysOfUse } };
  }
  const prior = priorMonths(input, x, cfg);
  const trendList = trends(input, x, cfg, prior);
  const duplicates = findDuplicates(input, x, cfg);
  const budgetList = budgets(input, x, cfg, prior);

  // Categorías flexibles sin tope también reciben sugerencia (entradas sintéticas sin budgetId).
  const withBudget = new Set(budgetList.map((b) => b.catId));
  const m = x.month(input.month);
  const suggestOnly = [];
  for (const [catId, v] of Object.entries(m.byCat)) {
    if (withBudget.has(catId) || x.essential(catId)) continue;
    const s = suggestion(input, x, cfg, prior, prior.length === cfg.avgMonths, catId);
    suggestOnly.push({ budgetId: null, catId, limit: null, spent: v.total, pct: 0, level: 'none', ...s });
  }

  const insights = buildInsights(input, x, cfg, { trendList, prior, duplicates, budgetList: budgetList.concat(suggestOnly) });
  return { status: 'ok', ...base, trends: trendList, projection: projection(input, x, cfg), insights, duplicates,
    weekly: weekly(input, x, cfg), budgets: budgetList };
}

// Simula reducir pct% el gasto del mes en una categoría.
export function simulate(input, catId, pct100) {
  const m = (input.monthly && input.monthly[input.month]) || EMPTY_MONTH;
  const p = Math.min(100, Math.max(0, Number(pct100) || 0));
  const catTotal = m.byCat[catId] ? m.byCat[catId].total : 0;
  const monthly = Math.round((catTotal * p) / 100);
  const newBalance = m.income - (m.expense - monthly);
  return { monthly, yearly: monthly * 12, newBalance, newSavingsRate: pct(newBalance, m.income) };
}
