import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldLock } from '../js/utils/lock.js';

const now = 1000000;

test('sin PIN nunca bloquea', () => {
  assert.equal(shouldLock({ hasPin: false, lastActiveAt: null, now }), false);
  assert.equal(shouldLock({ hasPin: false, lastActiveAt: now - 10 * 60000, now }), false);
});

test('con PIN: al abrir (sin lastActiveAt) bloquea', () => {
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: null, now }), true);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: undefined, now }), true);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: NaN, now }), true);
});

test('con PIN: bordes del umbral de 1 minuto', () => {
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now, now }), false);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 59999, now }), false);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 60000, now }), false); // justo el umbral: no
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 60001, now }), true);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 3600000, now }), true);
});

test('umbral personalizado', () => {
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 5000, now, thresholdMs: 5000 }), false);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 5001, now, thresholdMs: 5000 }), true);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now - 1, now, thresholdMs: 0 }), true);
});

test('reloj cambiado (lastActiveAt futuro) o now inválido: bloquea', () => {
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now + 1, now }), true);
  assert.equal(shouldLock({ hasPin: true, lastActiveAt: now, now: undefined }), true);
});
