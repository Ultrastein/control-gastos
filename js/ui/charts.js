// Gráficos SVG propios. data: [{label, value, color}]. Sin estilos inline: colores por atributo.
// Accesibles: role="img" + aria-label con el resumen de los datos.
import { svg } from './dom.js';

const FALLBACK = '#6B7280';
const round = (n) => Math.round(n * 100) / 100;

function summary(title, rows, total, format) {
  const parts = rows.map((r) => {
    const share = total ? ' (' + Math.round((r.value * 100) / total) + '%)' : '';
    return r.label + ': ' + format(r.value) + share;
  });
  return title + '. ' + (parts.length ? parts.join('; ') : 'Sin datos') + '.';
}

// Dona. opts: {title, center, format}
export function donut(data, opts = {}) {
  const format = opts.format || String;
  const rows = (data || []).filter((d) => d.value > 0);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const R = 44;
  const C = 2 * Math.PI * R;
  const root = svg('svg', {
    class: 'chart chart-donut',
    viewBox: '0 0 120 120',
    role: 'img',
    'aria-label': summary(opts.title || 'Gráfico de dona', rows, total, format),
  });
  root.append(svg('circle', { class: 'donut-track', cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 20 }));
  const gap = rows.length > 1 ? 1.2 : 0;
  let acc = 0;
  for (const r of rows) {
    const len = (r.value / total) * C;
    root.append(svg('circle', {
      cx: 60, cy: 60, r: R, fill: 'none', 'stroke-width': 20,
      stroke: r.color || FALLBACK,
      'stroke-dasharray': round(Math.max(len - gap, 0.1)) + ' ' + round(C),
      'stroke-dashoffset': -round(acc),
      transform: 'rotate(-90 60 60)',
    }));
    acc += len;
  }
  if (opts.center) {
    root.append(svg('text', { class: 'chart-center', x: 60, y: 64, 'text-anchor': 'middle', 'aria-hidden': 'true' }, opts.center));
  }
  return root;
}

// Barras verticales (hasta 12). opts: {title, format}
export function bars(data, opts = {}) {
  const format = opts.format || String;
  const rows = (data || []).slice(0, 12);
  const total = rows.reduce((s, r) => s + Math.max(r.value, 0), 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const slot = 40;
  const H = 100;
  const top = 6;
  const base = H - 20;
  const root = svg('svg', {
    class: 'chart chart-bars',
    viewBox: '0 0 ' + Math.max(rows.length, 1) * slot + ' ' + H,
    role: 'img',
    'aria-label': summary(opts.title || 'Gráfico de barras', rows, total, format),
  });
  root.append(svg('line', { class: 'bars-axis', x1: 0, x2: Math.max(rows.length, 1) * slot, y1: base, y2: base, 'stroke-width': 1 }));
  rows.forEach((r, i) => {
    const hgt = r.value > 0 ? Math.max(2, (r.value / max) * (base - top)) : 0;
    root.append(svg('rect', {
      x: i * slot + 8, y: round(base - hgt), width: slot - 16, height: round(hgt), rx: 3,
      fill: r.color || FALLBACK,
    }));
    const name = r.label.length > 7 ? r.label.slice(0, 6) + '…' : r.label;
    root.append(svg('text', { class: 'chart-label', x: i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle', 'aria-hidden': 'true' }, name));
  });
  return root;
}
