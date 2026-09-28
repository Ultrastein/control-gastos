import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, simulate } from '../js/utils/analysis.js';
import { CONFIG } from '../js/utils/analysisConfig.js';
import { dayOfWeek, monthKey } from '../js/utils/dates.js';

const CATS = [
  { id: 'com', name: 'Comida', kind: 'flexible' },
  { id: 'sal', name: 'Salidas', kind: 'flexible' },
  { id: 'alq', name: 'Alquiler', kind: 'essential' },
  { id: 'tra', name: 'Transporte', kind: 'essential' },
];
const $ = (pesos) => pesos * 100;

// Arma el input como lo haría db.getAnalysisInput a partir de una lista de movimientos.
function build(txs, { month = '2026-09', today = '2026-09-21', currency = 'ARS', budgets = [], recurring = [], categories = CATS } = {}) {
  const list = txs.filter((t) => (t.currency || 'ARS') === currency).map((t, i) => ({
    id: t.id || 't' + i, currency, type: 'expense', recurringId: null, ...t,
  }));
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  const monthly = {};
  const all = [];
  const byCat = {};
  for (const t of list) {
    const m = monthly[monthKey(t.date)] || (monthly[monthKey(t.date)] = { income: 0, expense: 0, byCat: {}, byDow: [0, 0, 0, 0, 0, 0, 0] });
    if (t.type === 'income') { m.income += t.amount; continue; }
    m.expense += t.amount;
    const c = m.byCat[t.categoryId] || (m.byCat[t.categoryId] = { total: 0, count: 0 });
    c.total += t.amount; c.count++;
    m.byDow[dayOfWeek(t.date)] += t.amount;
    all.push(t.amount);
    (byCat[t.categoryId] || (byCat[t.categoryId] = [])).push(t.amount);
  }
  return {
    month, today, currency, firstDate: list.length ? list[0].date : null, totalCount: list.length, monthly,
    amounts: { all, byCat }, monthTxs: list.filter((t) => monthKey(t.date) === month),
    categories, budgets, recurring,
  };
}

const ex = (date, amount, categoryId = 'com', extra = {}) => ({ type: 'expense', date, amount, categoryId, ...extra });
const inc = (date, amount) => ({ type: 'income', date, amount, categoryId: 'com' });

// Historial de 3 meses con Comida/Alquiler estables y Salidas configurable.
function history(salidasSep = $(84000), salidasPrev = $(60900)) {
  const t = [];
  for (const [ym, s] of [['2026-06', $(60900)], ['2026-07', $(60900)], ['2026-08', salidasPrev], ['2026-09', salidasSep]]) {
    t.push(inc(ym + '-01', $(500000)));
    t.push(ex(ym + '-02', $(100000), 'alq'));
    t.push(ex(ym + '-05', $(40000), 'com'));
    t.push(ex(ym + '-10', s, 'sal'));
    t.push(ex(ym + '-15', $(30000), 'com'));
  }
  return t;
}

test('mes sin datos: insufficient, sin romper', () => {
  const r = analyze(build([]));
  assert.equal(r.status, 'insufficient');
  assert.equal(r.radiography.expense, 0);
  assert.equal(r.radiography.savingsRate, null);
  assert.deepEqual(r.insights, []);
});

test('menos de 10 movimientos o de 14 días: insufficient', () => {
  const few = [];
  for (let d = 1; d <= 9; d++) few.push(ex('2026-08-' + String(d).padStart(2, '0'), $(100)));
  assert.equal(analyze(build(few)).status, 'insufficient');
  const recent = [];
  for (let d = 10; d <= 21; d++) recent.push(ex('2026-09-' + d, $(100)));
  recent.push(ex('2026-09-21', $(100)), ex('2026-09-21', $(100)));
  const r = analyze(build(recent));
  assert.equal(r.status, 'insufficient'); // 12 días de uso
  assert.equal(r.progress.days, 12);
});

test('un solo mes de historial: ok, sin promedio, sin patrón semanal', () => {
  const t = [];
  for (let d = 1; d <= 20; d++) t.push(ex('2026-09-' + String(d).padStart(2, '0'), $(1000 + d), d % 2 ? 'com' : 'sal'));
  t.push(inc('2026-09-01', $(100000)));
  const r = analyze(build(t));
  assert.equal(r.status, 'ok');
  assert.equal(r.weekly, null);
  const tot = r.trends.find((x) => x.scope === 'total');
  assert.equal(tot.avg, null);
  assert.equal(tot.deltaPrevPct, null);
  assert.equal(tot.flagged, false);
  assert.ok(r.budgets.length === 0);
});

