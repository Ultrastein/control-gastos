// Historial: movimientos agrupados por día, con búsqueda, filtros y paginado.
import { h, clear, catBadge, emptyState } from './dom.js';
import { openSheet, isInstallment, METHOD_LABEL } from './sheet.js';
import { queryTransactions, listCategories, listReceiptIds } from '../db.js';
import { formatMoney } from '../utils/money.js';
import { dayLabel } from '../utils/dates.js';

const PAGE = 40;
const NO_CAT = { name: 'Sin categoría', emoji: '❔', color: '#6B7280' };

// Estado de la pantalla: sobrevive al re-render que dispara un cambio en la base.
const state = { text: '', type: '', categoryId: '', from: '', to: '', filtersOpen: false, loaded: 0 };

const filterCount = () => ['type', 'categoryId', 'from', 'to'].filter((k) => state[k]).length;
const anyFilter = () => filterCount() > 0 || state.text.trim() !== '';

// Lo usa Resumen para abrir el Historial ya filtrado (categoría y rango de fechas).
export function setFilters({ categoryId = '', type = '', from = '', to = '' } = {}) {
  Object.assign(state, { text: '', type, categoryId, from, to, filtersOpen: true, loaded: 0 });
}

export async function render(container) {
  const [cats, receiptIds] = await Promise.all([listCategories(), listReceiptIds().catch(() => [])]);
  const withReceipt = new Set(receiptIds);
  const byId = new Map(cats.map((c) => [c.id, c]));

  let next = null;
  let token = 0;
  let loading = false;
  let lastDate = null;
  let lastList = null;
  let timer = null;

  const list = h('div', { class: 'hist-list' });
  const more = h('button', { class: 'btn hist-more', type: 'button', hidden: true, onclick: () => loadMore() }, 'Cargar más');
  const summaryCount = h('span', { class: 'filter-count' });

  const params = () => ({
    from: state.from || undefined,
    to: state.to || undefined,
    categoryId: state.categoryId || undefined,
    type: state.type || undefined,
    text: state.text.trim() || undefined,
  });

  function row(tx) {
    const cat = byId.get(tx.categoryId) || NO_CAT;
    const income = tx.type === 'income';
    const cuota = isInstallment(tx);
    const method = tx.paymentMethod && tx.paymentMethod !== 'efectivo' ? METHOD_LABEL[tx.paymentMethod] : null;
    const receipt = withReceipt.has(tx.id);
    const tags = cuota || method || receipt
      ? h('span', { class: 'row-tags' },
        cuota
          ? h('span', { class: 'tag tag-inst', 'aria-label': 'Cuota ' + tx.installmentNumber + ' de ' + tx.totalInstallments },
            tx.installmentNumber + '/' + tx.totalInstallments)
          : null,
        method ? h('span', { class: 'tag' }, method) : null,
        receipt ? h('span', { class: 'tag tag-receipt' }, '📎 Recibo') : null)
      : null;
    return h('li', null,
      h('button', { class: 'row', type: 'button', dataset: { fk: 'tx-' + tx.id }, onclick: () => openSheet({ tx }) },
        catBadge(cat),
        h('span', { class: 'row-main' },
          h('span', { class: 'row-title' }, tx.note || cat.name),
          tx.note ? h('span', { class: 'row-sub' }, cat.name) : null,
          tags),
        h('span', { class: 'row-amount ' + (income ? 'is-income' : 'is-expense') },
          (income ? '+' : '-') + formatMoney(tx.amount, tx.currency))));
  }

  function append(items) {
    for (const tx of items) {
      if (tx.date !== lastDate) {
        lastDate = tx.date;
        lastList = h('ul', { class: 'rows' });
        list.append(h('section', { class: 'day' }, h('h3', { class: 'day-title' }, dayLabel(tx.date)), lastList));
      }
      lastList.append(row(tx));
    }
  }

  function syncMore() {
    more.hidden = !next;
  }

  function showEmpty() {
    list.append(anyFilter()
      ? emptyState({
        title: 'No hay movimientos así',
        text: 'Probá con otra búsqueda o sacá algún filtro.',
        actionLabel: 'Limpiar filtros',
        onAction: clearFilters,
      })
      : emptyState({ title: 'Todavía no cargaste nada', text: 'Tocá el + para anotar tu primer gasto o ingreso.' }));
  }

  async function reload(limit = PAGE) {
    const mine = ++token;
    const res = await queryTransactions({ ...params(), limit });
    if (mine !== token) return;
    clear(list);
    lastDate = null;
    lastList = null;
    append(res.items);
    next = res.next;
    state.loaded = res.items.length;
    if (!res.items.length) showEmpty();
    syncMore();
  }

  async function loadMore() {
    if (!next || loading) return;
    loading = true;
    more.disabled = true;
    const mine = token;
    try {
      const res = await queryTransactions({ ...params(), limit: PAGE, after: next });
      if (mine !== token) return;
      append(res.items);
      next = res.next;
      state.loaded += res.items.length;
    } catch (e) {
      /* queda el botón para reintentar */
    } finally {
      loading = false;
      more.disabled = false;
      syncMore();
    }
  }

  function changed() {
    summaryCount.textContent = filterCount() ? String(filterCount()) : '';
    reload().catch(() => {});
  }

  function clearFilters() {
    Object.assign(state, { text: '', type: '', categoryId: '', from: '', to: '' });
    q.value = '';
    typeSel.value = '';
    catSel.value = '';
    fromEl.value = '';
    toEl.value = '';
    changed();
  }

  // --- Controles ---
  const q = h('input', {
    class: 'input', type: 'search', placeholder: 'Buscar en las notas', 'aria-label': 'Buscar en las notas',
    autocomplete: 'off', value: state.text, dataset: { fk: 'q' },
    oninput: () => {
      state.text = q.value;
      clearTimeout(timer);
      timer = setTimeout(changed, 250);
    },
  });
  const typeSel = h('select', { class: 'input', 'aria-label': 'Tipo', onchange: () => { state.type = typeSel.value; changed(); } },
    h('option', { value: '' }, 'Gastos e ingresos'),
    h('option', { value: 'expense' }, 'Solo gastos'),
    h('option', { value: 'income' }, 'Solo ingresos'));
  typeSel.value = state.type;
  const catSel = h('select', { class: 'input', 'aria-label': 'Categoría', onchange: () => { state.categoryId = catSel.value; changed(); } },
    h('option', { value: '' }, 'Todas las categorías'),
    ...cats.map((c) => h('option', { value: c.id }, c.emoji + ' ' + c.name)));
  catSel.value = state.categoryId;
  const fromEl = h('input', { class: 'input', type: 'date', value: state.from, onchange: () => { state.from = fromEl.value; changed(); } });
  const toEl = h('input', { class: 'input', type: 'date', value: state.to, onchange: () => { state.to = toEl.value; changed(); } });

  const filters = h('details', {
    class: 'filters',
    open: state.filtersOpen || filterCount() > 0,
    ontoggle: () => { state.filtersOpen = filters.open; },
  },
  h('summary', null, 'Filtros', summaryCount),
  h('div', { class: 'filters-body' },
    typeSel,
    catSel,
    h('div', { class: 'field' }, h('label', null, 'Desde', fromEl)),
    h('div', { class: 'field' }, h('label', null, 'Hasta', toEl)),
    h('button', { class: 'btn btn-ghost filters-clear', type: 'button', onclick: clearFilters }, 'Limpiar filtros')));
  summaryCount.textContent = filterCount() ? String(filterCount()) : '';

  container.append(
    h('div', { class: 'page-head' }, h('h1', null, 'Historial')),
    h('div', { class: 'hist-controls' }, q, filters),
    list,
    h('div', { class: 'hist-more-wrap' }, more));

  await reload(Math.max(PAGE, state.loaded));

  // Scroll infinito: al asomar el botón, carga la página siguiente.
  let observer = null;
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '300px' });
    observer.observe(more);
  }

  return () => {
    token++;
    clearTimeout(timer);
    if (observer) observer.disconnect();
  };
}
