// Análisis del mes (#/analisis?m=YYYY-MM): radiografía, recomendaciones, simulador "¿Y si...?",
// tendencia, proyección, patrón semanal, peso de fijos y presupuestos. Una sección por moneda.
// Tono neutro: solo números propios, sin juicios. Nunca hay acciones de recorte sobre esenciales.
import { h, icon, catBadge, emptyState } from './dom.js';
import { bars } from './charts.js';
import { navigate } from './router.js';
import { openSheet } from './sheet.js';
import { openModal } from './modal.js';
import { showSnackbar } from './snackbar.js';
import {
  getMonthAgg, listCategories, getAnalysisInput, dismissInsight, saveBudget,
  deleteTransaction, restoreTransaction,
} from '../db.js';
import { analyze, simulate } from '../utils/analysis.js';
import { CONFIG } from '../utils/analysisConfig.js';
import { formatMoney } from '../utils/money.js';
import { addMonths, dayLabel, monthKey, monthLabel, todayISO } from '../utils/dates.js';

const NO_CAT = { id: null, name: 'Sin categoría', emoji: '❔', color: '#6B7280', kind: 'flexible' };
const MINUS = '−';
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // lunes a domingo
const LEVEL_TEXT = { warn: 'Cerca del tope', over: 'Superaste el tope' };
const ONE_OFF = new Set(['unusual', 'duplicate']); // ahorro puntual: no se multiplica por 12

// Lo que recuerda el simulador entre redibujados (se redibuja al escribir en la base).
const simMemory = new Map();

function pickMonth(raw, current) {
  const ok = typeof raw === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw);
  if (!ok) return current;
  return raw > current ? current : raw; // nunca al futuro
}

const rateText = (p) => (p < 0 ? MINUS + Math.abs(p) : String(p)) + '%';
const money = (c, cur) => (c < 0 ? MINUS + formatMoney(-c, cur) : formatMoney(c, cur));

function pctText(p) {
  if (p === null || p === undefined) return '';
  if (p === 0) return '0%';
  return (p > 0 ? '▲ +' : '▼ ' + MINUS) + Math.abs(p) + '%';
}

// ---------- API compartida con Resumen ----------

export async function loadAnalysis(ym, cur) {
  const input = await getAnalysisInput(ym, cur);
  return { input, res: analyze(input) };
}

export function savingsLine(ins, cur) {
  if (!(ins.savingsMonthly > 0)) return '';
  if (ONE_OFF.has(ins.type)) return 'Ahorro puntual posible: ' + money(ins.savingsMonthly, cur) + '.';
  return 'Ahorro posible: ' + money(ins.savingsMonthly, cur) + ' por mes · ' + money(ins.savingsYearly, cur) + ' por año.';
}

// ---------- Confirmación ----------

function confirmDialog({ title, text, confirmLabel, onConfirm }) {
  let close = () => {};
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });
  const yes = h('button', {
    class: 'btn btn-primary grow', type: 'button',
    onclick: async () => {
      yes.disabled = true;
      try {
        await onConfirm();
        close();
      } catch (e) {
        errEl.textContent = 'No se pudo guardar. Probá de nuevo.';
        yes.disabled = false;
      }
    },
  }, confirmLabel);
  const panel = h('div', { class: 'sheet' },
    h('h2', { class: 'sheet-title' }, title),
    h('p', null, text),
    errEl,
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'),
      yes));
  close = openModal(panel, { label: title });
}

function applyBudget({ cat, cur, monthlyLimit, budgetId, hasBudget }) {
  confirmDialog({
    title: 'Fijar tope mensual',
    text: 'Vas a fijar un tope de ' + money(monthlyLimit, cur) + ' por mes en ' + cat.name + '.' +
      (hasBudget ? ' Reemplaza al que tenías.' : ''),
    confirmLabel: 'Fijar tope',
    onConfirm: async () => {
      const b = { categoryId: cat.id, monthlyLimit, currency: cur };
      if (budgetId) b.id = budgetId;
      await saveBudget(b);
      showSnackbar({ text: 'Tope guardado.' });
    },
  });
}

