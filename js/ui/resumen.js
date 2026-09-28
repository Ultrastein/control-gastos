// Resumen: totales del mes por moneda, comparación con el mes anterior y gastos por categoría.
// El mes vive en el hash (#/resumen?m=YYYY-MM): sin parámetro es el mes actual.
import { h, icon, catBadge, emptyState } from './dom.js';
import { donut } from './charts.js';
import { navigate } from './router.js';
import { openSheet } from './sheet.js';
import { setFilters } from './historial.js';
import { loadAnalysis, savingsLine } from './analisis.js';
import { limitCard } from './presupuestos.js';
import { getMonthAgg, listCategories, getSetting } from '../db.js';
import { normalizeLimit } from '../utils/budget.js';
import { formatMoney } from '../utils/money.js';
import { addMonths, monthKey, monthLabel, monthRange, todayISO } from '../utils/dates.js';
import { summarize } from '../utils/summary.js';

const NO_CAT = { name: 'Sin categoría', emoji: '❔', color: '#6B7280' };
const MINUS = '−';

function pickMonth(raw, current) {
  const ok = typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw);
  if (!ok) return current;
  return raw > current ? current : raw; // nunca al futuro
}

function signed(cents, currency) {
  if (cents < 0) return MINUS + formatMoney(-cents, currency);
  return (cents > 0 ? '+' : '') + formatMoney(cents, currency);
}

// Variación vs. mes anterior. goodWhenUp: en ingresos subir es bueno; en gastos, malo.
function changeLine(label, pct, goodWhenUp, prevLabel) {
  let text;
  let tone = 'is-neutral';
  if (pct === 0) {
    text = 'igual que en ' + prevLabel;
  } else {
    text = (pct > 0 ? '▲ +' : '▼ ' + MINUS) + Math.abs(pct) + '% vs. ' + prevLabel;
    tone = (pct > 0) === goodWhenUp ? 'is-income' : 'is-expense';
  }
  return h('p', { class: 'cmp-line' }, h('span', { class: 'cmp-label' }, label), ' ', h('span', { class: 'cmp-val ' + tone }, text));
}

function currencySection(cur, data, prevData, catsById, ym, showCode) {
  const s = summarize(data, prevData);
  const pl = monthLabel(addMonths(ym, -1));
  const prevLabel = pl.charAt(0).toLowerCase() + pl.slice(1);
  const balTone = s.balance < 0 ? 'is-expense' : s.balance > 0 ? 'is-income' : '';

  const card = h('div', { class: 'card sum-card' },
    showCode ? h('h2', { class: 'sum-cur' }, cur) : null,
    h('div', { class: 'sum-balance' },
      h('span', { class: 'sum-caption' }, 'Saldo del mes'),
      h('span', { class: 'sum-big ' + balTone }, signed(s.balance, cur))),
    h('div', { class: 'sum-split' },
      h('div', null,
        h('span', { class: 'sum-caption' }, 'Ingresos'),
        h('span', { class: 'sum-num is-income' }, '+' + formatMoney(s.income, cur))),
      h('div', null,
        h('span', { class: 'sum-caption' }, 'Gastos'),
        h('span', { class: 'sum-num is-expense' }, MINUS + formatMoney(s.expense, cur)))));

  if (s.hasPrev && (s.incomeChange !== null || s.expenseChange !== null)) {
    card.append(h('div', { class: 'cmp' },
      s.expenseChange !== null ? changeLine('Gastos', s.expenseChange, false, prevLabel) : null,
      s.incomeChange !== null ? changeLine('Ingresos', s.incomeChange, true, prevLabel) : null));
  }

  const out = h('section', { class: 'sum-section', 'aria-label': showCode ? 'Resumen en ' + cur : 'Resumen del mes' }, card);

  if (!s.shares.length) return out;

  const rows = s.shares.map((r) => ({ ...r, cat: catsById.get(r.catId) || NO_CAT }));
  const { from, to } = monthRange(ym);
  const fmt = (v) => formatMoney(v, cur);
  const chart = donut(
    rows.map((r) => ({ label: r.cat.name, value: r.cents, color: r.cat.color || NO_CAT.color })),
    { title: 'Gastos por categoría en ' + monthLabel(ym), center: 'Gastos', format: fmt });

  out.append(h('div', { class: 'card cat-card' },
    h('h2', { class: 'sec-title' }, 'Gastos por categoría'),
    h('div', { class: 'donut-wrap' }, chart),
    h('ul', { class: 'rows cat-rows' }, rows.map((r) => h('li', null,
      h('button', {
        class: 'row', type: 'button',
        'aria-label': r.cat.name + ', ' + r.pct + '%, ' + fmt(r.cents) + '. Ver movimientos',
        dataset: { fk: 'cat-' + cur + '-' + r.catId },
        onclick: () => {
          setFilters({ categoryId: catsById.has(r.catId) ? r.catId : '', type: 'expense', from, to });
          navigate('#/historial');
        },
      },
      catBadge(r.cat),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.cat.name)),
      h('span', { class: 'cat-pct' }, r.pct + '%'),
      h('span', { class: 'row-amount' }, fmt(r.cents))))))));
  return out;
}

