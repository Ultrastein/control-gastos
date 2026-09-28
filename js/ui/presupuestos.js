// Presupuestos: tope mensual por categoría (solo gastos), con barra de progreso del mes actual.
import { h, icon, catBadge, emptyState } from './dom.js';
import { openModal } from './modal.js';
import { showSnackbar } from './snackbar.js';
import { centsToBuffer } from './keypad.js';
import { listBudgets, saveBudget, deleteBudget, listCategories, getMonthAgg, getSetting, setSetting } from '../db.js';
import { budgetStatus, normalizeLimit, allowance } from '../utils/budget.js';
import { formatMoney, parseMoney, CURRENCIES } from '../utils/money.js';
import { monthKey, monthLabel, todayISO, parseISO, daysInMonth } from '../utils/dates.js';

const FALLBACK_CAT = { id: null, name: 'Categoría borrada', emoji: '📦', color: '#6B7280' };
const STATE_TEXT = { warn: 'Cerca del tope', over: 'Superaste el tope' };

// ---------- Límite general del mes ----------
// Setting 'spendLimit' = {amount, currency}: tope de TODOS los gastos del mes (aparte de los por categoría).

const LIMIT_TITLE = { ok: 'Límite de gasto del mes', warn: 'Cerca de tu límite del mes', over: 'Superaste tu límite del mes' };

// Tarjeta con barra, lo que queda y cuánto por día hasta fin de mes. La usa también Resumen.
export function limitCard(limit, spent, { onEdit } = {}) {
  const { y, m, d } = parseISO(todayISO());
  const cur = limit.currency;
  const { pct, level } = budgetStatus(spent, limit.amount);
  const { left, perDay } = allowance(limit.amount, spent, daysInMonth(y, m) - d + 1);
  const summary = formatMoney(spent, cur) + ' de ' + formatMoney(limit.amount, cur) + ' · ' + pct + '%';
  return h('section', { class: 'card limit-card is-' + level, 'aria-label': 'Límite de gasto del mes' },
    h('p', { class: 'limit-title' }, LIMIT_TITLE[level]),
    h('p', { class: 'limit-line' }, summary),
    h('div', {
      class: 'progress is-' + level, role: 'progressbar', 'aria-label': 'Gastado del límite del mes',
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(pct, 100), 'aria-valuetext': summary,
      vars: { '--pct': String(Math.min(pct, 100)) },
    }, h('span', { class: 'progress-fill' })),
    h('p', { class: 'limit-line row-sub wrap' }, left > 0
      ? 'Te quedan ' + formatMoney(left, cur) + ': unos ' + formatMoney(perDay, cur) + ' por día hasta fin de mes.'
      : 'Ya no te queda margen este mes.'),
    onEdit ? h('div', { class: 'set-actions' }, h('button', { class: 'btn', type: 'button', dataset: { fk: 'limit-edit' }, onclick: onEdit }, 'Cambiar límite')) : null);
}

function openLimitForm(limit, defCur) {
  let close = () => {};
  const curSel = h('select', { class: 'input cur-select', 'aria-label': 'Moneda' }, ...CURRENCIES.map((c) => h('option', { value: c.code }, c.code)));
  curSel.value = limit ? limit.currency : defCur;
  const amountEl = h('input', {
    class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ej: 800.000',
    'aria-label': 'Límite de gasto del mes', value: limit ? centsToBuffer(limit.amount) : '',
  });
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });

  async function save() {
    const cents = parseMoney(amountEl.value);
    if (!cents || cents <= 0) {
      errEl.textContent = 'Ingresá el límite del mes.';
      amountEl.focus();
      return;
    }
    try {
      await setSetting('spendLimit', { amount: cents, currency: curSel.value });
      close();
    } catch (e) {
      errEl.textContent = 'No se pudo guardar. Probá de nuevo.';
    }
  }
  async function remove() {
    try {
      await setSetting('spendLimit', null);
      close();
      showSnackbar({
        text: 'Límite quitado',
        actionLabel: 'Deshacer',
        onAction: () => setSetting('spendLimit', limit).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
      });
    } catch (e) {
      errEl.textContent = 'No se pudo quitar. Probá de nuevo.';
    }
  }

  const form = h('form', { class: 'sheet', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, 'Límite de gasto del mes'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    h('p', { class: 'row-sub wrap' }, 'Suma todos tus gastos del mes. Te avisamos en la app al llegar al 80% y al 100%.'),
    h('div', { class: 'field' }, h('label', null, 'Tope por mes', h('span', { class: 'amount-field' }, amountEl, curSel))),
    errEl,
    h('div', { class: 'form-actions' },
      limit ? h('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Quitar') : null,
      h('button', { class: 'btn btn-primary grow', type: 'submit' }, 'Guardar')));
  close = openModal(form, { label: 'Límite de gasto del mes' });
  amountEl.focus();
}

