import { test } from 'node:test';
import assert from 'node:assert/strict';
import { periodRange, shiftPeriod, periodLabel, buildReport, chartBuckets, elapsedDays, daysBetween, normalizePeriod } from '../js/utils/reports.js';

const tx = (date, amount, extra = {}) => ({ id: date + amount, type: 'expense', amount, currency: 'ARS', categoryId: 'c1', date, ...extra });

test('periodRange: día, semana (lunes a domingo) y mes', () => {
  assert.deepEqual(periodRange('dia', '2026-09-28'), { from: '2026-09-28', to: '2026-09-28' });
  // 2026-09-28 es lunes; 2026-10-04 domingo
  assert.deepEqual(periodRange('semana', '2026-09-28'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(periodRange('semana', '2026-10-04'), { from: '2026-09-28', to: '2026-10-04' });
  assert.deepEqual(periodRange('mes', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
});

test('shiftPeriod y periodLabel', () => {
  assert.equal(shiftPeriod('dia', '2026-03-01', -1), '2026-02-28');
  assert.equal(shiftPeriod('semana', '2026-10-01', -1), '2026-09-21');
  assert.equal(shiftPeriod('mes', '2026-01-31', -1), '2025-12-01');
  assert.equal(periodLabel('mes', '2026-09-01', '2026-09-30'), 'Septiembre 2026');
  assert.equal(periodLabel('semana', '2026-09-28', '2026-10-04'), '28 sep al 4 oct');
  assert.equal(normalizePeriod('x'), 'mes');
});

test('días transcurridos', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-30'), 30);
  assert.equal(elapsedDays('2026-09-01', '2026-09-30', '2026-09-10'), 10);
  assert.equal(elapsedDays('2026-09-01', '2026-09-30', '2026-12-01'), 30);
  assert.equal(elapsedDays('2026-09-01', '2026-09-30', '2026-08-01'), 1);
});

test('buildReport: totales, fijos/cuotas/variables, promedio, proyección y comparación', () => {
  const txs = [
    tx('2026-09-02', 10000, { recurringId: 'r1' }),
    tx('2026-09-05', 30000, { purchaseGroupId: 'g', paymentMethod: 'credito' }),
    tx('2026-09-05', 20000, { categoryId: 'c2', paymentMethod: 'mp' }),
    { ...tx('2026-09-06', 100000), type: 'income' },
    tx('2026-08-31', 99999), // fuera de rango
    tx('2026-09-01', 5000, { currency: 'USD' }),
  ];
  const prev = [tx('2026-08-10', 40000), { ...tx('2026-08-11', 50000), type: 'income' }];
  const r = buildReport(txs, { from: '2026-09-01', to: '2026-09-30', today: '2026-09-10' }, prev);
  const a = r.ARS;
  assert.equal(a.expense, 60000);
  assert.equal(a.income, 100000);
  assert.equal(a.balance, 40000);
  assert.equal(a.count, 4);
  assert.equal(a.fixed, 10000);
  assert.equal(a.installments, 30000);
  assert.equal(a.variable, 20000);
  assert.equal(a.avgPerDay, 6000);
  assert.equal(a.projection, 180000);
  assert.deepEqual(a.maxDay, { date: '2026-09-05', cents: 50000 });
  assert.equal(a.byDay.length, 30);
  assert.equal(a.expenseChange, 50);
  assert.equal(a.incomeChange, 100);
  assert.deepEqual(a.byMethod, { efectivo: 10000, credito: 30000, mp: 20000 });
  assert.equal(a.topExpenses[0].amount, 30000);
  assert.equal(a.shares.reduce((s, x) => s + x.pct, 0), 100);
  assert.equal(r.USD.expense, 5000);
  assert.equal(r.USD.expenseChange, null);
});

test('buildReport: período pasado sin proyección y vacío = {}', () => {
  const r = buildReport([tx('2026-08-03', 700)], { from: '2026-08-01', to: '2026-08-31', today: '2026-09-10' });
  assert.equal(r.ARS.projection, null);
  assert.equal(r.ARS.avgPerDay, Math.floor(700 / 31));
  assert.deepEqual(buildReport([], { from: '2026-08-01', to: '2026-08-31', today: '2026-09-10' }), {});
});

test('chartBuckets: día/semana tal cual, mes en hasta 12 barras que suman lo mismo', () => {
  const week = Array.from({ length: 7 }, (_, i) => ({ date: '2026-09-0' + (i + 1), cents: i }));
  assert.equal(chartBuckets(week).length, 7);
  const month = Array.from({ length: 31 }, (_, i) => ({ date: 'd' + i, cents: 100 }));
  const b = chartBuckets(month);
  assert.ok(b.length <= 12);
  assert.equal(b.reduce((s, x) => s + x.cents, 0), 3100);
});
