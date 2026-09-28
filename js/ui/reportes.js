// Reportes: día, semana o mes, con información avanzada y exportación a PDF (imprimir) o CSV.
// Período en el hash: #/reportes?p=dia|semana|mes&d=YYYY-MM-DD (sin parámetros: el mes actual).
import { h, icon, catBadge, emptyState } from './dom.js';
import { bars } from './charts.js';
import { navigate } from './router.js';
import { openSheet, METHOD_LABEL } from './sheet.js';
import { showSnackbar } from './snackbar.js';
import { exportCSV } from '../io/csv.js';
import { queryTransactions, listCategories, getSetting } from '../db.js';
import { formatMoney } from '../utils/money.js';
import { dayLabel, parseISO, todayISO } from '../utils/dates.js';
import { budgetStatus, normalizeLimit } from '../utils/budget.js';
import {
  PERIODS, PERIOD_LABEL, normalizePeriod, periodRange, shiftPeriod, periodLabel, buildReport, chartBuckets,
} from '../utils/reports.js';

const NO_CAT = { name: 'Sin categoría', emoji: '❔', color: '#6B7280' };
const MINUS = '−';
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const PREV_TEXT = { dia: 'el día anterior', semana: 'la semana anterior', mes: 'el mes anterior' };
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function signed(cents, cur) {
  if (cents < 0) return MINUS + formatMoney(-cents, cur);
  return (cents > 0 ? '+' : '') + formatMoney(cents, cur);
}

function hashFor(p, d) {
  const q = new URLSearchParams();
  if (p !== 'mes') q.set('p', p);
  if (d !== todayISO()) q.set('d', d);
  const s = q.toString();
  return '#/reportes' + (s ? '?' + s : '');
}

function statRow(label, value, tone) {
  return h('div', { class: 'rep-stat' },
    h('span', { class: 'rep-stat-label' }, label),
    h('span', { class: 'rep-stat-val' + (tone ? ' ' + tone : '') }, value));
}

function changeText(pct, goodWhenUp, kind) {
  if (pct === null) return null;
  if (pct === 0) return h('span', { class: 'is-neutral' }, 'igual que ' + PREV_TEXT[kind]);
  const tone = (pct > 0) === goodWhenUp ? 'is-income' : 'is-expense';
  return h('span', { class: tone }, (pct > 0 ? '▲ +' : '▼ ' + MINUS) + Math.abs(pct) + '% vs. ' + PREV_TEXT[kind]);
}

function barLabel(kind, b) {
  if (kind === 'semana') {
    const { y, m, d } = parseISO(b.from);
    return DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  }
  const a = parseISO(b.from).d;
  const z = parseISO(b.to).d;
  return a === z ? String(a) : a + '-' + z;
}

function currencyBlock(cur, r, ctx) {
  const { kind, catsById, limit, showCode } = ctx;
  const fmt = (v) => formatMoney(v, cur);
  const out = h('section', { class: 'rep-section', 'aria-label': 'Reporte en ' + cur });

  // Totales
  const balTone = r.balance < 0 ? 'is-expense' : r.balance > 0 ? 'is-income' : '';
  out.append(h('div', { class: 'card rep-card' },
    showCode ? h('h2', { class: 'sum-cur' }, cur) : null,
    h('div', { class: 'sum-split rep-totals' },
      h('div', null, h('span', { class: 'sum-caption' }, 'Gastos'), h('span', { class: 'sum-num is-expense' }, MINUS + fmt(r.expense))),
      h('div', null, h('span', { class: 'sum-caption' }, 'Ingresos'), h('span', { class: 'sum-num is-income' }, '+' + fmt(r.income)))),
    statRow('Saldo', signed(r.balance, cur), balTone),
    statRow('Movimientos', String(r.count)),
    h('p', { class: 'cmp-line' }, changeText(r.expenseChange, false, kind))));

  // Gasto por día (no aplica al reporte diario)
  if (kind !== 'dia' && r.expense > 0) {
    const buckets = chartBuckets(r.byDay);
    out.append(h('div', { class: 'card' },
      h('h2', { class: 'sec-title' }, kind === 'semana' ? 'Gasto por día' : 'Gasto a lo largo del mes'),
      h('div', { class: 'rep-chart' }, bars(
        buckets.map((b) => ({ label: barLabel(kind, b), value: b.cents, color: '#b3261e' })),
        { title: 'Gasto por día', format: fmt }))));
  }

  // Por categoría
  if (r.shares.length) {
    out.append(h('div', { class: 'card' },
      h('h2', { class: 'sec-title' }, 'Por categoría'),
      h('ul', { class: 'rows rep-rows' }, r.shares.map((s) => {
        const cat = catsById.get(s.catId) || NO_CAT;
        return h('li', { class: 'row rep-row' },
          catBadge(cat),
          h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, cat.name)),
          h('span', { class: 'cat-pct' }, s.pct + '%'),
          h('span', { class: 'row-amount' }, fmt(s.cents)));
      }))));
  }

  // Información avanzada
  const adv = [];
  if (kind !== 'dia') {
    adv.push(statRow('Promedio de gasto por día', fmt(r.avgPerDay)));
    if (r.maxDay) adv.push(statRow('Día de mayor gasto', dayLabel(r.maxDay.date) + ' · ' + fmt(r.maxDay.cents)));
  }
  if (r.projection !== null && kind === 'mes') adv.push(statRow('Si seguís a este ritmo, cerrás el mes en', fmt(r.projection)));
  if (r.expense > 0) {
    adv.push(statRow('Gastos fijos', fmt(r.fixed)));
    if (r.installments) adv.push(statRow('Cuotas', fmt(r.installments)));
    adv.push(statRow('Gastos variables', fmt(r.variable)));
    for (const [m, cents] of Object.entries(r.byMethod).sort((a, b) => b[1] - a[1])) {
      adv.push(statRow('Pagado con ' + (METHOD_LABEL[m] || m), fmt(cents) + ' · ' + Math.round((cents * 100) / r.expense) + '%'));
    }
  }
  if (r.income > 0 && kind === 'mes') {
    const rate = Math.round(((r.income - r.expense) * 100) / r.income);
    adv.push(statRow('Ahorro sobre ingresos', rate + '%', rate < 0 ? 'is-expense' : 'is-income'));
  }
  if (kind === 'mes' && limit && limit.currency === cur) {
    const { pct, level } = budgetStatus(r.expense, limit.amount);
    adv.push(statRow('Límite de gasto mensual', pct + '% de ' + fmt(limit.amount), level === 'ok' ? '' : 'is-expense'));
  }
  if (adv.length) {
    out.append(h('div', { class: 'card' }, h('h2', { class: 'sec-title' }, 'Información avanzada'), ...adv));
  }

  // Gastos más grandes
  if (r.topExpenses.length) {
    out.append(h('div', { class: 'card' },
      h('h2', { class: 'sec-title' }, 'Gastos más grandes'),
      h('ul', { class: 'rows rep-rows' }, r.topExpenses.map((t) => {
        const cat = catsById.get(t.categoryId) || NO_CAT;
        return h('li', { class: 'row rep-row' },
          catBadge(cat),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, t.note || cat.name),
            h('span', { class: 'row-sub' }, dayLabel(t.date) + ' · ' + cat.name)),
          h('span', { class: 'row-amount is-expense' }, fmt(t.amount)));
      }))));
  }
  return out;
}

