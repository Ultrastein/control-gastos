// Fechas locales como strings 'YYYY-MM-DD' / 'YYYY-MM'. Nunca new Date("string").

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const pad2 = (n) => String(n).padStart(2, '0');

// m es 1-12.
export function toISO(y, m, d) {
  return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d);
}

export function parseISO(iso) {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!r) throw new Error('Fecha inválida: ' + iso);
  return { y: Number(r[1]), m: Number(r[2]), d: Number(r[3]) };
}

// Hoy en hora local del dispositivo.
export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // día 0 del mes siguiente
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

function parseYM(ym) {
  const r = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!r) throw new Error('Mes inválido: ' + ym);
  return { y: Number(r[1]), m: Number(r[2]) };
}

export function addMonths(ym, n) {
  const { y, m } = parseYM(ym);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  return String(ny).padStart(4, '0') + '-' + pad2((idx - ny * 12) + 1);
}

// Suma días con aritmética UTC (evita saltos por horario de verano).
export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// 0 = domingo.
export function dayOfWeek(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function monthRange(ym) {
  const { y, m } = parseYM(ym);
  return { from: toISO(y, m, 1), to: toISO(y, m, daysInMonth(y, m)) };
}

// Día válido para ese mes (ej. 31 en febrero -> 28/29).
export function clampDay(y, m, d) {
  return Math.min(Math.max(d, 1), daysInMonth(y, m));
}

export function monthLabel(ym) {
  const { y, m } = parseYM(ym);
  return MESES[m - 1] + ' ' + y;
}

// "Lun 21 sep"
export function dayLabel(iso) {
  const { m, d } = parseISO(iso);
  return DIAS[dayOfWeek(iso)] + ' ' + d + ' ' + MESES[m - 1].slice(0, 3).toLowerCase();
}