// ---------- Duplicados ----------

function openDuplicates(ins, input, catsById, cur) {
  const ids = new Set(ins.action.txIds || []);
  const txs = (input.monthTxs || []).filter((t) => ids.has(t.id)).sort((a, b) => (a.date < b.date ? -1 : 1));
  let close = () => {};
  const list = h('ul', { class: 'rows' });

  const addRow = (tx) => {
    const cat = catsById.get(tx.categoryId) || NO_CAT;
    const li = h('li', { class: 'dup-item' },
      catBadge(cat),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, dayLabel(tx.date)),
        h('span', { class: 'row-sub' }, tx.note || cat.name)),
      h('span', { class: 'row-amount' }, formatMoney(tx.amount, cur)),
      h('button', {
        class: 'icon-btn icon-btn-danger', type: 'button',
        'aria-label': 'Borrar el gasto de ' + formatMoney(tx.amount, cur) + ' del ' + dayLabel(tx.date),
        onclick: async () => {
          try {
            const gone = await deleteTransaction(tx.id);
            li.remove();
            showSnackbar({
              text: 'Gasto borrado', actionLabel: 'Deshacer', ms: 5000,
              onAction: () => restoreTransaction(gone || tx).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
            });
            if (list.children.length < 2) close();
          } catch (e) {
            showSnackbar({ text: 'No se pudo borrar. Probá de nuevo.' });
          }
        },
      }, icon('trash')));
    list.append(li);
  };
  txs.forEach(addRow);

  const panel = h('div', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title' }, 'Gastos parecidos'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
    h('p', { class: 'row-sub wrap' }, 'Mismo monto y categoría en fechas cercanas. Si alguno fue un error, borralo: podés deshacerlo por 5 segundos.'),
    list);
  close = openModal(panel, { label: 'Gastos parecidos' });
}

// ---------- Simulador ----------

