// Textos para el widget de iPhone (puro, sin DOM). El widget no formatea: recibe todo listo.
import { formatMoney } from './money.js';
import { monthLabel, parseISO, daysInMonth } from './dates.js';
import { allowance, budgetStatus, normalizeLimit } from './budget.js';

// agg = getMonthAgg(mes actual); limitRaw = setting 'spendLimit'. Todo string (vacío = no mostrar).
export function widgetPayload({ today, currency, agg, limitRaw }) {
  const cur = currency || 'ARS';
  const a = (agg && agg[cur]) || { income: 0, expense: 0 };
  const balance = a.income - a.expense;
  const out = {
    month: monthLabel(today.slice(0, 7)).split(' ')[0],
    spent: formatMoney(a.expense, cur),
    balance: (balance < 0 ? '−' : '') + formatMoney(Math.abs(balance), cur),
    perDay: '',
    limitPct: '',
    currency: cur,
    updated: today,
  };
  const limit = normalizeLimit(limitRaw);
  if (limit && limit.currency === cur) {
    const { y, m, d } = parseISO(today);
    const { perDay } = allowance(limit.amount, a.expense, daysInMonth(y, m) - d + 1);
    out.perDay = formatMoney(perDay, cur);
    out.limitPct = String(budgetStatus(a.expense, limit.amount).pct);
  }
  return out;
}

// Enlace de atajo para la app de iPhone: https://.../#/quick-add?x -> gastos://quick-add?x
export function toNativeLink(webUrl) {
  const i = String(webUrl).indexOf('#/');
  return i < 0 ? 'gastos://resumen' : 'gastos://' + String(webUrl).slice(i + 2);
}
