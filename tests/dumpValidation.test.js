import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDump, SCHEMA_VERSION } from '../js/utils/dumpValidation.js';

const base = () => ({
  schemaVersion: SCHEMA_VERSION,
  exportedAt: '2026-09-21T10:00:00.000Z',
  stores: {
    categories: [
      { id: 'c1', name: 'Comida', emoji: '🍽️', color: '#E4572E', sortOrder: 0, kind: 'flexible' },
      { id: 'c2', name: 'Alquiler', emoji: '🏠', color: '#6C4AB6', sortOrder: 1, kind: 'essential' },
    ],
    transactions: [
      { id: 't1', type: 'expense', amount: 150050, currency: 'ARS', categoryId: 'c1', date: '2026-09-20', note: '', createdAt: 1, updatedAt: 1 },
      { id: 't2', type: 'income', amount: 500000000, currency: 'ARS', categoryId: 'c2', date: '2026-02-28', recurringId: 'r1', recurringMonth: '2026-02' },
    ],
    budgets: [{ id: 'b1', categoryId: 'c1', monthlyLimit: 8000000, currency: 'ARS' }],
    recurring: [{ id: 'r1', type: 'income', amount: 500000000, currency: 'ARS', categoryId: 'c2', dayOfMonth: 5, note: '', active: true, lastGeneratedMonth: '2026-09' }],
    settings: [{ key: 'theme', value: 'dark' }, { key: 'lastBackupAt', value: '2026-09-01T00:00:00.000Z' }],
    dismissed_insights: [{ id: 'd1', insightKey: 'ants', month: '2026-09' }],
  },
});

// Aplica la mutación al dump válido y espera que falle (con mensaje que cumpla re).
const malo = (mut, re) => {
  const d = base();
  mut(d);
  const r = validateDump(d);
  assert.equal(r.ok, false);
  if (re) assert.match(r.error, re);
};

test('dump válido', () => {
  assert.deepEqual(validateDump(base()), { ok: true });
});

test('dump válido vacío', () => {
  const d = base();
  for (const k of Object.keys(d.stores)) d.stores[k] = [];
  assert.deepEqual(validateDump(d), { ok: true });
});

test('no es objeto / sin versión / versión futura', () => {
  for (const x of [null, undefined, 5, 'x', [], {}]) assert.equal(validateDump(x).ok, false);
  malo((d) => { delete d.schemaVersion; }, /versión/);
  malo((d) => { d.schemaVersion = SCHEMA_VERSION + 1; }, /más nueva/);
  malo((d) => { d.schemaVersion = '1'; }, /versión/);
  malo((d) => { d.schemaVersion = 0; }, /versión/);
});

test('monto float, cero, negativo o string', () => {
  for (const m of [10.5, 0, -100, '100', NaN, Infinity]) {
    malo((d) => { d.stores.transactions[0].amount = m; }, /monto/);
  }
  malo((d) => { d.stores.budgets[0].monthlyLimit = 1.5; }, /límite/);
  malo((d) => { d.stores.recurring[0].amount = 0.1; }, /monto/);
});

test('fecha mala', () => {
  for (const f of ['2026-13-01', '2026-02-30', '20-09-2026', '2026-9-1', '', null, 20260920]) {
    malo((d) => { d.stores.transactions[0].date = f; }, /fecha/);
  }
});

test('categoría inexistente', () => {
  malo((d) => { d.stores.transactions[0].categoryId = 'nope'; }, /categoría/);
  malo((d) => { d.stores.budgets[0].categoryId = 'nope'; }, /categoría/);
  malo((d) => { d.stores.recurring[0].categoryId = 'nope'; }, /categoría/);
});

