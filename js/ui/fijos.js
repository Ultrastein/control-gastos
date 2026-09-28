// Gastos fijos: movimientos que se cargan solos cada mes. Se abre desde Ajustes.
// Control de recurrentes: compromiso mensual, próximos vencimientos y gastos que se repiten sin ser fijos.
import { h, icon, catBadge, emptyState } from './dom.js';
import { openModal } from './modal.js';
import { showSnackbar } from './snackbar.js';
import { centsToBuffer } from './keypad.js';
import { listRecurring, saveRecurring, deleteRecurring, listCategories, getSetting, queryTransactions } from '../db.js';
import { formatMoney, parseMoney, CURRENCIES } from '../utils/money.js';
import { parseISO, todayISO, dayLabel, addMonths, monthKey } from '../utils/dates.js';
import { upcoming, monthlyCommitment, detectRecurring } from '../utils/recurring.js';

const FALLBACK_CAT = { id: null, name: 'Categoría borrada', emoji: '📦', color: '#6B7280' };

// Convierte un gasto repetido en fijo. Si ya se cargó este mes, arranca el mes que viene (no duplica).
async function makeFixed(s) {
  const today = todayISO();
  const thisMonth = monthKey(today);
  try {
    const saved = await saveRecurring({
      type: 'expense', amount: s.amount, currency: s.currency, categoryId: s.categoryId,
      dayOfMonth: s.dayOfMonth, note: s.note, active: true,
      lastGeneratedMonth: monthKey(s.lastDate) === thisMonth ? thisMonth : addMonths(thisMonth, -1),
    });
    showSnackbar({
      text: s.note + ' ahora es un gasto fijo',
      actionLabel: 'Deshacer',
      onAction: () => deleteRecurring(saved.id).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
    });
  } catch (e) {
    showSnackbar({ text: 'No se pudo crear el gasto fijo.' });
  }
}

function controlBlocks(recs, catById, recent) {
  const today = todayISO();
  const out = [];
  const catOf = (id) => catById.get(id) || FALLBACK_CAT;

  // Compromiso mensual por moneda
  const com = monthlyCommitment(recs);
  const curs = Object.keys(com).sort();
  if (curs.length) {
    out.push(h('section', { class: 'fix-block', 'aria-labelledby': 'fix-com' },
      h('h2', { id: 'fix-com', class: 'sec-title' }, 'Comprometido por mes'),
      h('div', { class: 'card' }, ...curs.flatMap((c) => [
        h('div', { class: 'rep-stat' }, h('span', { class: 'rep-stat-label' }, 'Gastos fijos' + (curs.length > 1 ? ' ' + c : '')),
          h('span', { class: 'rep-stat-val is-expense' }, formatMoney(com[c].expense, c))),
        com[c].income ? h('div', { class: 'rep-stat' }, h('span', { class: 'rep-stat-label' }, 'Ingresos fijos' + (curs.length > 1 ? ' ' + c : '')),
          h('span', { class: 'rep-stat-val is-income' }, formatMoney(com[c].income, c))) : null,
      ]))));
  }

  // Próximos 30 días
  const next = upcoming(recs, today, 30);
  if (next.length) {
    out.push(h('section', { class: 'fix-block', 'aria-labelledby': 'fix-next' },
      h('h2', { id: 'fix-next', class: 'sec-title' }, 'Próximos 30 días'),
      h('ul', { class: 'rows' }, next.map(({ rec, date }) => {
        const cat = catOf(rec.categoryId);
        return h('li', { class: 'row rep-row' },
          catBadge(cat),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, rec.note || cat.name),
            h('span', { class: 'row-sub' }, (date === today ? 'Hoy' : dayLabel(date)) + ' · se carga solo')),
          h('span', { class: 'row-amount ' + (rec.type === 'income' ? 'is-income' : 'is-expense') },
            (rec.type === 'income' ? '+' : '-') + formatMoney(rec.amount, rec.currency)));
      }))));
  }

  // Gastos que se repiten todos los meses y no son fijos
  const found = detectRecurring(recent, recs, today);
  if (found.length) {
    out.push(h('section', { class: 'fix-block', 'aria-labelledby': 'fix-found' },
      h('h2', { id: 'fix-found', class: 'sec-title' }, 'Se repiten todos los meses'),
      h('p', { class: 'row-sub wrap' }, 'Estos gastos aparecen cada mes. Si los pasás a fijos, se cargan solos.'),
      h('ul', { class: 'rows' }, found.map((s) => {
        const cat = catOf(s.categoryId);
        return h('li', { class: 'suggest-row' },
          h('span', { class: 'row' },
            catBadge(cat),
            h('span', { class: 'row-main' },
              h('span', { class: 'row-title' }, s.note),
              h('span', { class: 'row-sub' }, formatMoney(s.amount, s.currency) + ' · ' + s.months + ' meses · día ' + s.dayOfMonth))),
          h('button', {
            class: 'btn', type: 'button', dataset: { fk: 'mk-' + s.note },
            onclick: () => makeFixed(s),
          }, 'Hacer fijo'));
      }))));
  }
  return out;
}

