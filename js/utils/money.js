// Dinero: siempre enteros en centavos. Sin Intl ni floats.

// Monedas soportadas: código, símbolo para mostrar y nombre.
export const CURRENCIES = [
  { code: 'ARS', symbol: '$', name: 'Peso argentino' },
  { code: 'USD', symbol: 'US$', name: 'Dólar estadounidense' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
];

// Máximo de dígitos enteros en el teclado (10 dígitos * 100 sigue siendo entero seguro).
const MAX_INT_DIGITS = 10;

function symbolOf(currency) {
  const c = CURRENCIES.find((x) => x.code === currency);
  return c ? c.symbol : String(currency) + ' ';
}

// 5000000 -> "$50.000,00". Negativos: "-$50,00".
export function formatMoney(cents, currency = 'ARS') {
  const n = Math.round(Number(cents) || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  const units = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  const intStr = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + symbolOf(currency) + intStr + ',' + dec;
}

// Texto libre -> centavos, o null si no se entiende. Acepta "50.000,50", "50000,5", "$ 1.234", "12.5".
export function parseMoney(str) {
  if (typeof str !== 'string') return null;
  let s = str.replace(/US\$|[$€\s]/g, '');
  if (s === '' || s.startsWith('-')) return null;
  if (!/^[\d.,]+$/.test(s)) return null;

  let intPart;
  let decPart = '';
  if (s.includes(',')) {
    // La coma es el decimal; los puntos son miles.
    const parts = s.split(',');
    if (parts.length !== 2) return null;
    intPart = parts[0];
    decPart = parts[1];
    if (intPart !== '' && !/^\d+$/.test(intPart.replace(/\./g, ''))) return null;
    if (intPart.includes('.') && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null;
    intPart = intPart.replace(/\./g, '');
  } else if (s.includes('.')) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      intPart = s.replace(/\./g, ''); // solo miles
    } else if (/^\d*\.\d{1,2}$/.test(s)) {
      [intPart, decPart] = s.split('.'); // punto decimal (1 o 2 decimales)
    } else {
      return null;
    }
  } else {
    intPart = s;
  }
  if (intPart === '' && decPart === '') return null;
  if (!/^\d*$/.test(decPart) || decPart.length > 2) return null;
  if (intPart.replace(/^0+/, '').length > MAX_INT_DIGITS) return null;
  const units = intPart === '' ? 0 : Number(intPart);
  const dec = Number(decPart.padEnd(2, '0'));
  return units * 100 + dec;
}

// Teclado propio. buf es un string tipo "1234,5". key: '0'-'9', ',' o 'back'.
export function keypadPress(buf, key) {
  const b = typeof buf === 'string' ? buf : '';
  if (key === 'back') return b.slice(0, -1);
  if (key === ',') {
    if (b.includes(',')) return b;
    return (b === '' ? '0' : b) + ',';
  }
  if (typeof key !== 'string' || !/^[0-9]$/.test(key)) return b;
  const i = b.indexOf(',');
  if (i >= 0) {
    return b.length - i - 1 >= 2 ? b : b + key; // máx 2 decimales
  }
  if (b === '0') return key === '0' ? b : key; // sin ceros a la izquierda
  if (b.length >= MAX_INT_DIGITS) return b;
  return b + key;
}

// "1234,5" -> 123450. Buffer vacío -> 0.
export function keypadToCents(buf) {
  if (typeof buf !== 'string' || buf === '') return 0;
  const [intPart, decPart = ''] = buf.split(',');
  const units = intPart === '' ? 0 : Number(intPart);
  const dec = Number(decPart.slice(0, 2).padEnd(2, '0'));
  return units * 100 + dec;
}