test('ingresos en cero: sin tasa de ahorro ni división por cero', () => {
  const t = [];
  for (let d = 1; d <= 20; d++) t.push(ex('2026-09-' + String(d).padStart(2, '0'), $(500), 'com'));
  const inp = build(t);
  const r = analyze(inp);
  assert.equal(r.radiography.savingsRate, null);
  assert.equal(r.radiography.topCategories[0].pctOfIncome, null);
  assert.equal(r.radiography.topCategories[0].pctOfExpense, 100);
  assert.equal(r.projection.exceedsIncome, false);
  assert.equal(r.fixedWeight.pctOfIncome, null);
  const s = simulate(inp, 'com', 50);
  assert.equal(s.newSavingsRate, null);
  assert.equal(s.monthly, $(500) * 20 / 2);
  assert.ok(Number.isInteger(s.newBalance));
});

test('radiografía: tasa de ahorro, top 3 y esenciales vs flexibles', () => {
  const r = analyze(build(history()));
  const ra = r.radiography;
  assert.equal(ra.income, $(500000));
  assert.equal(ra.expense, $(100000 + 70000 + 84000));
  assert.equal(ra.savingsRate, Math.round(((ra.income - ra.expense) * 100) / ra.income));
  assert.equal(ra.topCategories.length, 3);
  assert.equal(ra.topCategories[0].catId, 'alq');
  assert.equal(ra.topCategories[0].pctOfExpense, Math.round((10000000 * 100) / ra.expense));
  assert.equal(ra.essential.total, $(100000));
  assert.equal(ra.flexible.total, $(154000));
});

test('tendencia: 38% sobre el promedio de 3 meses genera insight con el número', () => {
  const r = analyze(build(history()));
  const t = r.trends.find((x) => x.catId === 'sal');
  assert.equal(t.avg, $(60900));
  assert.equal(t.deltaAvgPct, 38);
  assert.ok(t.aboveAvg && t.flagged);
  const ins = r.insights.find((i) => i.key === 'trend:sal');
  assert.equal(ins.savingsMonthly, $(23100));
  assert.equal(ins.savingsYearly, $(23100) * 12);
  assert.match(ins.text, /38% más que tu promedio de 3 meses/);
  assert.match(ins.text, /\$84\.000,00/);
  assert.match(ins.text, /\$60\.900,00/);
  assert.match(ins.text, /\$23\.100,00/);
  assert.equal(ins.action.kind, 'open-simulator');
});

test('tendencia: 3 meses seguidos al alza se marca', () => {
  const t = [];
  for (const [ym, s] of [['2026-06', $(10000)], ['2026-07', $(11000)], ['2026-08', $(12000)], ['2026-09', $(13000)]]) {
    t.push(inc(ym + '-01', $(500000)), ex(ym + '-10', s, 'sal'), ex(ym + '-12', $(50000), 'com'), ex(ym + '-13', $(50000), 'com'));
  }
  const r = analyze(build(t));
  const tr = r.trends.find((x) => x.catId === 'sal');
  assert.ok(tr.rising);
  assert.equal(tr.aboveAvg, false); // 13000 vs promedio 11000 = +18%
  assert.ok(r.insights.some((i) => i.key === 'trend:sal' && i.evidence.rising));
});

test('mes actual incompleto: proyección solo desde el día 7', () => {
  const t = history();
  const antes = analyze(build(t, { today: '2026-09-06' }));
  assert.equal(antes.projection, null);
  const dia21 = analyze(build(t, { today: '2026-09-21' }));
  const p = dia21.projection;
  assert.equal(p.day, 21);
  assert.equal(p.daysInMonth, 30);
  assert.equal(p.projectedExpense, Math.round((dia21.radiography.expense * 30) / 21));
  assert.equal(p.projectedBalance, p.income - p.projectedExpense);
  // mes pasado: no se proyecta
  const pasado = analyze(build(t, { month: '2026-08', today: '2026-09-21' }));
  assert.equal(pasado.projection, null);
});

test('proyección compara con presupuestos', () => {
  const r = analyze(build(history(), { budgets: [{ id: 'b1', categoryId: 'sal', monthlyLimit: $(90000), currency: 'ARS' }] }));
  const b = r.projection.budgets[0];
  assert.equal(b.spent, $(84000));
  assert.equal(b.projected, Math.round(($(84000) * 30) / 21));
  assert.equal(b.willExceed, true);
  assert.equal(b.alreadyOver, false);
});

