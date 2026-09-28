import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney, parseMoney, keypadPress, keypadToCents, CURRENCIES } from '../js/utils/money.js';

test('formatMoney: separadores y símbolos', () => {
  assert.equal(formatMoney(5000000), '$50.000,00');
  assert.equal(formatMoney(0), '$0,00');
  assert.equal(formatMoney(5), '$0,05');
  assert.equal(formatMoney(123456789), '$1.234.567,89');
  assert.equal(formatMoney(100000, 'USD'), 'US$1.000,00');
  assert.equal(formatMoney(2550, 'EUR'), '€25,50');
  assert.equal(formatMoney(-15050), '-$150,50');
});

test('CURRENCIES incluye ARS, USD y EUR', () => {
  assert.deepEqual(CURRENCIES.map((c) => c.code), ['ARS', 'USD', 'EUR']);
});

test('parseMoney: formatos válidos', () => {
  assert.equal(parseMoney('50.000,00'), 5000000);
  assert.equal(parseMoney('$ 50.000,5'), 5000050);
  assert.equal(parseMoney('1234'), 123400);
  assert.equal(parseMoney('1.234'), 123400);
  assert.equal(parseMoney('12,34'), 1234);
  assert.equal(parseMoney('12.5'), 1250);
  assert.equal(parseMoney(',5'), 50);
  assert.equal(parseMoney('US$ 10'), 1000);
  assert.equal(parseMoney('0,07'), 7);
});

test('parseMoney: inválidos devuelven null', () => {
  for (const s of ['', '  ', 'abc', '-5', '1,2,3', '12,345', '1.2.3', null, undefined, 5]) {
    assert.equal(parseMoney(s), null, String(s));
  }
});

test('parseMoney: ida y vuelta con formatMoney', () => {
  for (const c of [1, 99, 100, 123456, 987654321]) {
    assert.equal(parseMoney(formatMoney(c)), c);
  }
});

test('keypadPress: dígitos, coma y borrar', () => {
  let b = '';
  for (const k of ['1', '2', '3', ',', '5']) b = keypadPress(b, k);
  assert.equal(b, '123,5');
  assert.equal(keypadPress(b, 'back'), '123,');
  assert.equal(keypadPress('123,', 'back'), '123');
  assert.equal(keypadPress('', 'back'), '');
});

test('keypadPress: máximo 2 decimales', () => {
  let b = '';
  for (const k of ['9', ',', '9', '9', '9']) b = keypadPress(b, k);
  assert.equal(b, '9,99');
});

test('keypadPress: coma inicial y coma repetida', () => {
  assert.equal(keypadPress('', ','), '0,');
  assert.equal(keypadPress('5,', ','), '5,');
});

test('keypadPress: sin ceros a la izquierda', () => {
  assert.equal(keypadPress('0', '0'), '0');
  assert.equal(keypadPress('0', '7'), '7');
  assert.equal(keypadPress('', '0'), '0');
  assert.equal(keypadPress('0,', '0'), '0,0');
});

test('keypadPress: límite de dígitos enteros y teclas raras', () => {
  assert.equal(keypadPress('1234567890', '1'), '1234567890');
  assert.equal(keypadPress('12', 'x'), '12');
});

test('keypadToCents: con 0, 1 y 2 decimales', () => {
  assert.equal(keypadToCents(''), 0);
  assert.equal(keypadToCents('0'), 0);
  assert.equal(keypadToCents('12'), 1200);
  assert.equal(keypadToCents('12,'), 1200);
  assert.equal(keypadToCents('12,5'), 1250);
  assert.equal(keypadToCents('12,05'), 1205);
  assert.equal(keypadToCents('0,99'), 99);
  assert.equal(keypadToCents('1234567890,99'), 123456789099);
});
