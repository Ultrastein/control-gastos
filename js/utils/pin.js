// PIN de 4 dígitos: sal aleatoria + PBKDF2-SHA256 (crypto.subtle, sin dependencias).
// Puro: usa globalThis.crypto (navegador y Node).

export const PBKDF2_ITERATIONS = 100000;
export const SALT_BYTES = 16;
const HASH_BITS = 256;

export const isValidPin = (pin) => typeof pin === 'string' && /^\d{4}$/.test(pin);

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function fromHex(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error('Sal inválida');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Sal nueva: 16 bytes aleatorios en hex (32 caracteres).
export function newSalt() {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

// Hash del PIN en hex (64 caracteres). Mismo pin + misma sal => mismo hash.
export async function hashPin(pin, salt) {
  if (!isValidPin(pin)) throw new Error('El PIN debe tener 4 dígitos');
  const saltBytes = fromHex(salt);
  const subtle = globalThis.crypto.subtle;
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key,
    HASH_BITS,
  );
  return toHex(new Uint8Array(bits));
}

// Comparación en tiempo constante (no corta en la primera diferencia).
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// true si el PIN coincide. PIN o sal inválidos => false (no lanza).
export async function verifyPin(pin, salt, hash) {
  if (!isValidPin(pin)) return false;
  let calc;
  try {
    calc = await hashPin(pin, salt);
  } catch {
    return false;
  }
  return constantTimeEqual(calc, typeof hash === 'string' ? hash.toLowerCase() : hash);
}