test('monedas mezcladas: analyze solo usa la moneda del input', () => {
  const t = history().concat([
    ex('2026-09-03', $(9999999), 'sal', { currency: 'USD' }),
    { type: 'income', date: '2026-09-03', amount: $(9999999), categoryId: 'com', currency: 'USD' },
  ]);
  const r = analyze(build(t, { currency: 'ARS' }));
  assert.equal(r.currency, 'ARS');
  assert.equal(r.radiography.expense, $(254000));
  // Aunque se cuele una tx de otra moneda en monthTxs, no se mezcla.
  const inp = build(history());
  inp.monthTxs.push({ id: 'x', type: 'expense', currency: 'USD', date: '2026-09-04', amount: $(84000), categoryId: 'sal', recurringId: null });
  const r2 = analyze(inp);
  assert.equal(r2.duplicates.length, 0);
  const usd = analyze(build(t, { currency: 'USD' }));
  assert.equal(usd.status, 'insufficient');
});

test('esenciales nunca reciben recomendaciones', () => {
  const t = history().filter((x) => x.categoryId !== 'alq');
  for (const ym of ['2026-06', '2026-07', '2026-08']) t.push(ex(ym + '-02', $(100000), 'alq'));
  t.push(ex('2026-09-02', $(300000), 'alq'), ex('2026-09-03', $(300000), 'alq'), ex('2026-09-04', $(300000), 'tra'));
  for (let d = 1; d <= 10; d++) t.push(ex('2026-09-' + String(d).padStart(2, '0'), $(20), 'tra'));
  const r = analyze(build(t, { budgets: [{ id: 'b', categoryId: 'alq', monthlyLimit: $(1), currency: 'ARS' }] }));
  const esenciales = new Set(['alq', 'tra']);
  assert.ok(r.insights.length > 0);
  for (const i of r.insights) assert.ok(!esenciales.has(i.catId), i.key);
  assert.ok(r.budgets.every((b) => b.catId !== 'alq' || b.suggestedLimit === null));
  // Los duplicados esenciales se listan pero marcados, sin insight.
  assert.ok(r.duplicates.some((d) => d.catId === 'alq' && d.essential));
});

test('duplicados: mismo monto y categoría el mismo día o ±1 día', () => {
  const t = history();
  t.push(ex('2026-09-12', $(7777), 'sal', { id: 'a' }), ex('2026-09-13', $(7777), 'sal', { id: 'b' }));
  t.push(ex('2026-09-17', $(5555), 'com', { id: 'c' }), ex('2026-09-17', $(5555), 'com', { id: 'd' }));
  t.push(ex('2026-09-01', $(4444), 'com', { id: 'e' }), ex('2026-09-03', $(4444), 'com', { id: 'f' })); // 2 días: no
  t.push(ex('2026-09-06', $(3333), 'com', { id: 'g' }), ex('2026-09-07', $(3333), 'sal', { id: 'h' })); // otra categoría: no
  const r = analyze(build(t));
  const keys = r.duplicates.map((d) => d.amount).sort();
  assert.deepEqual(keys, [$(5555), $(7777)]);
  const d = r.duplicates.find((x) => x.amount === $(7777));
  assert.deepEqual(d.txIds.sort(), ['a', 'b']);
  assert.equal(d.extra, $(7777));
  const ins = r.insights.find((i) => i.type === 'duplicate' && i.evidence.amount === $(7777));
  assert.equal(ins.action.kind, 'review-duplicates');
  assert.deepEqual(ins.action.txIds.sort(), ['a', 'b']);
});

test('los fijos generados no cuentan como duplicados', () => {
  const t = history();
  t.push(ex('2026-09-12', $(7777), 'sal', { recurringId: 'r1' }), ex('2026-09-12', $(7777), 'sal', { recurringId: 'r2' }));
  assert.equal(analyze(build(t)).duplicates.length, 0);
});

test('hormigas: >= 8 gastos por debajo del p25 en una categoría flexible', () => {
  const t = [];
  for (let d = 1; d <= 9; d++) t.push(ex('2026-09-' + String(d).padStart(2, '0'), $(400 + d * 10), 'sal')); // chicos
  for (let d = 1; d <= 20; d++) t.push(ex('2026-08-' + String(d).padStart(2, '0'), $(5000 + d), 'com'), ex('2026-07-' + String(d).padStart(2, '0'), $(5000 + d), 'com'));
  t.push(inc('2026-08-01', $(900000)));
  const r = analyze(build(t));
  const a = r.insights.find((i) => i.type === 'ants');
  assert.ok(a);
  assert.equal(a.catId, 'sal');
  assert.equal(a.evidence.count, 9);
  assert.equal(a.evidence.total, $(400 * 9 + 450));
  assert.equal(a.savingsMonthly, Math.floor(a.evidence.total / 2)); // la mitad
  // Con 7 ya no salta.
  const menos = build(t.filter((x) => !(x.categoryId === 'sal' && (x.date === '2026-09-08' || x.date === '2026-09-09'))));
  assert.ok(!analyze(menos).insights.some((i) => i.type === 'ants'));
});