export async function render(container) {
  const from = addMonths(monthKey(todayISO()), -3) + '-01';
  const [recs, cats, defCur, recent] = await Promise.all([
    listRecurring(), listCategories(), getSetting('defaultCurrency', 'ARS'),
    queryTransactions({ from, type: 'expense', limit: 0 }).then((r) => r.items).catch(() => []),
  ]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  recs.sort((a, b) => a.dayOfMonth - b.dayOfMonth);
  const openForm = (r) => openFixedForm({ rec: r, cats, defCur });

  const items = recs.map((r) => {
    const cat = catById.get(r.categoryId) || FALLBACK_CAT;
    const sign = r.type === 'income' ? '+' : '-';
    return h('li', { class: r.active ? '' : 'is-paused' },
      h('button', { class: 'row', type: 'button', dataset: { fk: 'fijo-' + r.id }, onclick: () => openForm(r) },
        catBadge(cat),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, r.note || cat.name),
          h('span', { class: 'row-sub' }, 'Día ' + r.dayOfMonth + ' · ' + cat.name + (r.active ? '' : ' · Pausado'))),
        h('span', { class: 'row-amount ' + (r.type === 'income' ? 'is-income' : 'is-expense') },
          sign + formatMoney(r.amount, r.currency))));
  });

  container.append(
    h('a', { class: 'back', href: '#/ajustes' }, icon('back'), 'Ajustes'),
    h('div', { class: 'page-head' },
      h('h1', null, 'Gastos fijos'),
      recs.length ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm(null) }, icon('plus'), 'Nuevo') : null),
    recs.length
      ? h('ul', { class: 'rows' }, items)
      : emptyState({
        title: 'No hay gastos fijos',
        text: 'Cargá alquiler, sueldo o suscripciones una vez y se suman solos cada mes.',
        actionLabel: 'Crear gasto fijo',
        onAction: () => openForm(null),
      }),
    h('p', { class: 'hint' }, 'Si el día no existe en el mes (ej. 31 en febrero), se carga el último día.'),
    ...controlBlocks(recs, catById, recent));
}

// ---------- Formulario ----------

