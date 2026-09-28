import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetStatus, crossedLevel } from '../js/utils/budget.js';

const L = 10000000; // límite $100.000,00 en centavos

test('budgetStatus: umbrales 0 / 79 / 80 / 100', () => {
  assert.deepEqual(budgetStatus(0, L), { pct: 0, level: 'ok' });
  assert.deepEqual(budgetStatus(7900000, L), { pct: 79, level: 'ok' });
  assert.deepEqual(budgetStatus(7999999, L), { pct: 79, level: 'ok' });
  assert.deepEqual(budgetStatus(8000000, L), { pct: 80, level: 'warn' });
  assert.deepEqual(budgetStatus(9999999, L), { pct: 99, level: 'warn' });
  assert.deepEqual(budgetStatus(L, L), { pct: 100, level: 'over' });
  assert.deepEqual(budgetStatus(25000000, L), { pct: 250, level: 'over' });
});

test('budgetStatus: límite 0 o inválido no divide por 0', () => {
  assert.deepEqual(budgetStatus(5000, 0), { pct: 0, level: 'ok' });
  assert.deepEqual(budgetStatus(5000, -1), { pct: 0, level: 'ok' });
  assert.deepEqual(budgetStatus(5000, undefined), { pct: 0, level: 'ok' });
});

test('crossedLevel: solo cuando cruza un umbral nuevo', () => {
  assert.equal(crossedLevel(0, 7900000, L), null);
  assert.equal(crossedLevel(7900000, 8000000, L), 'warn');
  assert.equal(crossedLevel(8000000, 9000000, L), null); // ya estaba en warn
  assert.equal(crossedLevel(9000000, L, L), 'over');
  assert.equal(crossedLevel(L, 12000000, L), null); // ya estaba en over
  assert.equal(crossedLevel(0, L, L), 'over'); // salto directo
});

test('crossedLevel: gasto que baja o límite 0 -> null', () => {
  assert.equal(crossedLevel(L, 5000, L), null);
  assert.equal(crossedLevel(0, 5000, 0), null);
});
