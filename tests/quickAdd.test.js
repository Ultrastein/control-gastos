import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickAdd, parseAmountCents } from '../js/utils/quickAdd.js';

const CATS = [
  { id: 'c-com', name: 'Comida' },
  { id: 'c-sal', name: 'Salud' },
  { id: 'c-tra', name: 'Transporte' },
  { id: 'c-ele', name: 'Electrónica' },
];

test('parseQuickAdd: completo con crédito y cuotas', () => {
  const r = parseQuickAdd('type=expense&amount=1500,50&cat=Comida&method=credito&installments=6&note=Super%20chino', CATS);
  assert.equal(r.complete, true);
  assert.deepEqual(r.draft, { type: 'expense', amount: 150050, categoryId: 'c-com', method: 'credito', installments: 6, note: 'Super chino' });
});

test('parseQuickAdd: categoría sin tildes y en mayúsculas', () => {
  assert.equal(parseQuickAdd('amount=100&cat=electronica', CATS).draft.categoryId, 'c-ele');
  assert.equal(parseQuickAdd('amount=100&cat=ELECTRÓNICA', CATS).draft.categoryId, 'c-ele');
  assert.equal(parseQuickAdd('amount=100&cat=SALUD', CATS).draft.categoryId, 'c-sal');
  assert.equal(parseQuickAdd('amount=100&cat=Inexistente', CATS).draft.categoryId, null);
});

test('parseAmountCents: coma, punto y miles', () => {
  assert.equal(parseAmountCents('1250'), 125000);
  assert.equal(parseAmountCents('12,5'), 1250);
  assert.equal(parseAmountCents('12.50'), 1250);
  assert.equal(parseAmountCents('1250,75'), 125075);
  assert.equal(parseAmountCents('1.250,50'), 125050);
  assert.equal(parseAmountCents('1,250.50'), 125050);
  assert.equal(parseAmountCents('1.250.000'), 125000000);
  assert.equal(parseAmountCents('$ 300'), 30000);
  assert.equal(parseAmountCents('0,05'), 5);
  // 0,1 + 0,2 style: sin floats
  assert.equal(parseAmountCents('19.99'), 1999);
  assert.equal(parseAmountCents('1234567.89'), 123456789);
});

test('parseAmountCents: caso ambiguo "1.250" = miles', () => {
  assert.equal(parseAmountCents('1.250'), 125000);
  assert.equal(parseAmountCents('1,250'), 125000);
  assert.equal(parseAmountCents('1250.500'), null);
  assert.equal(parseAmountCents('0.250'), null);
});

test('parseAmountCents: inválidos', () => {
  for (const v of ['', 'abc', '0', '0,00', '-5', '1,2,3', '12,345,6', ',', null, undefined, '1.2.3']) {
    assert.equal(parseAmountCents(v), null, String(v));
  }
});

test('parseQuickAdd: faltantes = incompleto con defaults', () => {
  const vacio = parseQuickAdd('', CATS);
  assert.equal(vacio.complete, false);
  assert.deepEqual(vacio.draft, { type: 'expense', amount: null, categoryId: null, method: 'efectivo', installments: 1, note: '' });
  assert.equal(parseQuickAdd('amount=500', CATS).complete, false);
  assert.equal(parseQuickAdd('cat=Comida', CATS).complete, false);
  assert.equal(parseQuickAdd('amount=500&cat=Comida', CATS).complete, true);
  assert.equal(parseQuickAdd('?amount=500&cat=Comida', CATS).complete, true);
});

test('parseQuickAdd: tipo ingreso y alias', () => {
  assert.equal(parseQuickAdd('type=income', CATS).draft.type, 'income');
  assert.equal(parseQuickAdd('type=Ingreso', CATS).draft.type, 'income');
  assert.equal(parseQuickAdd('type=otra', CATS).draft.type, 'expense');
});

test('parseQuickAdd: method inválido cae a efectivo y descarta cuotas', () => {
  const r = parseQuickAdd('amount=100&cat=Comida&method=bitcoin&installments=6', CATS);
  assert.equal(r.draft.method, 'efectivo');
  assert.equal(r.draft.installments, 1);
  assert.equal(parseQuickAdd('method=Débito', CATS).draft.method, 'debito');
  assert.equal(parseQuickAdd('method=MP', CATS).draft.method, 'mp');
});

test('parseQuickAdd: installments solo con crédito y dentro de 1..60', () => {
  assert.equal(parseQuickAdd('method=debito&installments=3', CATS).draft.installments, 1);
  assert.equal(parseQuickAdd('method=efectivo&installments=3', CATS).draft.installments, 1);
  assert.equal(parseQuickAdd('method=credito&installments=3', CATS).draft.installments, 3);
  assert.equal(parseQuickAdd('method=credito&installments=99', CATS).draft.installments, 60);
  assert.equal(parseQuickAdd('method=credito&installments=0', CATS).draft.installments, 1);
  assert.equal(parseQuickAdd('method=credito&installments=x', CATS).draft.installments, 1);
  assert.equal(parseQuickAdd('method=credito', CATS).draft.installments, 1);
});