function openFixedForm({ rec, cats, defCur }) {
  if (!cats.length) {
    showSnackbar({ text: 'Primero creá una categoría.' });
    return;
  }
  let close = () => {};
  const editing = !!rec;
  const st = { type: editing ? rec.type : 'expense' };

  const typeBtns = {};
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo' },
    ...[['expense', 'Gasto'], ['income', 'Ingreso']].map(([value, label]) => {
      typeBtns[value] = h('button', { class: 'seg-btn', type: 'button', onclick: () => setType(value) }, label);
      return typeBtns[value];
    }));

  const amountEl = h('input', {
    class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'Ej: 150.000',
    'aria-label': 'Monto', value: editing ? centsToBuffer(rec.amount) : '',
  });
  const curSel = h('select', { class: 'input cur-select', 'aria-label': 'Moneda' }, ...CURRENCIES.map((c) => h('option', { value: c.code }, c.code)));
  curSel.value = editing ? rec.currency : defCur;
  const catSel = h('select', { class: 'input' }, ...cats.map((c) => h('option', { value: c.id }, c.emoji + ' ' + c.name)));
  catSel.value = editing && cats.some((c) => c.id === rec.categoryId) ? rec.categoryId : cats[0].id;
  const dayEl = h('input', {
    class: 'input', type: 'number', inputmode: 'numeric', min: 1, max: 31, step: 1,
    value: String(editing ? rec.dayOfMonth : parseISO(todayISO()).d),
  });
  const noteEl = h('input', {
    class: 'input', type: 'text', maxlength: 120, autocomplete: 'off', placeholder: 'Ej: Alquiler',
    value: editing ? rec.note || '' : '',
  });
  const activeEl = h('input', { type: 'checkbox', checked: editing ? !!rec.active : true });
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });

  function setType(t) {
    st.type = t;
    panelEl.classList.toggle('is-income', t === 'income');
    for (const [k, b] of Object.entries(typeBtns)) b.setAttribute('aria-pressed', String(k === t));
  }

  async function save() {
    const cents = parseMoney(amountEl.value);
    if (!cents || cents <= 0) {
      errEl.textContent = 'Ingresá un monto.';
      amountEl.focus();
      return;
    }
    let day = Number(dayEl.value);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      errEl.textContent = 'El día tiene que estar entre 1 y 31.';
      dayEl.focus();
      return;
    }
    try {
      await saveRecurring({
        ...(rec || {}),
        type: st.type,
        amount: cents,
        currency: curSel.value,
        categoryId: catSel.value,
        dayOfMonth: day,
        note: noteEl.value.trim(),
        active: activeEl.checked,
      });
      close();
    } catch (e) {
      errEl.textContent = 'No se pudo guardar. Probá de nuevo.';
    }
  }

  async function remove() {
    try {
      await deleteRecurring(rec.id);
      close();
      showSnackbar({
        text: 'Gasto fijo borrado',
        actionLabel: 'Deshacer',
        // saveRecurring conserva lastGeneratedMonth: no vuelve a cargar meses ya generados.
        onAction: () => saveRecurring(rec).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
      });
    } catch (e) {
      errEl.textContent = 'No se pudo borrar. Probá de nuevo.';
    }
  }

  const panelEl = h('form', { class: 'sheet', novalidate: true, onsubmit: (e) => { e.preventDefault(); save(); } },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, editing ? 'Editar gasto fijo' : 'Nuevo gasto fijo'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    seg,
    h('div', { class: 'field' }, h('label', null, 'Monto', h('span', { class: 'amount-field' }, amountEl, curSel))),
    h('div', { class: 'field' }, h('label', null, 'Categoría', catSel)),
    h('div', { class: 'field' }, h('label', null, 'Día del mes', dayEl)),
    h('div', { class: 'field' }, h('label', null, 'Nota (opcional)', noteEl)),
    h('label', { class: 'check-row' }, activeEl, h('span', null, 'Activo: se carga solo cada mes')),
    errEl,
    h('div', { class: 'form-actions' },
      editing ? h('button', { class: 'btn btn-danger', type: 'button', onclick: remove }, 'Borrar') : null,
      h('button', { class: 'btn btn-primary grow', type: 'submit' }, 'Guardar')));

  close = openModal(panelEl, { label: editing ? 'Editar gasto fijo' : 'Nuevo gasto fijo' });
  setType(st.type);
  amountEl.focus();
}