function simulatorCard({ input, cats, cur, ym }) {
  const month = (input.monthly && input.monthly[ym]) || { income: 0, expense: 0, byCat: {} };
  const options = cats.filter((c) => c.kind === 'flexible' && month.byCat[c.id] && month.byCat[c.id].total > 0)
    .sort((a, b) => month.byCat[b.id].total - month.byCat[a.id].total);
  const card = h('section', { class: 'card an-card', 'aria-labelledby': 'sim-' + cur });
  card.append(h('h2', { class: 'sec-title', id: 'sim-' + cur }, '¿Y si...?'));

  if (!options.length) {
    card.append(h('p', { class: 'an-muted' }, 'Este mes no hay gastos flexibles para simular.'));
    return { el: card, has: () => false, preset: () => {} };
  }

  const key = cur + '|' + ym;
  const mem = simMemory.get(key);
  const startCat = mem && options.some((c) => c.id === mem.catId) ? mem.catId : options[0].id;
  const startPct = mem ? mem.pct : 20;

  const catSel = h('select', { class: 'input' }, ...options.map((c) => h('option', { value: c.id }, c.emoji + ' ' + c.name)));
  catSel.value = startCat;
  const pctOut = h('span', { class: 'sim-pct' });
  const range = h('input', { class: 'range', type: 'range', min: 5, max: 50, step: 5, value: startPct });
  const out = h('dl', { class: 'sim-result', 'aria-live': 'polite' });
  const fixBtn = h('button', { class: 'btn btn-primary', type: 'button', dataset: { fk: 'sim-fix-' + cur } }, 'Fijar como presupuesto');

  const balance = month.income - month.expense;
  const rate = month.income > 0 ? Math.round((balance * 100) / month.income) : null;
  let newLimit = 0;

  const line = (label, value, note) => h('div', { class: 'sim-line' },
    h('dt', null, label), h('dd', null, value, note ? h('span', { class: 'sim-note' }, note) : null));

  function update() {
    const pct = Number(range.value);
    const catId = catSel.value;
    const r = simulate(input, catId, pct);
    pctOut.textContent = pct + '%';
    range.setAttribute('aria-valuetext', pct + ' por ciento');
    simMemory.set(key, { catId, pct });
    newLimit = month.byCat[catId].total - r.monthly;
    fixBtn.disabled = !(newLimit > 0);
    out.replaceChildren(
      line('Ahorro por mes', money(r.monthly, cur)),
      line('Ahorro por año', money(r.yearly, cur)),
      line('Nuevo saldo del mes', money(r.newBalance, cur), ' (hoy ' + money(balance, cur) + ')'),
      line('Tasa de ahorro', r.newSavingsRate === null ? 'Sin ingresos este mes' : rateText(r.newSavingsRate),
        r.newSavingsRate !== null && rate !== null ? ' (hoy ' + rateText(rate) + ')' : ''));
  }
  catSel.addEventListener('change', update);
  range.addEventListener('input', update);
  fixBtn.addEventListener('click', () => {
    const cat = options.find((c) => c.id === catSel.value);
    if (!cat || !(newLimit > 0)) return;
    const existing = (input.budgets || []).find((b) => b.categoryId === cat.id && (b.currency || cur) === cur);
    applyBudget({ cat, cur, monthlyLimit: newLimit, budgetId: existing ? existing.id : null, hasBudget: !!existing });
  });

  card.append(
    h('p', { class: 'an-muted' }, 'Mirá cómo cambiaría tu mes si gastaras menos en una categoría flexible.'),
    h('div', { class: 'field' }, h('label', null, 'Categoría', catSel)),
    h('div', { class: 'field' }, h('label', null, h('span', null, 'Gastar menos en un ', pctOut), range)),
    out,
    fixBtn);
  update();

  return {
    el: card,
    has: (catId) => options.some((c) => c.id === catId),
    preset(catId, pct) {
      catSel.value = catId;
      const step = Math.min(50, Math.max(5, Math.round((Number(pct) || 20) / 5) * 5));
      range.value = String(step);
      update();
      const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
      range.focus({ preventScroll: true });
    },
  };
}

// ---------- Secciones ----------

function block(title, ...children) {
  return h('section', { class: 'card an-card' }, h('h2', { class: 'sec-title' }, title), ...children);
}

function radiographyCard(res, catsById, cur) {
  const r = res.radiography;
  const stat = (label, value, tone) => h('div', null,
    h('span', { class: 'sum-caption' }, label), h('span', { class: 'sum-num ' + (tone || '') }, value));
  const top = r.topCategories.map((t) => {
    const cat = catsById.get(t.catId) || NO_CAT;
    return h('li', { class: 'an-row' },
      catBadge(cat),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, cat.name),
        h('span', { class: 'row-sub wrap' }, (t.pctOfExpense !== null ? t.pctOfExpense + '% de tus gastos' : '') +
          (t.pctOfIncome !== null ? ' · ' + t.pctOfIncome + '% de tus ingresos' : ''))),
      h('span', { class: 'row-amount' }, formatMoney(t.total, cur)));
  });
  const essPct = r.essential.pct === null ? 0 : r.essential.pct;
  return block('Radiografía del mes',
    h('div', { class: 'an-stats' },
      stat('Ingresos', '+' + formatMoney(r.income, cur), 'is-income'),
      stat('Gastos', MINUS + formatMoney(r.expense, cur), 'is-expense'),
      stat('Saldo', money(r.balance, cur), r.balance < 0 ? 'is-expense' : r.balance > 0 ? 'is-income' : ''),
      stat('Tasa de ahorro', r.savingsRate === null ? 'Sin ingresos' : rateText(r.savingsRate))),
    top.length ? h('div', null, h('h3', { class: 'an-sub' }, 'Donde más gastaste'), h('ul', { class: 'an-list' }, top)) : null,
    r.expense > 0
      ? h('div', { class: 'an-split' },
        h('h3', { class: 'an-sub' }, 'Esenciales y flexibles'),
        h('div', { class: 'split-bar', 'aria-hidden': 'true', vars: { '--pct': String(essPct) } }, h('span', { class: 'split-fill' })),
        h('p', { class: 'an-muted' },
          'Esenciales: ' + (r.essential.pct === null ? 0 : r.essential.pct) + '% (' + formatMoney(r.essential.total, cur) + ')' +
          ' · Flexibles: ' + (r.flexible.pct === null ? 0 : r.flexible.pct) + '% (' + formatMoney(r.flexible.total, cur) + ')'))
      : null);
}

