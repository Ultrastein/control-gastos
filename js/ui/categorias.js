// Categorías: crear, editar, borrar (con reasignación) y reordenar. Se abre desde Ajustes.
import { h, icon, catBadge, setBadge, emptyState } from './dom.js';
import { openModal } from './modal.js';
import { showSnackbar } from './snackbar.js';
import { listCategories, saveCategory, deleteCategory, reorderCategories, queryTransactions } from '../db.js';

const KIND_LABEL = { essential: 'Esencial', flexible: 'Flexible' };
const COLORS = ['#E5484D', '#F76B15', '#F5B301', '#30A46C', '#12A594', '#0091FF', '#3E63DD', '#8E4EC6', '#D6409F', '#7C6F64', '#6B7280', '#111827'];
const EMOJIS = ['🍽️', '🛒', '🚌', '🏠', '💡', '🎉', '💊', '🛍️', '☕', '🎓', '🐶', '✈️', '🎁', '👕', '💰', '📦'];

export async function render(container) {
  const cats = await listCategories();

  async function move(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= cats.length) return;
    const ids = cats.map((c) => c.id);
    [ids[index], ids[to]] = [ids[to], ids[index]];
    try {
      await reorderCategories(ids); // el evento 'change' vuelve a dibujar la lista
    } catch (e) {
      showSnackbar({ text: 'No se pudo reordenar.' });
    }
  }

  const arrow = (index, delta, name, iconName) => {
    const off = index + delta < 0 || index + delta >= cats.length;
    return h('button', {
      class: 'icon-btn' + (off ? ' is-off' : ''),
      type: 'button',
      'aria-label': name + ' ' + cats[index].name,
      'aria-disabled': off ? 'true' : null,
      dataset: { fk: (delta < 0 ? 'up-' : 'down-') + cats[index].id },
      onclick: () => move(index, delta),
    }, icon(iconName));
  };

  const items = cats.map((c, i) => h('li', { class: 'cat-item' },
    h('button', {
      class: 'row', type: 'button', dataset: { fk: 'edit-' + c.id },
      onclick: () => openCategoryForm(c, cats),
    },
    catBadge(c),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, c.name),
      h('span', { class: 'row-sub' }, KIND_LABEL[c.kind] || 'Flexible'))),
    arrow(i, -1, 'Subir', 'up'),
    arrow(i, 1, 'Bajar', 'down')));

  container.append(
    h('a', { class: 'back', href: '#/ajustes' }, icon('back'), 'Ajustes'),
    h('div', { class: 'page-head' },
      h('h1', null, 'Categorías'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCategoryForm(null, cats) }, icon('plus'), 'Nueva')),
    cats.length
      ? h('ul', { class: 'rows cat-list' }, items)
      : emptyState({ title: 'No hay categorías', text: 'Creá al menos una para poder cargar gastos.' }),
    h('p', { class: 'hint' }, 'Las esenciales (alquiler, salud, servicios…) no se usan para sugerir recortes.'));
}

// ---------- Formulario ----------