export async function render(container) {
  const ym = monthKey(todayISO());
  const [budgets, cats, agg, defCur, limitRaw] = await Promise.all([
    listBudgets(), listCategories(), getMonthAgg(ym), getSetting('defaultCurrency', 'ARS'), getSetting('spendLimit', null),
  ]);
  const limit = normalizeLimit(limitRaw);
  const limitEl = limit
    ? limitCard(limit, (agg[limit.currency] && agg[limit.currency].expense) || 0, { onEdit: () => openLimitForm(limit, defCur) })
    : h('section', { class: 'card limit-card', 'aria-label': 'Límite de gasto del mes' },
      h('p', { class: 'limit-title' }, 'Límite de gasto del mes'),
      h('p', { class: 'limit-line row-sub wrap' }, 'Un tope para todos tus gastos del mes, además de los de cada categoría.'),
      h('div', { class: 'set-actions' },
        h('button', { class: 'btn', type: 'button', dataset: { fk: 'limit-new' }, onclick: () => openLimitForm(null, defCur) }, 'Poner un límite')));
  const catById = new Map(cats.map((c) => [c.id, c]));
  const order = new Map(cats.map((c, i) => [c.id, i]));
  budgets.sort((a, b) => (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99));

  const openForm = (b) => openBudgetForm({ budget: b, cats, budgets, defCur });

  const items = budgets.map((b) => {
    const cat = catById.get(b.categoryId) || FALLBACK_CAT;
    const spent = (agg[b.currency] && agg[b.currency].byCat[b.categoryId]) || 0;
    const { pct, level } = budgetStatus(spent, b.monthlyLimit);
    const summary = formatMoney(spent, b.currency) + ' de ' + formatMoney(b.monthlyLimit, b.currency) + ' · ' + pct + '%';

    const bar = h('div', {
      class: 'progress is-' + level,
      role: 'progressbar',
      'aria-label': 'Gastado de ' + cat.name,
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-valuenow': Math.min(pct, 100),
      'aria-valuetext': summary,
      vars: { '--pct': String(Math.min(pct, 100)) },
    }, h('span', { class: 'progress-fill' }));

    return h('li', { class: 'budget-item is-' + level },
      h('button', { class: 'row', type: 'button', dataset: { fk: 'budget-' + b.id }, onclick: () => openForm(b) },
        catBadge(cat),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, cat.name),
          h('span', { class: 'row-sub budget-sub' }, summary),
          STATE_TEXT[level] ? h('span', { class: 'budget-state' }, STATE_TEXT[level]) : null)),
      bar);
  });

  container.append(
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Presupuestos'),
        h('p', { class: 'row-sub' }, monthLabel(ym))),
      budgets.length
        ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm(null) }, icon('plus'), 'Nuevo')
        : null),
    limitEl,
    budgets.length
      ? h('ul', { class: 'rows' }, items)
      : emptyState({
        title: 'Todavía no hay presupuestos',
        text: 'Ponele un tope mensual a una categoría y te avisamos cuando te acerques.',
        actionLabel: 'Crear presupuesto',
        onAction: () => openForm(null),
      }),
    budgets.length ? h('p', { class: 'hint' }, 'Tocá uno para editarlo o borrarlo. El tope se cuenta de nuevo cada mes.') : null);
}

// ---------- Formulario ----------

function openBudgetForm({ budget, cats, budgets, defCur }) {
  if (!cats.length) {
    showSnackbar({ text: 'Primero creá una categoría.' });
    return;
  }
  let close = () => {};
  const editing = !!budget;
  const usedFirst = (id) => budgets.some((x) => x.categoryId === id);
  // Al crear, la primera categoría que todavía no tiene tope.
  const startCat = editing ? budget.categoryId : (cats.find((c) => !usedFirst(c.id)) || cats[0]).id;

  const catSel = h('select', { class: 'input', disabled: editing }, ...cats.map((c) => h('option', { value: c.id }, c.emoji + ' ' + c.name)));
  catSel.value = startCat;
  const curSel = h('select', { class: 'input cur-select', 'aria-label': 'Moneda' }, ...CURRENCIES.map((c) => h('option', { value: c.code }, c.code)));
  curSel.value = editing ? budget.currency : defCur;
  const amountEl = h('input', {
    class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ej: 200.000',
    'aria-label': 'Tope mensual', value: editing ? centsToBuffer(budget.monthlyLimit) : '',
  });
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });

  async function save() {
    const cents = parseMoney(amountEl.value);
    if (!cents || cents <= 0) {
      errEl.textContent = 'Ingresá el tope mensual.';
      amountEl.focus();
      return;
    }
    try {
      await saveBudget({ ...(budget || {}), categoryId: catSel.value, monthlyLimit: cents, currency: curSel.value });
      close();
    } catch (e) {
      errEl.textContent = 'No se pudo guardar. Probá de nuevo.';
    }
  }

  async function remove() {
    try {
      await deleteBudget(budget.id);
      close();
      showSnackbar({
        text: 'Presupuesto borrado',
        actionLabel: 'Deshacer',
        onAction: () => saveBudget(budget).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
      });
    } catch (e) {
      errEl.textContent = 'No se pudo borrar. Probá de nuevo.';
    }
  }

  const form = h('form', { class: 'sheet', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, editing ? 'Editar presupuesto' : 'Nuevo presupuesto'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    h('div', { class: 'field' }, h('label', null, 'Categoría', catSel)),
    h('div', { class: 'field' }, h('label', null, 'Tope por mes', h('span', { class: 'amount-field' }, amountEl, curSel))),
    errEl,
    h('div', { class: 'form-actions' },
      editing ? h('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Borrar') : null,
      h('button', { class: 'btn btn-primary grow', type: 'submit' }, 'Guardar')));

  close = openModal(form, { label: editing ? 'Editar presupuesto' : 'Nuevo presupuesto' });
  amountEl.focus();
}