test('inusuales: > 2,5x la mediana con >= 5 históricos', () => {
  const t = [];
  for (let d = 1; d <= 8; d++) t.push(ex('2026-08-1' + d, $(1000), 'com'));
  t.push(ex('2026-09-18', $(9000), 'com', { id: 'grande' }), ex('2026-09-19', $(2000), 'com'));
  const r = analyze(build(t));
  const u = r.insights.find((i) => i.type === 'unusual');
  assert.ok(u);
  assert.equal(u.evidence.txId, 'grande');
  assert.equal(u.action.kind, 'none');
  // Con pocos históricos no aplica.
  const poca = [];
  for (let d = 1; d <= 4; d++) poca.push(ex('2026-08-0' + d, $(1000), 'sal'));
  for (let d = 1; d <= 8; d++) poca.push(ex('2026-08-1' + d, $(100), 'com'));
  poca.push(ex('2026-09-18', $(9000), 'sal'));
  assert.ok(!analyze(build(poca)).insights.some((i) => i.type === 'unusual'));
});

test('peso de fijos: % del ingreso y costo anual por monto', () => {
  const rec = [
    { id: 'r1', type: 'expense', amount: $(100000), currency: 'ARS', categoryId: 'alq', note: 'Alquiler', active: true },
    { id: 'r2', type: 'expense', amount: $(20000), currency: 'ARS', categoryId: 'sal', note: 'Gym', active: true },
    { id: 'r3', type: 'expense', amount: $(99999), currency: 'ARS', categoryId: 'sal', note: 'Off', active: false },
    { id: 'r4', type: 'income', amount: $(1), currency: 'ARS', categoryId: 'com', active: true },
    { id: 'r5', type: 'expense', amount: $(5), currency: 'USD', categoryId: 'com', active: true },
  ];
  const f = analyze(build(history(), { recurring: rec })).fixedWeight;
  assert.equal(f.total, $(120000));
  assert.equal(f.pctOfIncome, 24);
  assert.equal(f.yearlyTotal, $(1440000));
  assert.deepEqual(f.items.map((i) => i.id), ['r1', 'r2']);
  assert.equal(f.items[0].yearly, $(1200000));
});

test('patrón semanal: solo con >= 2 meses de datos', () => {
  const r = analyze(build(history()));
  assert.ok(r.weekly);
  assert.equal(r.weekly.months, 4);
  assert.equal(r.weekly.byDow.length, 7);
  assert.equal(r.weekly.byDow.reduce((s, v) => s + v, 0), r.weekly.byDow.reduce((a, b) => a + b, 0));
  assert.equal(r.weekly.peakTotal, Math.max(...r.weekly.byDow));
});

test('presupuestos: estado y tope sugerido (promedio 3 meses -10%, solo flexibles)', () => {
  const budgets = [
    { id: 'b1', categoryId: 'sal', monthlyLimit: $(70000), currency: 'ARS' },
    { id: 'b2', categoryId: 'alq', monthlyLimit: $(100000), currency: 'ARS' },
    { id: 'b3', categoryId: 'com', monthlyLimit: $(70000), currency: 'USD' },
  ];
  const r = analyze(build(history(), { budgets }));
  assert.equal(r.budgets.length, 2);
  const sal = r.budgets.find((b) => b.catId === 'sal');
  assert.equal(sal.level, 'over');
  assert.equal(sal.suggestedLimit, Math.round($(60900) * 0.9));
  const alq = r.budgets.find((b) => b.catId === 'alq');
  assert.equal(alq.level, 'over');
  assert.equal(alq.suggestedLimit, null);
});

