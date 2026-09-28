// Lógica pura del candado: ¿hay que pedir el PIN?

export const LOCK_THRESHOLD_MS = 60000;

// hasPin: hay PIN configurado. lastActiveAt: ms de la última vez que la app estuvo activa
// (null/undefined = recién abierta => bloquea). now: ms actuales.
// Bloquea si pasó MÁS de thresholdMs (justo el umbral no bloquea).
// Si lastActiveAt es futuro (reloj cambiado) no es confiable => bloquea.
export function shouldLock({ hasPin, lastActiveAt, now, thresholdMs = LOCK_THRESHOLD_MS } = {}) {
  if (!hasPin) return false;
  if (typeof lastActiveAt !== 'number' || !Number.isFinite(lastActiveAt)) return true;
  if (typeof now !== 'number' || !Number.isFinite(now)) return true;
  const elapsed = now - lastActiveAt;
  if (elapsed < 0) return true;
  return elapsed > thresholdMs;
}
