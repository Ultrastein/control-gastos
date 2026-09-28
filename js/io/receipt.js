// Foto de recibos: elegir o sacar la foto, achicarla y (si el navegador sabe) leer el texto.
// Todo local: la imagen nunca sale del dispositivo. Sin librerías de OCR (prohibidas en runtime).
import { extractAmount, extractDate } from '../utils/receipt.js';

const MAX_SIDE = 1280;
const QUALITY = 0.7;

// Abre la cámara (en el celu) o el selector de archivos. Resuelve con el File o null si cancela.
export function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.hidden = true;
    let done = false;
    const finish = (f) => { if (done) return; done = true; input.remove(); resolve(f || null); };
    input.addEventListener('change', () => finish(input.files && input.files[0]));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

// Achica a MAX_SIDE px de lado y comprime a JPEG (una foto de 4 MB queda en ~150 KB).
// Si el navegador no puede, guarda el archivo original.
export async function shrinkImage(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const hgt = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
    if (bmp.close) bmp.close();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', QUALITY));
    return blob || file;
  } catch (e) {
    return file;
  }
}

// ¿El navegador trae lector de texto en imágenes? (Shape Detection API; hoy solo algunos Chrome).
export function canReadText() {
  return typeof globalThis.TextDetector === 'function';
}

// Rearma las filas del ticket: bloques con el centro a la misma altura van en la misma línea (izq. a der.).
function toLines(found) {
  const rows = [];
  const blocks = found.slice().sort((a, b) => a.boundingBox.y - b.boundingBox.y);
  for (const b of blocks) {
    const box = b.boundingBox;
    const mid = box.y + box.height / 2;
    const row = rows.find((r) => mid >= r.top && mid <= r.bottom);
    if (row) row.items.push(b);
    else rows.push({ top: box.y, bottom: box.y + box.height, items: [b] });
  }
  return rows
    .map((r) => r.items.sort((a, b) => a.boundingBox.x - b.boundingBox.x).map((b) => b.rawValue).join(' '))
    .join('\n');
}

// Lee el recibo: {amount: cents|null, date: iso|null}. Sin lector o si falla: ambos null.
export async function readReceipt(blob) {
  if (!canReadText()) return { amount: null, date: null };
  try {
    const bmp = await createImageBitmap(blob);
    const found = await new globalThis.TextDetector().detect(bmp);
    if (bmp.close) bmp.close();
    const text = toLines(found);
    return { amount: extractAmount(text), date: extractDate(text) };
  } catch (e) {
    return { amount: null, date: null };
  }
}