function insightItem(ins, n, ctx) {
  const { cur, ym, catsById, sim, input } = ctx;
  const cat = ins.catId ? (catsById.get(ins.catId) || NO_CAT) : null;
  const blocked = cat && cat.kind === 'essential'; // defensa: nunca acciones sobre esenciales
  const a = ins.action || { kind: 'none' };
  const actions = [];

  if (!blocked) {
    if (a.kind === 'open-simulator' && sim.has(a.catId)) {
      actions.push(h('button', {
        class: 'btn', type: 'button', dataset: { fk: 'act-' + cur + '-' + ins.key },
        onclick: () => sim.preset(a.catId, a.pct),
      }, 'Simular'));
    } else if (a.kind === 'apply-budget' && cat && a.monthlyLimit > 0) {
      actions.push(h('button', {
        class: 'btn', type: 'button', dataset: { fk: 'act-' + cur + '-' + ins.key },
        onclick: () => applyBudget({ cat, cur: a.currency || cur, monthlyLimit: a.monthlyLimit, budgetId: a.budgetId, hasBudget: !!a.budgetId }),
      }, 'Fijar tope de ' + formatMoney(a.monthlyLimit, a.currency || cur)));
    } else if (a.kind === 'review-duplicates') {
      actions.push(h('button', {
        class: 'btn', type: 'button', dataset: { fk: 'act-' + cur + '-' + ins.key },
        onclick: () => openDuplicates(ins, input, catsById, cur),
      }, 'Revisar'));
    }
  }
  actions.push(h('button', {
    class: 'btn btn-ghost', type: 'button', dataset: { fk: 'dismiss-' + cur + '-' + ins.key },
    onclick: async () => {
      try {
        await dismissInsight(ins.key, ym);
        showSnackbar({ text: 'Listo, no te lo mostramos más este mes.' });
      } catch (e) {
        showSnackbar({ text: 'No se pudo guardar. Probá de nuevo.' });
      }
    },
  }, 'No mostrar más'));

  return h('li', { class: 'insight' },
    h('span', { class: 'insight-n', 'aria-hidden': 'true' }, String(n)),
    h('div', { class: 'insight-body' },
      h('p', { class: 'insight-text' }, ins.text),
      savingsLine(ins, cur) ? h('p', { class: 'insight-save' }, savingsLine(ins, cur)) : null,
      h('div', { class: 'insight-actions' }, actions)));
}

function insightsCard(res, ctx) {
  const list = res.insights;
  return block('Recomendaciones',
    list.length
      ? h('ol', { class: 'insight-list' }, list.map((ins, i) => insightItem(ins, i + 1, ctx)))
      : h('p', { class: 'an-muted' }, 'Este mes no hay nada para sugerirte.'));
}