export async function render(container, params = {}) {
  const today = todayISO();
  const kind = normalizePeriod(params.p);
  let d = ISO_RE.test(params.d || '') ? params.d : today;
  if (d > today) d = today;
  const { from, to } = periodRange(kind, d);
  const prevRange = periodRange(kind, shiftPeriod(kind, d, -1));

  const [cats, cur, prev, limitRaw] = await Promise.all([
    listCategories(),
    queryTransactions({ from, to, limit: 0 }),
    queryTransactions({ from: prevRange.from, to: prevRange.to, limit: 0 }),
    getSetting('spendLimit', null),
  ]);
  const catsById = new Map(cats.map((c) => [c.id, c]));
  const report = buildReport(cur.items, { from, to, today }, prev.items);
  const label = periodLabel(kind, from, to);
  const atCurrent = to >= today;

  const seg = h('div', { class: 'seg seg-3 no-print', role: 'group', 'aria-label': 'Tipo de reporte' },
    ...PERIODS.map((p) => h('button', {
      class: 'seg-btn', type: 'button', 'aria-pressed': String(p === kind), dataset: { fk: 'rep-' + p },
      onclick: () => { if (p !== kind) navigate(hashFor(p, d)); },
    }, PERIOD_LABEL[p])));

  const picker = h('div', { class: 'month-picker' },
    h('button', {
      class: 'icon-btn no-print', type: 'button', 'aria-label': 'Período anterior', dataset: { fk: 'rep-prev' },
      onclick: () => navigate(hashFor(kind, shiftPeriod(kind, d, -1))),
    }, icon('back')),
    h('div', { class: 'month-label', 'aria-live': 'polite' }, label),
    h('button', {
      class: 'icon-btn no-print' + (atCurrent ? ' is-off' : ''), type: 'button', 'aria-label': 'Período siguiente',
      'aria-disabled': atCurrent ? 'true' : null, dataset: { fk: 'rep-next' },
      onclick: () => {
        if (atCurrent) return;
        const n = shiftPeriod(kind, d, 1);
        navigate(hashFor(kind, n > today ? today : n));
      },
    }, icon('chevron')));

  const csvBtn = h('button', { class: 'btn', type: 'button', dataset: { fk: 'rep-csv' } }, 'Exportar CSV');
  csvBtn.addEventListener('click', async () => {
    csvBtn.disabled = true;
    try {
      await exportCSV({ from, to });
      showSnackbar({ text: 'CSV listo.' });
    } catch (e) {
      showSnackbar({ text: 'No se pudo exportar el CSV.' });
    }
    csvBtn.disabled = false;
  });
  // PDF = imprimir: el navegador ofrece "Guardar como PDF" (sin librerías). css/reportes.css arma la hoja.
  const pdfBtn = h('button', { class: 'btn btn-primary', type: 'button', dataset: { fk: 'rep-pdf' }, onclick: () => window.print() }, 'Exportar PDF');

  container.append(
    h('a', { class: 'back no-print', href: '#/resumen' }, icon('back'), 'Resumen'),
    h('div', { class: 'page-head' },
      h('h1', null, 'Reportes'),
      h('p', { class: 'print-only rep-print-sub' }, 'Control de gastos · generado el ' + dayLabel(today))),
    seg,
    picker);

  const currencies = Object.keys(report).sort();
  if (!currencies.length) {
    container.append(emptyState({
      title: 'No hay movimientos en este período',
      text: 'Probá con otro período o cargá un movimiento.',
      actionLabel: 'Cargar movimiento',
      onAction: () => openSheet(),
    }));
    return;
  }
  const limit = normalizeLimit(limitRaw);
  for (const c of currencies) {
    container.append(currencyBlock(c, report[c], { kind, catsById, limit, showCode: currencies.length > 1 }));
  }
  container.append(
    h('div', { class: 'set-actions rep-actions no-print' }, pdfBtn, csvBtn),
    h('p', { class: 'hint no-print' }, 'PDF: en la ventana de impresión elegí "Guardar como PDF".'));
}
