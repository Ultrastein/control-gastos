import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueDate, pendingMonths, buildTx } from '../js/utils/recurring.js';

const rec = (o = {}) => ({
  id: 'r1', type: 'expense', amount: 500000, currency: 'ARS', categoryId: 'c1',
  dayOfMonth: 10, note: 'Alquiler', active: true, lastGeneratedMonth: null, ...o,
});

test('dueDate: día normal', () => {
  assert.equal(dueDate(rec({ dayOfMonth: 5 }), '2026-09'), '2026-09-05');
});

test('dueDate: recorta a fin de mes (28/29/30/31)', () => {
  const r = rec({ dayOfMonth: 31 });
  assert.equal(dueDate(r, '2026-02'), '2026-02-28');
  assert.equal(dueDate(r, '2028-02'), '2028-02-29'); // bisiesto
  assert.equal(dueDate(r, '2026-04'), '2026-04-30');
  assert.equal(dueDate(r, '2026-01'), '2026-01-31');
  assert.equal(dueDate(rec({ dayOfMonth: 30 }), '2026-02'), '2026-02-28');
  assert.equal(dueDate(rec({ dayOfMonth: 29 }), '2026-02'), '2026-02-28');
  assert.equal(dueDate(rec({ dayOfMonth: 29 }), '2028-02'), '2028-02-29');
});

test('pendingMonths: nunca generó -> solo el mes actual', () => {
  assert.deepEqual(pendingMonths(rec(), '2026-09'), ['2026-09']);
});

test('pendingMonths: varios meses atrasados', () => {
  assert.deepEqual(
    pendingMonths(rec({ lastGeneratedMonth: '2026-06' }), '2026-09'),
    ['2026-07', '2026-08', '2026-09'],
  );
});

test('pendingMonths: ya al día -> vacío', () => {
  assert.deepEqual(pendingMonths(rec({ lastGeneratedMonth: '2026-09' }), '2026-09'), []);
  // Último generado posterior al actual (reloj atrasado): nada.
  assert.deepEqual(pendingMonths(rec({ lastGeneratedMonth: '2026-10' }), '2026-09'), []);
});

test('pendingMonths: inactivo -> vacío', () => {
  assert.deepEqual(pendingMonths(rec({ active: false, lastGeneratedMonth: '2026-01' }), '2026-09'), []);
  assert.deepEqual(pendingMonths(rec({ active: false }), '2026-09'), []);
});

test('pendingMonths: cruce de año', () => {
  assert.deepEqual(
    pendingMonths(rec({ lastGeneratedMonth: '2025-11' }), '2026-02'),
    ['2025-12', '2026-01', '2026-02'],
  );
});

test('buildTx: campos y vínculo con el fijo', () => {
  const r = rec({ dayOfMonth: 31 });
  const t = buildTx(r, '2026-02', 1700000000000);
  assert.equal(t.recurringId, 'r1');
  assert.equal(t.recurringMonth, '2026-02');
  assert.equal(t.date, '2026-02-28');
  assert.equal(t.type, 'expense');
  assert.equal(t.amount, 500000);
  assert.equal(t.currency, 'ARS');
  assert.equal(t.categoryId, 'c1');
  assert.equal(t.note, 'Alquiler');
  assert.equal(t.createdAt, 1700000000000);
  assert.equal(t.updatedAt, 1700000000000);
  assert.equal(typeof t.id, 'string');
  assert.notEqual(buildTx(r, '2026-02', 1).id, t.id);
});

test('buildTx: acepta Date como now', () => {
  const t = buildTx(rec(), '2026-09', new Date(5000));
  assert.equal(t.createdAt, 5000);
});

// Simula el índice único `rec` con un Set de claves: generar dos veces no duplica.
test('generar dos veces con la misma lista de pendientes no duplica', () => {
  const r = rec({ lastGeneratedMonth: '2026-06' });
  const claves = new Set();
  const generar = () => {
    let creados = 0;
    for (const ym of pendingMonths(r, '2026-09')) {
      const t = buildTx(r, ym, 1);
      const k = t.recurringId + '|' + t.recurringMonth;
      if (claves.has(k)) continue; // ConstraintError = ya existe
      claves.add(k);
      creados++;
    }
    return creados;
  };
  assert.equal(generar(), 3);
  assert.equal(generar(), 0); // segunda pestaña con la misma lista vieja
  assert.equal(claves.size, 3);
});
