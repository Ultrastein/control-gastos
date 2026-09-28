import test from 'node:test';
import assert from 'node:assert';
import { toCSV } from '../js/io/csv.js';

test('csv - toCSV con transacciones vacías', () => {
  const csv = toCSV([], []);
  assert.ok(csv.includes('﻿')); // BOM
  assert.ok(csv.includes('Fecha;Tipo;Categoría;Monto;Moneda;Nota;paymentMethod;installmentNumber;totalInstallments;purchaseGroupId'));
});

test('csv - toCSV con una transacción de gasto', () => {
  const txs = [
    {
      id: '1',
      type: 'expense',
      amount: 5000, // 50,00
      currency: 'ARS',
      categoryId: 'cat-1',
      date: '2026-09-21',
      note: 'Almuerzo',
    },
  ];
  const categories = [{ id: 'cat-1', name: 'Comida' }];

  const csv = toCSV(txs, categories);
  assert.ok(csv.includes('2026-09-21'));
  assert.ok(csv.includes('Gasto'));
  assert.ok(csv.includes('Comida'));
  assert.ok(csv.includes('50,00'));
  assert.ok(csv.includes('ARS'));
  assert.ok(csv.includes('Almuerzo'));
});

test('csv - toCSV con ingreso', () => {
  const txs = [
    {
      id: '2',
      type: 'income',
      amount: 100000, // 1000,00
      currency: 'ARS',
      categoryId: 'cat-2',
      date: '2026-09-20',
      note: 'Salario',
    },
  ];
  const categories = [{ id: 'cat-2', name: 'Sueldo' }];

  const csv = toCSV(txs, categories);
  assert.ok(csv.includes('Ingreso'));
  assert.ok(csv.includes('1000,00'));
  assert.ok(csv.includes('Sueldo'));
});

test('csv - toCSV escapa comillas en notas', () => {
  const txs = [
    {
      id: '3',
      type: 'expense',
      amount: 1500,
      currency: 'ARS',
      categoryId: 'cat-1',
      date: '2026-09-21',
      note: 'Cena "fancy"',
    },
  ];
  const categories = [{ id: 'cat-1', name: 'Comida' }];

  const csv = toCSV(txs, categories);
  assert.ok(csv.includes('"Cena ""fancy"""'));
});

test('csv - toCSV reemplaza categoría desconocida con —', () => {
  const txs = [
    {
      id: '4',
      type: 'expense',
      amount: 1000,
      currency: 'ARS',
      categoryId: 'unknown',
      date: '2026-09-21',
      note: '',
    },
  ];
  const categories = [];

  const csv = toCSV(txs, categories);
  assert.ok(csv.includes('—'));
});

test('csv - toCSV convierte centavos correctamente', () => {
  const txs = [
    { id: '5', type: 'expense', amount: 1, currency: 'ARS', categoryId: 'cat-1', date: '2026-09-21', note: '' },
    { id: '6', type: 'expense', amount: 99, currency: 'ARS', categoryId: 'cat-1', date: '2026-09-21', note: '' },
    { id: '7', type: 'expense', amount: 100, currency: 'ARS', categoryId: 'cat-1', date: '2026-09-21', note: '' },
    { id: '8', type: 'expense', amount: 12345, currency: 'ARS', categoryId: 'cat-1', date: '2026-09-21', note: '' },
  ];
  const categories = [{ id: 'cat-1', name: 'Comida' }];

  const csv = toCSV(txs, categories);
  assert.ok(csv.includes('0,01'));
  assert.ok(csv.includes('0,99'));
  assert.ok(csv.includes('1,00'));
  assert.ok(csv.includes('123,45'));
});

test('csv - toCSV UTF-8 BOM presente', () => {
  const txs = [];
  const categories = [];

  const csv = toCSV(txs, categories);
  const bom = csv.charCodeAt(0) === 0xfeff;
  assert.ok(bom, 'CSV debe comenzar con UTF-8 BOM');
});

test('csv - toCSV con cuotas (paymentMethod=credito, installmentNumber, totalInstallments, purchaseGroupId)', () => {
  const txs = [
    {
      id: '9',
      type: 'expense',
      amount: 3333, // 33,33
      currency: 'ARS',
      categoryId: 'cat-1',
      date: '2026-09-21',
      note: 'Compra a crédito',
      paymentMethod: 'credito',
      installmentNumber: 3,
      totalInstallments: 12,
      purchaseGroupId: 'group-abc123',
    },
  ];
  const categories = [{ id: 'cat-1', name: 'Compras' }];

  const csv = toCSV(txs, categories);
  assert.ok(csv.includes('credito'));
  assert.ok(csv.includes('3'));
  assert.ok(csv.includes('12'));
  assert.ok(csv.includes('group-abc123'));
});

test('csv - toCSV con movimiento viejo sin campos nuevos (defaults)', () => {
  const txs = [
    {
      id: '10',
      type: 'expense',
      amount: 2500,
      currency: 'ARS',
      categoryId: 'cat-2',
      date: '2026-09-20',
      note: 'Gasto antiguo',
      // Sin paymentMethod, installmentNumber, totalInstallments, purchaseGroupId
    },
  ];
  const categories = [{ id: 'cat-2', name: 'Transporte' }];

  const csv = toCSV(txs, categories);
  // Debe tener efectivo como default y campos vacíos
  assert.ok(csv.includes('efectivo'));
  const lines = csv.split('\n');
  const dataLine = lines[1]; // primera línea de datos
  const fields = dataLine.split(';');
  assert.strictEqual(fields[6], 'efectivo'); // paymentMethod
  assert.strictEqual(fields[7], ''); // installmentNumber vacío
  assert.strictEqual(fields[8], ''); // totalInstallments vacío
  assert.strictEqual(fields[9], ''); // purchaseGroupId vacío
});