function trendCard(res, catsById, cur) {
  const total = res.trends.find((t) => t.scope === 'total');
  const cats = res.trends.filter((t) => t.scope === 'category' && t.current > 0)
    .sort((a, b) => b.current - a.current).slice(0, 6);
  if (!total) return null;
  const rows = cats.map((t) => {
    const cat = catsById.get(t.catId) || NO_CAT;
    const flags = [];
    if (t.rising) flags.push('Sube hace ' + CONFIG.streakMonths + ' meses');
    if (t.aboveAvg) flags.push('Por encima de tu promedio');
    const vs = t.deltaPrevPct === null ? 'Nuevo este mes' : pctText(t.deltaPrevPct) + ' vs. mes anterior';
    return h('li', { class: 'an-row' },
      catBadge(cat),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, cat.name),
        h('span', { class: 'row-sub wrap' }, [vs].concat(flags).join(' · '))),
      h('span', { class: 'row-amount' }, formatMoney(t.current, cur)));
  });
  return block('Tendencia',
    h('p', { class: 'an-lead' },
      'Gastos del mes: ' + formatMoney(total.current, cur) +
      (total.prev > 0 ? '. El mes anterior fueron ' + formatMoney(total.prev, cur) + ' (' + pctText(total.deltaPrevPct) + ').' : '.') +
      (total.avg !== null ? ' Tu promedio de ' + CONFIG.avgMonths + ' meses es ' + formatMoney(total.avg, cur) + '.' : '')),
    rows.length ? h('ul', { class: 'an-list' }, rows) : null);
}

function projectionCard(res, catsById, cur, isCurrent) {
  const p = res.projection;
  if (!p) {
    return isCurrent
      ? block('Proyección', h('p', { class: 'an-muted' }, 'La proyección aparece a partir del día ' + CONFIG.projectionMinDay + ' del mes.'))
      : null;
  }
  const over = p.budgets.filter((b) => b.willExceed || b.alreadyOver);
  return block('Proyección',
    h('p', { class: 'an-lead' },
      'Llevás ' + formatMoney(p.spent, cur) + ' gastados en ' + p.day + ' días (unos ' + formatMoney(p.dailyAverage, cur) +
      ' por día). A este ritmo el mes cierra en ' + formatMoney(p.projectedExpense, cur) + '.'),
    p.income > 0
      ? h('p', { class: 'an-muted' },
        'Con tus ingresos de ' + formatMoney(p.income, cur) + ', el saldo quedaría en ' + money(p.projectedBalance, cur) + '.' +
        (p.exceedsIncome ? ' Los gastos superarían a los ingresos del mes.' : ''))
      : null,
    over.length
      ? h('ul', { class: 'an-list' }, over.map((b) => {
        const cat = catsById.get(b.catId) || NO_CAT;
        return h('li', { class: 'an-row' },
          catBadge(cat),
          h('span', { class: 'row-main' },
            h('span', { class: 'row-title' }, cat.name),
            h('span', { class: 'row-sub wrap' }, (b.alreadyOver ? 'Ya llegaste al tope de ' : 'Proyectás ' + formatMoney(b.projected, cur) + ' y tu tope es ') +
              formatMoney(b.limit, cur))));
      }))
      : null);
}

function weeklyCard(res, cur) {
  const w = res.weekly;
  if (!w) return null;
  const data = WEEK_ORDER.map((d) => ({ label: DAY_SHORT[d], value: w.byDow[d], color: '#0F6B5C' }));
  return block('Patrón semanal',
    h('p', { class: 'an-lead' },
      'El día que más gastás es el ' + DAY_NAMES[w.peakDow] + ': ' + w.peakPct + '% del total (' +
      formatMoney(w.peakTotal, cur) + '), mirando ' + w.months + ' meses.'),
    h('div', { class: 'week-chart' }, bars(data, { title: 'Gasto por día de la semana', format: (v) => formatMoney(v, cur) })));
}