function openCategoryForm(cat, cats) {
  const st = {
    emoji: cat ? cat.emoji : '📦',
    color: cat ? cat.color : COLORS[5],
    kind: cat ? cat.kind : 'flexible',
  };
  let close = () => {};

  const preview = h('span', { class: 'cat-badge cat-badge-lg', 'aria-hidden': 'true' });
  const nameEl = h('input', {
    class: 'input', type: 'text', maxlength: 30, autocomplete: 'off', required: true,
    value: cat ? cat.name : '', placeholder: 'Ej: Gimnasio',
  });
  const emojiEl = h('input', {
    class: 'input emoji-input', type: 'text', maxlength: 16, autocomplete: 'off', value: st.emoji,
    'aria-label': 'Emoji',
    oninput: () => { st.emoji = emojiEl.value.trim() || '📦'; paint(); },
  });
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });

  const emojiBtns = EMOJIS.map((e) => h('button', {
    class: 'pick', type: 'button', 'aria-label': 'Emoji ' + e,
    onclick: () => { st.emoji = e; emojiEl.value = e; paint(); },
  }, e));
  const colorBtns = COLORS.map((c) => h('button', {
    class: 'pick swatch', type: 'button', 'aria-label': 'Color ' + c, vars: { '--cat': c },
    onclick: () => { st.color = c; paint(); },
  }));
  const kindBtns = {};
  const kindSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Tipo de categoría' },
    ...['essential', 'flexible'].map((k) => {
      kindBtns[k] = h('button', { class: 'seg-btn', type: 'button', onclick: () => { st.kind = k; paint(); } }, KIND_LABEL[k]);
      return kindBtns[k];
    }));

  function paint() {
    setBadge(preview, st);
    emojiBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(EMOJIS[i] === st.emoji)));
    colorBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i] === st.color)));
    for (const [k, b] of Object.entries(kindBtns)) b.setAttribute('aria-pressed', String(k === st.kind));
  }

  async function save() {
    const name = nameEl.value.trim();
    if (!name) {
      errEl.textContent = 'Ponele un nombre.';
      nameEl.focus();
      return;
    }
    try {
      await saveCategory({ ...(cat || {}), name, emoji: st.emoji, color: st.color, kind: st.kind });
      close();
    } catch (e) {
      errEl.textContent = 'No se pudo guardar. Probá de nuevo.';
    }
  }

  const form = h('form', {
    class: 'sheet cat-form', novalidate: true,
    onsubmit: (e) => { e.preventDefault(); save(); },
  },
  h('div', { class: 'sheet-head' },
    h('h2', { class: 'sheet-title' }, cat ? 'Editar categoría' : 'Nueva categoría'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close() }, icon('close'))),
  h('div', { class: 'cat-preview' }, preview, h('div', { class: 'field grow' }, h('label', null, 'Nombre', nameEl))),
  h('div', { class: 'field' }, h('label', null, 'Emoji', emojiEl)),
  h('div', { class: 'picks', role: 'group', 'aria-label': 'Emojis sugeridos' }, emojiBtns),
  h('div', { class: 'field' }, h('span', { class: 'label' }, 'Color')),
  h('div', { class: 'picks', role: 'group', 'aria-label': 'Colores' }, colorBtns),
  h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tipo'), kindSeg),
  errEl,
  h('div', { class: 'form-actions' },
    cat ? h('button', { class: 'btn btn-danger', type: 'button', onclick: () => removeCategory(cat, cats, close) }, 'Borrar') : null,
    h('button', { class: 'btn btn-primary grow', type: 'submit' }, 'Guardar')));

  close = openModal(form, { label: cat ? 'Editar categoría' : 'Nueva categoría' });
  paint();
  nameEl.focus();
}

// ---------- Borrado ----------

async function removeCategory(cat, cats, closeForm) {
  const others = cats.filter((c) => c.id !== cat.id);
  if (!others.length) {
    showSnackbar({ text: 'Tiene que quedar al menos una categoría.' });
    return;
  }
  let inUse = true;
  try {
    inUse = (await queryTransactions({ categoryId: cat.id, limit: 1 })).items.length > 0;
  } catch (e) { /* ante la duda, pedimos destino */ }

  if (!inUse) {
    try {
      await deleteCategory(cat.id, null);
      closeForm();
      showSnackbar({
        text: 'Categoría borrada',
        actionLabel: 'Deshacer',
        onAction: () => saveCategory(cat).catch(() => showSnackbar({ text: 'No se pudo deshacer.' })),
      });
      return;
    } catch (e) {
      /* puede estar en gastos fijos: seguimos al diálogo de reasignación */
    }
  }
  openReassign(cat, others, closeForm);
}

function openReassign(cat, others, closeForm) {
  let close = () => {};
  const sel = h('select', { class: 'input' }, ...others.map((c) => h('option', { value: c.id }, c.emoji + ' ' + c.name)));
  const errEl = h('p', { class: 'sheet-error', role: 'alert' });

  const confirm = async () => {
    try {
      await deleteCategory(cat.id, sel.value);
      closeForm(); // cierra también este diálogo (está encima)
      showSnackbar({ text: 'Categoría borrada. Pasamos sus movimientos a la que elegiste.' });
    } catch (e) {
      errEl.textContent = 'No se pudo borrar. Probá de nuevo.';
    }
  };

  const panel = h('div', { class: 'sheet' },
    h('h2', { class: 'sheet-title' }, 'Borrar "' + cat.name + '"'),
    h('p', null, 'Tiene movimientos. ¿A qué categoría los pasamos?'),
    h('div', { class: 'field' }, h('label', null, 'Pasar a', sel)),
    errEl,
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancelar'),
      h('button', { class: 'btn btn-danger grow', type: 'button', onclick: confirm }, 'Pasar y borrar')));
  close = openModal(panel, { label: 'Borrar categoría' });
  sel.focus();
}
