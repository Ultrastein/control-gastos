import { test } from 'node:test';
import assert from 'node:assert/strict';
import { widgetPayload, toNativeLink } from '../js/utils/widgetData.js';

test('widgetPayload: textos del mes, saldo negativo y por día con límite', () => {
  const agg = { ARS: { income: 10000000, expense: 15000000 } };
  const p = widgetPayload({ today: '2026-09-28', currency: 'ARS', agg, limitRaw: { amount: 18000000, currency: 'ARS' } });
  assert.equal(p.month, 'Septiembre');
  assert.equal(p.spent, '$150.000,00');
  assert.equal(p.balance, '−$50.000,00');
  assert.equal(p.perDay, '$10.000,00'); // quedan $30.000 en 3 días (28, 29, 30)
  assert.equal(p.limitPct, '83');
});

test('widgetPayload: sin datos ni límite', () => {
  const p = widgetPayload({ today: '2026-02-01', currency: 'USD', agg: {}, limitRaw: null });
  assert.equal(p.spent, 'US$0,00');
  assert.equal(p.perDay, '');
  assert.equal(p.limitPct, '');
});

test('toNativeLink', () => {
  assert.equal(toNativeLink('https://a.b/app/#/quick-add?amount=2500&cat=Comida'), 'gastos://quick-add?amount=2500&cat=Comida');
  assert.equal(toNativeLink('https://a.b/'), 'gastos://resumen');
});