function fixedCard(res, catsById, cur) {
  const f = res.fixedWeight;
  const inst = f.installments || [];
  if (!f.items.length && !inst.length) return null;
  const rows = f.items.slice(0, 5).map((i) => {
    const cat = catsById.get(i.catId) || NO_CAT;
    return h('li', { class: 'an-row' },
      catBadge(cat),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, i.note || cat.name),
        h('span', { class: 'row-sub wrap' }, i.pctOfIncome !== null ? i.pctOfIncome + '% de tus ingresos' : 'Por mes')),
      h('span', { class: 'row-amount' }, formatMoney(i.amount, cur)));
  });
  // Compras en cuotas que todavía tienen cuotas por pagar.
  const instRows = inst.map((g) => {
    const cat = catsById.get(g.catId) || NO_CAT;
    return h('li', { class: 'an-row', dataset: { fk: 'inst-' + g.groupId } },
      catBadge(cat),
      h('span', { class: 'row-main' },
        h('span', { class: 'row-title' }, g.note || cat.name),
        h('span', { class: 'row-sub wrap' }, g.paid + ' de ' + g.count + ' cuotas pagas · termina en ' + monthLabel(g.endMonth))),
      h('span', { class: 'row-amount' }, formatMoney(g.remaining, cur)));
  });
  return block('Peso de tus gastos fijos',
    f.items.length
      ? h('p', { class: 'an-lead' },
        'Tus gastos fijos suman ' + formatMoney(f.total, cur) + ' por mes' +
        (f.pctOfIncome !== null ? ' (' + f.pctOfIncome + '% de tus ingresos)' : '') + ', unos ' + formatMoney(f.yearlyTotal, cur) + ' por año.')
      : null,
    f.items.length ? h('ul', { class: 'an-list' }, rows) : null,
    instRows.length
      ? h('div', { class: 'an-inst' },
        h('h3', { class: 'an-sub' }, 'Compras en cuotas'),
        h('p', { class: 'an-muted' }, 'Lo que te queda por pagar de compras ya hechas.'),
        h('ul', { class: 'an-list' }, instRows))
      : null);
}

function budgetsCard(res, catsById, cur) {
  if (!res.budgets.length) return null;
  const items = res.budgets.map((b) => {
    const cat = catsById.get(b.catId) || NO_CAT;
    const summary = formatMoney(b.spent, cur) + ' de ' + formatMoney(b.limit, cur) + ' · ' + b.pct + '%';
    const canApply = cat.kind !== 'essential' && b.suggestedLimit != null && b.suggestedLimit < b.limit;
    return h('li', { class: 'budget-item an-budget is-' + b.level },
      h('div', { class: 'an-row' },
        catBadge(cat),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, cat.name),
          h('span', { class: 'row-sub budget-sub' }, summary),
          LEVEL_TEXT[b.level] ? h('span', { class: 'budget-state' }, LEVEL_TEXT[b.level]) : null)),
      h('div', {
        class: 'progress', role: 'progressbar', 'aria-label': 'Gastado de ' + cat.name,
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.min(b.pct, 100), 'aria-valuetext': summary,
        vars: { '--pct': String(Math.min(b.pct, 100)) },
      }, h('span', { class: 'progress-fill' })),
      canApply
        ? h('div', { class: 'an-sug' },
          h('p', { class: 'an-muted' }, 'Tope sugerido: ' + formatMoney(b.suggestedLimit, cur) +
            ' (tu promedio de ' + CONFIG.avgMonths + ' meses menos ' + CONFIG.budgetDiscountPct + '%).'),
          h('button', {
            class: 'btn', type: 'button', dataset: { fk: 'apply-' + cur + '-' + b.catId },
            'aria-label': 'Aplicar tope sugerido de ' + formatMoney(b.suggestedLimit, cur) + ' en ' + cat.name,
            onclick: () => applyBudget({ cat, cur, monthlyLimit: b.suggestedLimit, budgetId: b.budgetId, hasBudget: true }),
          }, 'Aplicar'))
        : null);
  });
  return block('Presupuestos', h('ul', { class: 'an-plain' }, items));
}