test('insight de tope sugerido: apply-budget para categoría sin tope', () => {
  const t = [];
  for (const ym of ['2026-06', '2026-07', '2026-08']) t.push(inc(ym + '-01', $(500000)), ex(ym + '-10', $(10000), 'com'), ex(ym + '-11', $(10000), 'com'));
  t.push(inc('2026-09-01', $(500000)), ex('2026-09-10', $(10500), 'com'), ex('2026-09-11', $(10500), 'com')); // +5%: sin tendencia
  const r = analyze(build(t));
  const b = r.insights.find((i) => i.type === 'budget');
  assert.ok(b);
  assert.equal(b.action.kind, 'apply-budget');
  assert.equal(b.action.monthlyLimit, $(18000));
  assert.equal(b.action.currency, 'ARS');
  assert.equal(b.savingsMonthly, $(21000) - $(18000));
});

test('insights: máx 5, ordenados por ahorro mensual, descartados excluidos', () => {
  const cats = [];
  const t = [];
  for (let i = 0; i < 8; i++) {
    cats.push({ id: 'c' + i, name: 'Cat' + i, kind: 'flexible' });
    for (const ym of ['2026-06', '2026-07', '2026-08']) t.push(ex(ym + '-05', $(1000), 'c' + i));
    t.push(ex('2026-09-05', $(2000 + i * 100), 'c' + i));
  }
  t.push(inc('2026-09-01', $(900000)));
  const inp = build(t, { categories: cats });
  const r = analyze(inp);
  assert.equal(r.insights.length, 5);
  for (let i = 1; i < r.insights.length; i++) assert.ok(r.insights[i - 1].savingsMonthly >= r.insights[i].savingsMonthly);
  const primera = r.insights[0].key;
  const r2 = analyze({ ...inp, dismissed: [primera] });
  assert.ok(!r2.insights.some((i) => i.key === primera));
  assert.equal(r2.insights.length, 5);
  assert.ok(r.insights.every((i) => Number.isInteger(i.savingsMonthly) && Number.isInteger(i.savingsYearly)));
});

test('simulate: ahorro mensual/anual, saldo y tasa nuevos', () => {
  const inp = build(history());
  const s = simulate(inp, 'sal', 25);
  assert.equal(s.monthly, $(21000));
  assert.equal(s.yearly, $(21000) * 12);
  assert.equal(s.newBalance, $(500000) - $(254000) + $(21000));
  assert.equal(s.newSavingsRate, Math.round((s.newBalance * 100) / $(500000)));
  assert.equal(simulate(inp, 'nada', 50).monthly, 0);
  assert.equal(simulate(inp, 'sal', 500).monthly, $(84000)); // tope 100%
  assert.equal(simulate(inp, 'sal', -5).monthly, 0);
});

test('CONFIG tiene los umbrales del contrato y analyze acepta uno propio', () => {
  assert.equal(CONFIG.minTransactions, 10);
  assert.equal(CONFIG.minDaysOfUse, 14);
  assert.equal(CONFIG.antPercentile, 25);
  assert.equal(CONFIG.antMinCount, 8);
  assert.equal(CONFIG.unusualFactor, 2.5);
  assert.equal(CONFIG.unusualMinHistory, 5);
  assert.equal(CONFIG.aboveAvgPct, 20);
  assert.equal(CONFIG.avgMonths, 3);
  assert.equal(CONFIG.projectionMinDay, 7);
  assert.equal(CONFIG.weeklyMinMonths, 2);
  assert.equal(CONFIG.budgetDiscountPct, 10);
  assert.equal(CONFIG.maxInsights, 5);
  assert.equal(CONFIG.duplicateDayWindow, 1);
  assert.equal(CONFIG.budgetWarnPct, 80);
  assert.equal(CONFIG.budgetOverPct, 100);
  const r = analyze(build(history()), { ...CONFIG, maxInsights: 1 });
  assert.equal(r.insights.length, 1);
});

test('rendimiento: 5.000 movimientos en < 300 ms', () => {
  const t = [];
  const cats = [];
  for (let i = 0; i < 12; i++) cats.push({ id: 'c' + i, name: 'C' + i, kind: i % 3 === 0 ? 'essential' : 'flexible' });
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 5000; i++) {
    const mm = 1 + Math.floor(rnd() * 9);
    const dd = 1 + Math.floor(rnd() * 28);
    const date = '2026-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
    t.push(ex(date, 100 + Math.floor(rnd() * 500000), 'c' + Math.floor(rnd() * 12)));
  }
  for (let mm = 1; mm <= 9; mm++) t.push(inc('2026-0' + mm + '-01', $(900000)));
  const inp = build(t, { categories: cats });
  const t0 = performance.now();
  const r = analyze(inp);
  const ms = performance.now() - t0;
  assert.equal(r.status, 'ok');
  assert.ok(ms < 300, 'tardó ' + ms + ' ms');
});
