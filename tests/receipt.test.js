import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAmount, extractDate, parseReceiptNumber } from '../js/utils/receipt.js';

test('parseReceiptNumber: formatos comunes', () => {
  assert.equal(parseReceiptNumber('1.234,56'), 123456);
  assert.equal(parseReceiptNumber('1,234.56'), 123456);
  assert.equal(parseReceiptNumber('$ 12.300'), 1230000);
  assert.equal(parseReceiptNumber('850,5'), 85050);
  assert.equal(parseReceiptNumber('abc'), null);
  assert.equal(parseReceiptNumber('0'), null);
});

test('extractAmount: prioriza TOTAL y no SUBTOTAL', () => {
  const t = 'SUPER LA ESQUINA\nCUIT 30-12345678-9\nLeche 1.250,00\nPan 980,50\nSUBTOTAL 2.230,50\nDESC -100,00\nTOTAL $ 2.130,50\nGracias';
  assert.equal(extractAmount(t), 213050);
});

test('extractAmount: TOTAL con el número en la línea siguiente', () => {
  assert.equal(extractAmount('Cafe 3.500,00\nTOTAL\n$ 3.500,00'), 350000);
});

test('extractAmount: sin TOTAL toma el mayor importe con decimales', () => {
  assert.equal(extractAmount('Ticket 000123\nItem 450,00\nItem 1.200,00'), 120000);
  assert.equal(extractAmount('sin numeros'), null);
});

test('extractDate: dd/mm/aaaa, dd-mm-aa y fechas inválidas', () => {
  assert.equal(extractDate('Fecha: 21/09/2026 10:30'), '2026-09-21');
  assert.equal(extractDate('05-03-26'), '2026-03-05');
  assert.equal(extractDate('31/02/2026 y 01/03/2026'), '2026-03-01');
  assert.equal(extractDate('nada'), null);
});
