// Fase 7: fijos (próximos, compromiso, detección), límite general y enlaces de atajos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcoming, monthlyCommitment, detectRecurring } from '../js/utils/recurring.js';
import { normalizeLimit, allowance } from '../js/utils/budget.js';
import { buildQuickAddUrl, parseQuickAdd } from '../js/utils/quickAdd.js';

test('upcoming: próximos 30 días, sin meses ya cargados ni pausados', () => {
  const recs = [
    { id: 'a', active: true, dayOfMonth: 5, lastGeneratedMonth: '2026-09' },
    { id: 'b', active: true, dayOfMonth: 30, lastGeneratedMonth: '2026-08' },
    { id: 'c', active: false, dayOfMonth: 29, lastGeneratedMonth: null },
  ];
  const up = upcoming(recs, '2026-09-28', 30);
  assert.deepEqual(up.map((u) => [u.rec.id, u.date]), [['b', '2026-09-30'], ['a', '2026-10-05']]);
});

test('monthlyCommitment: suma activos por moneda y tipo', () => {
  const c = monthlyCommitment([
    { active: true, type: 'expense', amount: 100, currency: 'ARS' },
    { active: true, type: 'income', amount: 500, currency: 'ARS' },
    { active: false, type: 'expense', amount: 999, currency: 'ARS' },
    { active: true, type: 'expense', amount: 7, currency: 'USD' },
  ]);
  assert.deepEqual(c, { ARS: { expense: 100, income: 500 }, USD: { expense: 7, income: 0 } });
});

test('detectRecurring: misma nota en 3 meses = candidato; ya fijo o montos dispares no', () => {
  const t = (date, note, amount, cat = 'c1') => ({ type: 'expense', date, note, amount, categoryId: cat, currency: 'ARS' });
  const txs = [
    t('2026-07-03', 'Netflix', 500000), t('2026-08-03', 'netflix ', 500000), t('2026-09-03', 'Nétflix', 520000),
    t('2026-07-10', 'Gym', 100), t('2026-08-10', 'Gym', 100), t('2026-09-10', 'Gym', 100),
    t('2026-07-11', 'Super', 1000), t('2026-08-11', 'Super', 5000), t('2026-09-11', 'Super', 1000),
    t('2026-08-12', 'Cine', 100), t('2026-09-12', 'Cine', 100),
  ];
  const out = detectRecurring(txs, [{ note: 'GYM', categoryId: 'c1' }], '2026-09-28');
  assert.equal(out.length, 1);
  assert.equal(out[0].note, 'Nétflix');
  assert.equal(out[0].amount, 520000);
  assert.equal(out[0].dayOfMonth, 3);
  assert.equal(out[0].months, 3);
});

test('normalizeLimit y allowance', () => {
  assert.equal(normalizeLimit(null), null);
  assert.equal(normalizeLimit({ amount: 1.5 }), null);
  assert.deepEqual(normalizeLimit({ amount: 500 }), { amount: 500, currency: 'ARS' });
  assert.deepEqual(allowance(10000, 4000, 3), { left: 6000, perDay: 2000 });
  assert.deepEqual(allowance(10000, 12000, 3), { left: 0, perDay: 0 });
  assert.deepEqual(allowance(10000, 0, 0), { left: 10000, perDay: 10000 });
});

test('buildQuickAddUrl: ida y vuelta con parseQuickAdd', () => {
  const cats = [{ id: 'x', name: 'Comida' }];
  const url = buildQuickAddUrl('https://a.b/app/#/ajustes', { type: 'expense', amount: 150050, cat: 'Comida', method: 'mp', note: 'Café' });
  assert.ok(url.startsWith('https://a.b/app/#/quick-add?'));
  const { complete, draft } = parseQuickAdd(url.split('?')[1], cats);
  assert.equal(complete, true);
  assert.equal(draft.amount, 150050);
  assert.equal(draft.method, 'mp');
  assert.equal(draft.note, 'Café');
  assert.equal(buildQuickAddUrl('https://a.b/'), 'https://a.b/#/quick-add');
  assert.ok(buildQuickAddUrl('https://a.b/', { type: 'income' }).endsWith('?type=ingreso'));
});