function insufficientCard(res) {
  const p = res.progress;
  const ratio = Math.min(1, p.count / p.minCount, p.days / p.minDays);
  const pct = Math.round(ratio * 100);
  const text = 'Llevás ' + Math.min(p.count, p.minCount) + ' de ' + p.minCount + ' movimientos y ' +
    Math.min(p.days, p.minDays) + ' de ' + p.minDays + ' días.';
  return h('section', { class: 'card an-card an-wait' },
    h('h2', { class: 'sec-title' }, 'Cargá gastos unos días más y te armo el análisis'),
    h('p', { class: 'an-muted' }, text),
    h('div', {
      class: 'progress an-progress', role: 'progressbar', 'aria-label': 'Avance para el análisis',
      'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-valuetext': text,
      vars: { '--pct': String(pct) },
    }, h('span', { class: 'progress-fill' })));
}

function currencySection({ cur, input, res, cats, catsById, ym, isCurrent, showCode }) {
  const out = h('section', { class: 'an-section', 'aria-label': showCode ? 'Análisis en ' + cur : 'Análisis del mes' });
  if (showCode) out.append(h('h2', { class: 'sum-cur' }, cur));
  if (res.status !== 'ok') {
    out.append(insufficientCard(res));
    return out;
  }
  const sim = simulatorCard({ input, cats, cur, ym });
  const ctx = { cur, ym, catsById, sim, input };
  // Element.append(null) escribiría "null": se filtran las secciones vacías.
  out.append(...[
    radiographyCard(res, catsById, cur),
    insightsCard(res, ctx),
    sim.el,
    trendCard(res, catsById, cur),
    projectionCard(res, catsById, cur, isCurrent),
    weeklyCard(res, cur),
    fixedCard(res, catsById, cur),
    budgetsCard(res, catsById, cur),
  ].filter(Boolean));
  return out;
}

export async function render(container, params = {}) {
  const current = monthKey(todayISO());
  const ym = pickMonth(params.m, current);
  const [cats, agg] = await Promise.all([listCategories(), getMonthAgg(ym)]);
  const catsById = new Map(cats.map((c) => [c.id, c]));

  const go = (m) => navigate('#/analisis?m=' + m);
  const atCurrent = ym >= current;
  container.append(
    h('a', { class: 'back', href: '#/resumen' }, icon('back'), 'Resumen'),
    h('div', { class: 'page-head' }, h('h1', null, 'Análisis')),
    h('div', { class: 'month-picker' },
      h('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Mes anterior', dataset: { fk: 'prev-month' },
        onclick: () => go(addMonths(ym, -1)),
      }, icon('back')),
      h('div', { class: 'month-label', 'aria-live': 'polite' }, monthLabel(ym)),
      h('button', {
        class: 'icon-btn' + (atCurrent ? ' is-off' : ''), type: 'button', 'aria-label': 'Mes siguiente',
        'aria-disabled': atCurrent ? 'true' : null, dataset: { fk: 'next-month' },
        onclick: () => { if (!atCurrent) go(addMonths(ym, 1)); },
      }, icon('chevron'))));

  const currencies = Object.keys(agg).sort();
  if (!currencies.length) {
    container.append(emptyState({
      title: ym === current ? 'Todavía no hay movimientos este mes' : 'No hay movimientos en este mes',
      text: 'Cuando cargues gastos o ingresos te armo el análisis.',
      actionLabel: 'Cargar movimiento',
      onAction: () => openSheet(),
    }));
  } else {
    const loaded = await Promise.all(currencies.map((c) => loadAnalysis(ym, c)));
    currencies.forEach((cur, i) => {
      container.append(currencySection({
        cur, input: loaded[i].input, res: loaded[i].res, cats, catsById, ym,
        isCurrent: ym === current, showCode: currencies.length > 1,
      }));
    });
  }
  container.append(h('p', { class: 'an-note' }, 'Montos nominales, sin ajuste por inflación.'));
}
