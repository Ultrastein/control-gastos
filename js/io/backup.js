// Backup y restauración de datos
import { exportAll, importAll } from '../db.js';
import { validateDump } from '../utils/dumpValidation.js';
import { toISO, parseISO } from '../utils/dates.js';
import { getSetting, setSetting } from '../db.js';

/**
 * Exporta todos los datos a JSON y los comparte/descarga
 * @returns {Promise<void>}
 */
export async function exportBackup() {
  try {
    const dump = await exportAll();
    const json = JSON.stringify(dump, null, 2);
    const blob = new Blob([json], { type: 'application/json' });

    // Generar nombre de archivo: gastos-backup-YYYY-MM-DD.json
    const now = new Date();
    const iso = toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const filename = `gastos-backup-${iso}.json`;

    // Intentar compartir con Web Share API
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], filename)] })) {
      try {
        await navigator.share({
          files: [new File([blob], filename)],
        });
        await setSetting('lastBackupAt', Date.now());
        return;
      } catch (err) {
        // Cancelar el menú de compartir no es un error ni genera backup.
        if (err && err.name === 'AbortError') return;
        // Cualquier otra falla (p. ej. sin gesto del usuario en escritorio): descarga directa.
      }
    }

    // Fallback: descargar con <a download>
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    await setSetting('lastBackupAt', Date.now());
  } catch (err) {
    throw new Error(`Error al exportar backup: ${err.message}`);
  }
}

/**
 * Importa un archivo de backup y valida (sin escribir)
 * @param {File} file
 * @returns {Promise<{ok: boolean, error?: string, summary?: any}>}
 */
export async function importBackup(file) {
  try {
    const text = await file.text();
    let dump;
    try {
      dump = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: 'El archivo no es JSON válido' };
    }

    const validation = validateDump(dump);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    // Crear resumen de datos
    const summary = {
      schemaVersion: dump.schemaVersion,
      exportedAt: dump.exportedAt,
      transactionsCount: dump.stores.transactions?.length || 0,
      categoriesCount: dump.stores.categories?.length || 0,
      budgetsCount: dump.stores.budgets?.length || 0,
      recurringCount: dump.stores.recurring?.length || 0,
    };

    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: `Error al leer el archivo: ${err.message}` };
  }
}

/**
 * Confirma e importa el backup (escribe en DB)
 * @param {any} dump
 * @returns {Promise<void>}
 */
export async function importConfirmed(dump) {
  try {
    // Un import no cuenta como backup: se conserva el último backup local.
    const last = await getSetting('lastBackupAt', null);
    await importAll(dump);
    if (last != null) await setSetting('lastBackupAt', last);
  } catch (err) {
    throw new Error(`Error al importar backup: ${err.message}`);
  }
}

/**
 * Valida estructura de backup (alias de validateDump)
 * @param {any} obj
 * @returns {{ok: boolean, error?: string}}
 */
export function validateBackup(obj) {
  return validateDump(obj);
}
