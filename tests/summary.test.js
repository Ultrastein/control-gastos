import test from 'node:test';
import assert from 'node:assert/strict';
import { pctChange, categoryShares, summarize } from '../js/utils/summary.js';

test('pctChange: sube, baja y sin base', () => {
  assert.equal(pctChange(150, 100), 50);
  assert.equal(pctChange(50, 100), -50);
  assert.equal(pctChange(100, 0), null);
  assert.equal(pctChange(0, 100), -100);
});

test('categoryShares: ordena y suma 100', () => {
  const s = categoryShares({ a: 100, b: 100, c: 100, z: 0 });
  assert.equal(s.length, 3);
  assert.equal(s.reduce((x, r) => x + r.pct, 0), 100);
  assert.deepEqual(categoryShares({}), []);
  assert.deepEqual(categoryShares({ a: 0 }), []);
  const t = categoryShares({ a: 300, b: 700 });
  assert.deepEqual(t.map((r) => [r.catId, r.pct]), [['b', 70], ['a', 30]]);
});

test('summarize: mes sin datos no divide por cero', () => {
  const s = summarize(undefined, undefined);
  assert.equal(s.balance, 0);
  assert.equal(s.expenseChange, null);
  assert.equal(s.hasPrev, false);
  assert.deepEqual(s.shares, []);
});

test('summarize: saldo y variación contra el mes anterior', () => {
  const s = summarize(
    { income: 100000, expense: 60000, byCat: { a: 60000 } },
    { income: 100000, expense: 40000, byCat: { a: 40000 } },
  );
  assert.equal(s.balance, 40000);
  assert.equal(s.expenseChange, 50);
  assert.equal(s.incomeChange, 0);
  assert.equal(s.hasPrev, true);
});

test('summarize: saldo negativo', () => {
  assert.equal(summarize({ income: 10, expense: 30, byCat: {} }).balance, -20);
});
