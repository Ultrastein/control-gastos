import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toISO, parseISO, todayISO, daysInMonth, monthKey, addMonths, addDays,
  dayOfWeek, monthRange, clampDay, monthLabel, dayLabel,
} from '../js/utils/dates.js';

test('toISO y parseISO son inversas', () => {
  assert.equal(toISO(2026, 9, 5), '2026-09-05');
  assert.deepEqual(parseISO('2026-09-05'), { y: 2026, m: 9, d: 5 });
  assert.throws(() => parseISO('2026-9-5'));
  assert.throws(() => parseISO('hola'));
});

test('todayISO usa hora local', () => {
  assert.equal(todayISO(new Date(2026, 8, 21, 23, 59)), '2026-09-21');
  assert.equal(todayISO(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});

test('daysInMonth: fin de mes y bisiestos', () => {
  assert.equal(daysInMonth(2026, 1), 31);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(1900, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('monthKey', () => {
  assert.equal(monthKey('2026-09-21'), '2026-09');
});

test('addMonths: cruza año en ambos sentidos', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-09', 0), '2026-09');
  assert.equal(addMonths('2026-09', 12), '2027-09');
  assert.equal(addMonths('2026-01', -13), '2024-12');
  assert.equal(addMonths('2026-12', 1), '2027-01');
});

test('addDays: fin de mes, año y bisiesto', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-09-21', 0), '2026-09-21');
  assert.equal(addDays('2026-03-01', -14), '2026-02-15');
});

test('dayOfWeek: 0 = domingo', () => {
  assert.equal(dayOfWeek('2026-09-20'), 0);
  assert.equal(dayOfWeek('2026-09-21'), 1);
  assert.equal(dayOfWeek('2024-02-29'), 4);
  assert.equal(dayOfWeek('2000-01-01'), 6);
});

test('monthRange', () => {
  assert.deepEqual(monthRange('2026-09'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(monthRange('2024-02'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-12-01', to: '2026-12-31' });
});

test('clampDay', () => {
  assert.equal(clampDay(2026, 2, 31), 28);
  assert.equal(clampDay(2024, 2, 31), 29);
  assert.equal(clampDay(2026, 4, 31), 30);
  assert.equal(clampDay(2026, 1, 31), 31);
  assert.equal(clampDay(2026, 5, 15), 15);
});

test('monthLabel y dayLabel', () => {
  assert.equal(monthLabel('2026-09'), 'Septiembre 2026');
  assert.equal(monthLabel('2027-01'), 'Enero 2027');
  assert.equal(dayLabel('2026-09-21'), 'Lun 21 sep');
  assert.equal(dayLabel('2026-03-01'), 'Dom 1 mar');
});
