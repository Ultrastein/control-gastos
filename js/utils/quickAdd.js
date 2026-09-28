// Parseo de #/quick-add?type&amount&cat&method&installments&note (puro, sin DOM ni window).
import { normalizeInstallments } from './installments.js';

const METHODS = ['efectivo', 'debito', 'mp', 'credito'];
const METHOD_ALIASES = { mercadopago: 'mp', 'mercado pago': 'mp', tarjeta: 'credito' };
const TYPE_ALIASES = { gasto: 'expense', egreso: 'expense', ingreso: 'income' };

// Minúsculas y sin tildes.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Monto de texto -> centavos enteros (sin floats) o null.
// - Sin separadores: "1250" -> $1.250,00.
// - Coma o punto con 1-2 dígitos detrás: decimal ("12,5" -> 1250; "12.50" -> 1250).
// - Ambos separadores: el ÚLTIMO es el decimal ("1.250,50" y "1,250.50" -> 125050).
// - CASO AMBIGUO: un solo separador con EXACTAMENTE 3 dígitos detrás ("1.250", "1,250"). Como los
//   centavos tienen 2 decimales, se lee como separador de miles: 1.250 -> $1.250,00 (convención es-AR).
//   Con parte entera "0" o de más de 3 dígitos ("0.250", "1250.500") es inválido -> null.
// - Separador repetido ("1.250.000") = todos miles, con grupos de 3.
export function parseAmountCents(raw) {
  const s = String(raw ?? '').replace(/[\s$]/g, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const seps = s.match(/[.,]/g) || [];
  let int;
  let frac = '';
  const thousands = (str, sep) => {
    const parts = str.split(sep);
    if (!/^\d{1,3}$/.test(parts[0]) || parts[0] === '0' && parts.length > 1) return null;
    if (!parts.slice(1).every((p) => /^\d{3}$/.test(p))) return null;
    return parts.join('');
  };
  if (!seps.length) {
    int = s;
  } else {
    const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
    const lastSep = s[last];
    const other = lastSep === ',' ? '.' : ',';
    const distinct = new Set(seps).size;
    if (distinct === 2) {
      // El último es decimal; el otro solo puede ser de miles.
      frac = s.slice(last + 1);
      if (!/^\d{1,2}$/.test(frac)) return null;
      int = thousands(s.slice(0, last), other);
    } else if (seps.length > 1) {
      int = thousands(s, lastSep); // repetido = miles
    } else {
      const after = s.slice(last + 1);
      const before = s.slice(0, last);
      if (/^\d{1,2}$/.test(after)) {
        int = before;
        frac = after;
      } else if (after.length === 3) {
        int = thousands(s, lastSep); // caso ambiguo: miles
      } else {
        return null;
      }
    }
    if (int == null) return null;
  }
  if (!/^\d+$/.test(int)) return null;
  const cents = Number(int) * 100 + Number(frac.padEnd(2, '0') || 0);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

// search = query string SIN '?'. Devuelve {complete, draft}. complete = hay monto y categoría.
// Reglas: type default 'expense'; method inválido/ausente = 'efectivo'; installments solo con
// 'credito' (1..60, cualquier otra cosa = 1); categoría por nombre (sin tildes ni mayúsculas) o por id.
export function parseQuickAdd(search, categories = []) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const rawType = fold(q.get('type'));
  const type = TYPE_ALIASES[rawType] || (rawType === 'income' ? 'income' : 'expense');

  const amount = q.has('amount') ? parseAmountCents(q.get('amount')) : null;

  const catKey = fold(q.get('cat'));
  let categoryId = null;
  if (catKey) {
    const byName = categories.find((c) => fold(c.name) === catKey);
    const byId = byName || categories.find((c) => String(c.id).toLowerCase() === catKey);
    categoryId = byId ? byId.id : null;
  }

  const rawMethod = fold(q.get('method'));
  const method = METHODS.includes(rawMethod) ? rawMethod : (METHOD_ALIASES[rawMethod] || 'efectivo');

  const installments = method === 'credito' ? normalizeInstallments(q.get('installments')) : 1;
  const note = (q.get('note') || '').trim().slice(0, 200);

  return {
    complete: amount != null && categoryId != null,
    draft: { type, amount, categoryId, method, installments, note },
  };
}

// Arma el enlace de #/quick-add para atajos y widgets. base = URL de la app sin hash.
// Solo agrega lo que viene: sin monto o sin categoría el enlace abre la hoja pre-llenada.
export function buildQuickAddUrl(base, { type, amount, cat, method, note } = {}) {
  const q = new URLSearchParams();
  if (type === 'income') q.set('type', 'ingreso');
  if (Number.isSafeInteger(amount) && amount > 0) {
    q.set('amount', Math.floor(amount / 100) + (amount % 100 ? ',' + String(amount % 100).padStart(2, '0') : ''));
  }
  if (cat) q.set('cat', cat);
  if (method && METHODS.includes(method) && method !== 'efectivo') q.set('method', method);
  if (note) q.set('note', note);
  const qs = q.toString();
  return String(base).replace(/#.*$/, '') + '#/quick-add' + (qs ? '?' + qs : '');
}
