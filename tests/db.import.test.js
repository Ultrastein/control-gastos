import { test } from 'node:test';
import assert from 'node:assert/strict';

// db.js usa IndexedDB (no disponible en Node): solo verificamos que importe y exporte lo del contrato.
test('db.js importa sin error y expone la API del contrato', async () => {
  const db = await import('../js/db.js');
  assert.equal(db.DB_VERSION, 3);
  assert.ok(db.dbEvents instanceof EventTarget);
  const nombres = [
    'openDB', 'addTransaction', 'updateTransaction', 'deleteTransaction', 'restoreTransaction',
    'getTransaction', 'queryTransactions', 'getMonthAgg', 'listCategories', 'saveCategory',
    'deleteCategory', 'reorderCategories', 'listBudgets', 'saveBudget', 'deleteBudget',
    'listRecurring', 'saveRecurring', 'deleteRecurring', 'generateRecurring', 'getSetting',
    'addInstallmentPurchase', 'updateInstallments', 'deleteInstallments', 'restoreTransactions', 'listInstallmentGroups',
    'setSetting', 'dismissInsight', 'listDismissed', 'getAnalysisInput', 'exportAll', 'importAll',
  ];
  for (const n of nombres) assert.equal(typeof db[n], 'function', n);
  assert.equal(typeof db.validateDump, 'function');
  // importAll valida antes de abrir la base: con un dump malo falla sin necesitar IndexedDB.
  await assert.rejects(() => db.importAll({ schemaVersion: 999, stores: {} }), /versión más nueva/);
  await assert.rejects(() => db.importAll(null), /backup válido/);
});
