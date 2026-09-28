// Puente con la app de iPhone (Capacitor). En el navegador todo es no-op.
// Sin @capacitor/core en runtime: se usa window.Capacitor, que inyecta la app nativa (ios/App/App/GastosBridge.swift).
import { getMonthAgg, getSetting } from '../db.js';
import { todayISO, monthKey } from '../utils/dates.js';
import { widgetPayload } from '../utils/widgetData.js';

function cap() {
  const c = globalThis.Capacitor;
  return c && typeof c.isNativePlatform === 'function' && c.isNativePlatform() ? c : null;
}

export const isNative = () => !!cap();

function call(method, data = {}) {
  const c = cap();
  if (!c || typeof c.nativePromise !== 'function') return Promise.resolve(null);
  return c.nativePromise('WidgetBridge', method, data);
}

// Enlace gastos:// con el que se abrió la app en frío (widget / Centro de control). null si no hay.
export async function takeLink() {
  try {
    const res = await call('takeLink');
    return res && typeof res.hash === 'string' ? res.hash : null;
  } catch (e) {
    return null;
  }
}

// Manda al widget lo gastado este mes, el saldo y cuánto queda por día (si hay límite).
export async function pushWidget() {
  if (!isNative()) return;
  try {
    const today = todayISO();
    const [agg, currency, limitRaw] = await Promise.all([
      getMonthAgg(monthKey(today)), getSetting('defaultCurrency', 'ARS'), getSetting('spendLimit', null),
    ]);
    await call('update', widgetPayload({ today, currency, agg, limitRaw }));
  } catch (e) { /* el widget queda con los datos anteriores */ }
}
