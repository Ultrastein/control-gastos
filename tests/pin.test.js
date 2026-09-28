import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { newSalt, hashPin, verifyPin, isValidPin, PBKDF2_ITERATIONS } from '../js/utils/pin.js';

test('iteraciones >= 100000', () => {
  assert.ok(PBKDF2_ITERATIONS >= 100000);
});

test('newSalt: 16 bytes en hex, distinta cada vez', () => {
  const a = newSalt();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, newSalt());
});

test('hashPin: determinístico con la misma sal, hex de 64 caracteres', async () => {
  const salt = newSalt();
  const h1 = await hashPin('1234', salt);
  const h2 = await hashPin('1234', salt);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.equal(h1, h2);
});

test('hashPin: distinta sal o distinto PIN => distinto hash', async () => {
  const s1 = newSalt();
  const s2 = newSalt();
  assert.notEqual(await hashPin('1234', s1), await hashPin('1234', s2));
  assert.notEqual(await hashPin('1234', s1), await hashPin('1235', s1));
});

test('hashPin: coincide con PBKDF2-SHA256 de node:crypto', async () => {
  const salt = '00'.repeat(16);
  const esperado = pbkdf2Sync('0000', Buffer.from(salt, 'hex'), PBKDF2_ITERATIONS, 32, 'sha256').toString('hex');
  assert.equal(await hashPin('0000', salt), esperado);
});

test('verifyPin: ok, falla con PIN incorrecto, hash roto o sal distinta', async () => {
  const salt = newSalt();
  const hash = await hashPin('4821', salt);
  assert.equal(await verifyPin('4821', salt, hash), true);
  assert.equal(await verifyPin('4822', salt, hash), false);
  assert.equal(await verifyPin('4821', newSalt(), hash), false);
  assert.equal(await verifyPin('4821', salt, hash.slice(0, -1)), false);
  assert.equal(await verifyPin('4821', salt, undefined), false);
});

test('PIN inválido: hashPin lanza, verifyPin devuelve false', async () => {
  const salt = newSalt();
  for (const malo of ['123', '12345', 'abcd', '12 4', '', null, undefined, 1234]) {
    assert.equal(isValidPin(malo), false);
    await assert.rejects(() => hashPin(malo, salt), /4 dígitos/);
    assert.equal(await verifyPin(malo, salt, 'x'), false);
  }
  await assert.rejects(() => hashPin('1234', 'zz'), /Sal inválida/);
  assert.equal(await verifyPin('1234', 'zz', 'x'), false);
});
