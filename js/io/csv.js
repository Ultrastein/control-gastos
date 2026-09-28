// Exportación a CSV
import { queryTransactions, listCategories } from '../db.js';

/**
 * Convierte transacciones a CSV UTF-8 con BOM
 * @param {Array} txs - transacciones
 * @param {Array} categories - categorías
 * @returns {string} CSV con BOM
 */
export function toCSV(txs, categories) {
  // Crear mapa de categorías por ID
  const catMap = {};
  categories.forEach((c) => {
    catMap[c.id] = c.name;
  });

  // Encabezados: Fecha;Tipo;Categoría;Monto;Moneda;Nota;paymentMethod;installmentNumber;totalInstallments;purchaseGroupId
  const rows = ['Fecha;Tipo;Categoría;Monto;Moneda;Nota;paymentMethod;installmentNumber;totalInstallments;purchaseGroupId'];

  // Agregar filas
  for (const tx of txs) {
    const date = tx.date; // YYYY-MM-DD
    const type = tx.type === 'expense' ? 'Gasto' : 'Ingreso';
    const categoryName = catMap[tx.categoryId] || '—';

    // Convertir centavos a decimal (entero / 100, con 2 decimales)
    const centsPart = tx.amount % 100;
    const majorPart = Math.floor(tx.amount / 100);
    const monto = `${majorPart},${String(centsPart).padStart(2, '0')}`;

    const moneda = tx.currency || 'ARS';
    const note = tx.note ? `"${tx.note.replace(/"/g, '""')}"` : '—';

    // Campos nuevos: movimientos viejos sin esos campos usan defaults
    const paymentMethod = tx.paymentMethod || 'efectivo';
    const installmentNumber = tx.installmentNumber ?? '';
    const totalInstallments = tx.totalInstallments ?? '';
    const purchaseGroupId = tx.purchaseGroupId ?? '';

    // Escapar campos con ; o saltos de línea
    const fields = [date, type, categoryName, monto, moneda, note, paymentMethod, installmentNumber, totalInstallments, purchaseGroupId];
    const escapedFields = fields.map((f) => {
      if (typeof f === 'string' && (f.includes(';') || f.includes('\n'))) {
        return `"${f.replace(/"/g, '""')}"`;
      }
      return f;
    });

    rows.push(escapedFields.join(';'));
  }

  // UTF-8 BOM + CSV
  const csv = rows.join('\n');
  const bom = '﻿'; // UTF-8 BOM
  return bom + csv;
}

/**
 * Exporta transacciones paginadas a CSV y descarga. Sin rango = todo el historial.
 * @param {{from?: string, to?: string}} [range] - fechas YYYY-MM-DD inclusive
 * @returns {Promise<void>}
 */
export async function exportCSV({ from, to } = {}) {
  try {
    const categories = await listCategories();

    // Leer todas las transacciones paginadas
    const allTxs = [];
    let after = null;
    const limit = 100;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await queryTransactions({ from, to, limit, after });
      if (!result.items || result.items.length === 0) {
        break;
      }
      allTxs.push(...result.items);
      if (!result.next) {
        break;
      }
      after = result.next;
    }

    const csv = toCSV(allTxs, categories);
    const blob = new Blob([csv], { type: 'text/csv; charset=utf-8' });

    // Generar nombre de archivo
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const filename = from && to ? `gastos-${from}_a_${to}.csv` : `gastos-${year}-${month}-${day}.csv`;

    // Descargar
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (err) {
    throw new Error(`Error al exportar CSV: ${err.message}`);
  }
}
