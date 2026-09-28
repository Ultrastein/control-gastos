// Lectura de texto de un recibo (puro, sin DOM): busca el total y la fecha.
// El texto viene del lector del navegador (TextDetector) cuando existe; si no, no se usa.
import { toISO, daysInMonth } from './dates.js';
import { parseAmountCents } from './quickAdd.js';

// Número de recibo -> centavos o null (mismas reglas que #/quick-add: "1.234,56", "1,234.56", "12.300").
export function parseReceiptNumber(raw) {
  const c = parseAmountCents(raw);
  return Number.isSafeInteger(c) && c > 0 ? c : null;
}

const NUM_RE = /\$?\s?\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\$?\s?\d+(?:[.,]\d{1,2})?/g;

function amountsIn(line) {
  return (line.match(NUM_RE) || []).map(parseReceiptNumber).filter((c) => c != null);
}

// Total del recibo en centavos o null. Prioriza la línea con "TOTAL" (no "subtotal");
// si la línea no tiene número, mira la siguiente. Si no hay "total", el importe más grande con decimales.
export function extractAmount(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].toLowerCase();
    if (!/\btotal\b/.test(l) || /sub\s*-?\s*total/.test(l)) continue;
    const here = amountsIn(lines[i].replace(/^[^\d$]*/, ''));
    if (here.length) return here[here.length - 1];
    if (lines[i + 1]) {
      const next = amountsIn(lines[i + 1]);
      if (next.length) return next[next.length - 1];
    }
  }
  // Sin "total": el mayor importe que tenga decimales (los números sueltos suelen ser códigos).
  let best = null;
  for (const l of lines) {
    for (const m of l.match(NUM_RE) || []) {
      if (!/[.,]\d{2}$/.test(m.trim())) continue;
      const c = parseReceiptNumber(m);
      if (c != null && (best == null || c > best)) best = c;
    }
  }
  return best;
}

// Primera fecha dd/mm/aaaa (o dd-mm-aa, dd.mm.aaaa) válida -> 'YYYY-MM-DD', o null.
export function extractDate(text) {
  const re = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || y < 2000 || y > 2100) continue;
    if (d > daysInMonth(y, mo)) continue;
    return toISO(y, mo, d);
  }
  return null;
}