test('campos faltantes o tipo inválido', () => {
  malo((d) => { delete d.stores.transactions; }, /transactions/);
  malo((d) => { delete d.stores.dismissed_insights; }, /dismissed_insights/);
  malo((d) => { d.stores.settings = {}; }, /settings/);
  malo((d) => { delete d.stores.transactions[0].type; }, /tipo/);
  malo((d) => { d.stores.transactions[0].type = 'transfer'; }, /tipo/);
  malo((d) => { delete d.stores.transactions[0].id; }, /id/);
  malo((d) => { delete d.stores.transactions[0].currency; }, /moneda/);
  malo((d) => { delete d.stores.categories[0].name; }, /nombre/);
  malo((d) => { d.stores.categories[0].kind = 'x'; }, /categoría/);
  malo((d) => { delete d.stores.settings[0].key; }, /clave/);
  malo((d) => { d.stores.recurring[0].dayOfMonth = 32; }, /día/);
  malo((d) => { d.stores.dismissed_insights[0].month = 'sep'; }, /mes/);
  malo((d) => { d.stores.transactions.push(null); }, /registro/);
});

test('ids y claves únicas', () => {
  malo((d) => { d.stores.transactions[1].id = 't1'; }, /repetido/);
  malo((d) => { d.stores.budgets.push({ id: 'b2', categoryId: 'c1', monthlyLimit: 100, currency: 'ARS' }); }, /repetido/);
  malo((d) => { d.stores.transactions.push({ ...d.stores.transactions[1], id: 't3' }); }, /duplicado/);
});

// ---------- Fase 6: v1 y v2 ----------

const cuota = (id, n, extra = {}) => ({
  id, type: 'expense', amount: 10000, currency: 'ARS', categoryId: 'c1', date: '2026-09-20', note: '',
  paymentMethod: 'credito', installmentNumber: n, totalInstallments: 3, purchaseGroupId: 'g1',
  purchaseTotal: n === 1 ? 30000 : null, ...extra,
});

test('SCHEMA_VERSION es 2', () => {
  assert.equal(SCHEMA_VERSION, 2);
});

test('dump v1 (sin campos nuevos) sigue siendo válido', () => {
  const d = base();
  d.schemaVersion = 1;
  assert.deepEqual(validateDump(d), { ok: true });
});

test('dump v2 con cuotas y medios de pago', () => {
  const d = base();
  d.stores.transactions.push(cuota('q1', 1), cuota('q2', 2), cuota('q3', 3));
  d.stores.transactions[0].paymentMethod = 'mp';
  d.stores.transactions[1].paymentMethod = null;
  assert.deepEqual(validateDump(d), { ok: true });
});

test('dump v2: campos nuevos inválidos', () => {
  malo((d) => { d.stores.transactions[0].paymentMethod = 'bitcoin'; }, /medio de pago/);
  malo((d) => { d.stores.transactions[0].installmentNumber = 1.5; }, /número de cuota/);
  malo((d) => { d.stores.transactions[0].installmentNumber = 0; }, /número de cuota/);
  malo((d) => { d.stores.transactions[0].totalInstallments = 61; }, /total de cuotas/);
  malo((d) => { d.stores.transactions[0].installmentNumber = 4; d.stores.transactions[0].totalInstallments = 3; }, /supera/);
  malo((d) => { d.stores.transactions[0].purchaseTotal = 10.5; }, /total de la compra/);
  malo((d) => { d.stores.transactions.push(cuota('q1', 1, { purchaseGroupId: 7 })); }, /grupo/);
  malo((d) => { d.stores.transactions.push(cuota('q1', 1, { installmentNumber: null })); }, /falta el número/);
});

test('dump v2: cuotas del mismo grupo no repiten installmentNumber', () => {
  malo((d) => { d.stores.transactions.push(cuota('q1', 2), cuota('q2', 2)); }, /repetida/);
  // Mismo número en grupos distintos es válido.
  const d = base();
  d.stores.transactions.push(cuota('q1', 1), cuota('q2', 1, { purchaseGroupId: 'g2' }));
  assert.deepEqual(validateDump(d), { ok: true });
});
