import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_INSTALLMENTS, splitAmount, buildInstallments, normalizeInstallments, groupInstallments,
} from '../js/utils/installments.js';
import { analyze } from '../js/utils/analysis.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);

test('splitAmount: 100/3 y 1/3', () => {
  assert.deepEqual(splitAmount(100, 3), [33, 33, 34]);
  assert.deepEqual(splitAmount(1, 3), [0, 0, 1]);
});

test('splitAmount: resto 0, n=1 y n=60', () => {
  assert.deepEqual(splitAmount(900, 3), [300, 300, 300]);
  assert.deepEqual(splitAmount(777, 1), [777]);
  const p = splitAmount(1000001, MAX_INSTALLMENTS);
  assert.equal(p.length, 60);
  assert.equal(sum(p), 1000001);
  assert.ok(p.slice(0, 59).every((v) => v === Math.floor(1000001 / 60)));
});

test('splitAmount: la suma es EXACTAMENTE el total (1000 casos)', () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1000; i++) {
    const total = 1 + Math.floor(rnd() * 100000000);
    const n = 1 + Math.floor(rnd() * 60);
    const p = splitAmount(total, n);
    assert.equal(p.length, n);
    assert.equal(sum(p), total);
    assert.ok(p.every(Number.isInteger));
  }
});

test('splitAmount: entradas inválidas', () => {
  assert.throws(() => splitAmount(10.5, 3));
  assert.throws(() => splitAmount(100, 0));
});

const base = { type: 'expense', amount: 100000, currency: 'ARS', categoryId: 'c1', date: '2026-01-31', note: 'Heladera', paymentMethod: 'credito' };

test('buildInstallments: fin de mes siempre desde el día original', () => {
  const t = buildInstallments(base, 4, 'g1', 1000);
  assert.deepEqual(t.map((x) => x.date), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('buildInstallments: año bisiesto y cruce de año', () => {
  const a = buildInstallments({ ...base, date: '2028-01-30' }, 2, 'g', 1);
  assert.equal(a[1].date, '2028-02-29');
  const b = buildInstallments({ ...base, date: '2026-11-15' }, 4, 'g', 1);
  assert.deepEqual(b.map((x) => x.date), ['2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15']);
});

test('buildInstallments: grupo, numeración, purchaseTotal solo en la 1 y suma exacta', () => {
  const t = buildInstallments({ ...base, amount: 100001 }, 3, 'g1', 5);
  assert.equal(sum(t.map((x) => x.amount)), 100001);
  assert.deepEqual(t.map((x) => x.installmentNumber), [1, 2, 3]);
  assert.ok(t.every((x) => x.totalInstallments === 3 && x.purchaseGroupId === 'g1' && x.createdAt === 5));
  assert.deepEqual(t.map((x) => x.purchaseTotal), [100001, null, null]);
  assert.equal(new Set(t.map((x) => x.id)).size, 3);
  assert.ok(t.every((x) => x.paymentMethod === 'credito' && x.note === 'Heladera' && x.categoryId === 'c1'));
});

test('buildInstallments: genera groupId si falta y n=1 es un movimiento común', () => {
  const t = buildInstallments(base, 2);
  assert.ok(typeof t[0].purchaseGroupId === 'string' && t[0].purchaseGroupId === t[1].purchaseGroupId);
  const one = buildInstallments(base, 1, 'g');
  assert.equal(one.length, 1);
  assert.equal(one[0].amount, 100000);
  assert.equal(one[0].purchaseGroupId, null);
  assert.equal(one[0].installmentNumber, null);
});

test('buildInstallments: rechaza montos menores que la cantidad de cuotas', () => {
  assert.throws(() => buildInstallments({ ...base, amount: 5 }, 10, 'g'), /menor/);
});

test('normalizeInstallments: 1..60', () => {
  assert.equal(normalizeInstallments(6), 6);
  assert.equal(normalizeInstallments('12'), 12);
  assert.equal(normalizeInstallments(0), 1);
  assert.equal(normalizeInstallments(-3), 1);
  assert.equal(normalizeInstallments(61), 60);
  assert.equal(normalizeInstallments(1000), 60);
  assert.equal(normalizeInstallments(2.5), 1);
  assert.equal(normalizeInstallments('abc'), 1);
  assert.equal(normalizeInstallments(null), 1);
  assert.equal(normalizeInstallments(undefined), 1);
});

test('groupInstallments: solo activos, con pagadas, restante y mes de fin', () => {
  const viva = buildInstallments({ ...base, date: '2026-08-10', amount: 90000, note: 'TV' }, 3, 'viva', 1);
  const gs = groupInstallments(viva, '2026-09-21');
  assert.equal(gs.length, 1);
  assert.deepEqual(gs[0], {
    groupId: 'viva', categoryId: 'c1', note: 'TV', currency: 'ARS', count: 3, paid: 2,
    remainingCents: 30000, endMonth: '2026-10', purchaseTotal: 90000,
  });
  // Con hoy después de la última cuota, ya no está activa.
  assert.equal(groupInstallments(viva, '2026-10-10').length, 0);
});

const CATS = [{ id: 'c1', name: 'Compras', kind: 'flexible' }];
const inputWith = (installments) => ({
  month: '2026-09', today: '2026-09-21', currency: 'ARS', firstDate: null, totalCount: 0, monthly: {},
  amounts: { all: [], byCat: {} }, monthTxs: [], categories: CATS, budgets: [], recurring: [], installments,
});

test('analysis: fixedWeight.installments con una activa y una terminada', () => {
  const activa = buildInstallments({ ...base, date: '2026-08-10', amount: 90000, note: 'TV' }, 3, 'activa', 1);
  const terminada = buildInstallments({ ...base, date: '2026-05-10', amount: 60000, note: 'Zapatos' }, 3, 'fin', 1);
  const groups = groupInstallments([...activa, ...terminada], '2026-09-21');
  const r = analyze(inputWith(groups));
  assert.equal(r.fixedWeight.installments.length, 1);
  assert.deepEqual(r.fixedWeight.installments[0], {
    groupId: 'activa', catId: 'c1', note: 'TV', remaining: 30000, endMonth: '2026-10', count: 3, paid: 2,
  });
  // Una terminada que llegara a analyze igual se ignora, y sin input.installments no rompe.
  const fin = { groupId: 'fin', categoryId: 'c1', note: '', currency: 'ARS', count: 3, paid: 3, remainingCents: 0, endMonth: '2026-07' };
  assert.equal(analyze(inputWith([fin])).fixedWeight.installments.length, 0);
  const sin = inputWith(undefined);
  delete sin.installments;
  assert.deepEqual(analyze(sin).fixedWeight.installments, []);
});
