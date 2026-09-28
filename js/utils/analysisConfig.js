// Umbrales del análisis (todo en un lugar, para ajustar sin tocar la lógica).

export const CONFIG = Object.freeze({
  minTransactions: 10,        // mínimo de movimientos para analizar
  minDaysOfUse: 14,           // mínimo de días desde el primer movimiento
  antPercentile: 25,          // "hormiga" = gasto por debajo de este percentil de todos los gastos
  antMinCount: 8,             // cantidad mínima de hormigas en el mes (por categoría flexible)
  antSavingsRatio: 0.5,       // ahorro estimado = mitad del total hormiga
  unusualFactor: 2.5,         // inusual = más de 2,5 veces la mediana de su categoría
  unusualMinHistory: 5,       // movimientos históricos mínimos en la categoría
  aboveAvgPct: 20,            // marca si supera el promedio en más de 20%
  avgMonths: 3,               // meses previos para el promedio
  streakMonths: 3,            // meses seguidos al alza
  projectionMinDay: 7,        // día del mes desde el cual se proyecta
  weeklyMinMonths: 2,         // meses de datos para el patrón semanal
  budgetDiscountPct: 10,      // descuento sobre el promedio en el tope sugerido
  maxInsights: 5,             // máximo de recomendaciones
  duplicateDayWindow: 1,      // ±1 día para duplicados
  topCategories: 3,           // categorías en la radiografía
  budgetWarnPct: 80,          // aviso de presupuesto
  budgetOverPct: 100,         // presupuesto superado
});