export async function render(container, params = {}) {
  const current = monthKey(todayISO());
  const ym = pickMonth(params.m, current);
  const [cats, cur, prev, limitRaw] = await Promise.all([
    listCategories(), getMonthAgg(ym), getMonthAgg(addMonths(ym, -1)), getSetting('spendLimit', null),
  ]);
  const catsById = new Map(cats.map((c) => [c.id, c]));

  const go = (m) => navigate(m === current ? '#/resumen' : '#/resumen?m=' + m);
  const atCurrent = ym >= current;
  const picker = h('div', { class: 'month-picker' },
    h('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Mes anterior', dataset: { fk: 'prev-month' },
      onclick: () => go(addMonths(ym, -1)),
    }, icon('back')),
    h('div', { class: 'month-label', 'aria-live': 'polite' }, monthLabel(ym)),
    h('button', {
      class: 'icon-btn' + (atCurrent ? ' is-off' : ''), type: 'button', 'aria-label': 'Mes siguiente',
      'aria-disabled': atCurrent ? 'true' : null, dataset: { fk: 'next-month' },
      onclick: () => { if (!atCurrent) go(addMonths(ym, 1)); },
    }, icon('chevron')));

  container.append(
    h('div', { class: 'page-head' },
      h('h1', null, 'Resumen'),
      h('div', { class: 'head-links' },
        h('a', { class: 'btn btn-ghost head-link', href: '#/reportes' + (ym === current ? '' : '?d=' + ym + '-01') }, 'Reportes'),
        h('a', { class: 'btn btn-ghost head-link', href: '#/analisis' + (ym === current ? '' : '?m=' + ym) }, 'Análisis'))),
    picker);

  // Límite general: solo en el mes actual (es lo que todavía se puede cambiar).
  const limit = normalizeLimit(limitRaw);
  if (limit && ym === current) {
    container.append(limitCard(limit, (cur[limit.currency] && cur[limit.currency].expense) || 0));
  }

  const currencies = Object.keys(cur).sort();
  if (!currencies.length) {
    container.append(emptyState({
      title: ym === current ? 'Todavía no hay movimientos este mes' : 'No hay movimientos en este mes',
      text: 'Cuando cargues gastos o ingresos vas a ver acá cuánto entró, cuánto salió y cuánto te queda.',
      actionLabel: 'Cargar movimiento',
      onAction: () => openSheet(),
    }));
    return;
  }
  for (const c of currencies) {
    container.append(currencySection(c, cur[c], prev[c], catsById, ym, currencies.length > 1));
  }
  // La recomendación #1 se completa después del primer dibujo: no bloquea el resumen.
  loadTip(container, ym, currencies);
}

async function loadTip(container, ym, currencies) {
  try {
    for (const cur of currencies) {
      const { res } = await loadAnalysis(ym, cur);
      if (res.status !== 'ok' || !res.insights.length) continue;
      const ins = res.insights[0];
      container.append(h('section', { class: 'card tip-card', 'aria-label': 'Recomendación del mes' },
        h('h2', { class: 'sec-title' }, 'Para mirar este mes'),
        h('p', { class: 'insight-text' }, ins.text),
        savingsLine(ins, cur) ? h('p', { class: 'insight-save' }, savingsLine(ins, cur)) : null,
        h('a', { class: 'btn', href: '#/analisis' + (ym === monthKey(todayISO()) ? '' : '?m=' + ym) }, 'Ver análisis')));
      return;
    }
  } catch (e) { /* sin tarjeta: el resumen ya está completo */ }
}
