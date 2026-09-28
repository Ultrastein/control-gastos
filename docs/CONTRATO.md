# CONTRATO TÉCNICO

Los agentes leen ESTO y sus archivos. Todo es ES module. `async` = devuelve Promise. `ym` = 'YYYY-MM', `iso` = 'YYYY-MM-DD', `cents` = entero.

## Dueños
- **logic**: `js/utils/*`, `js/db.js`, `tests/*` · **ui**: `index.html`, `css/*`, `js/ui/*`, `js/app.js` · **io**: `manifest.webmanifest`, `sw.js`, `icons/*`, `js/io/*`, `js/dev/seed.js`.

## Datos (IndexedDB "gastos", versión = DB_VERSION, migraciones en onupgradeneeded)
- `transactions` (keyPath id): {id, type:'expense'|'income', amount>0, currency, categoryId, date, note, recurringId|null, recurringMonth|null, createdAt, updatedAt}. Índices: `date`, `categoryId`, `rec` único [recurringId, recurringMonth] (solo se indexan los que tienen recurringId; usar clave ausente, no null, en manuales).
- `categories`: {id, name, emoji, color, sortOrder, kind:'essential'|'flexible'}. Defaults: Comida, Transporte(e), Alquiler(e), Servicios(e), Salidas, Salud(e), Compras, Otros.
- `budgets`: {id, categoryId, monthlyLimit, currency}, índice único [categoryId, currency].
- `recurring`: {id, type, amount, currency, categoryId, dayOfMonth, note, active, lastGeneratedMonth}.
- `settings` (keyPath key): {key, value}. Claves: theme, defaultCurrency, pinHash, pinSalt, biometricCredentialId, lastBackupAt.
- `dismissed_insights`: {id, insightKey, month}. IDs = `crypto.randomUUID()`.

## js/utils (puros, sin DOM)
- `money.js`: `formatMoney(cents, currency='ARS')`→"$50.000,00" (USD "US$", EUR "€"); `parseMoney(str)`→cents|null; `keypadPress(buf, key)`→buf (key: '0'-'9', ',', 'back'; máx 2 decimales); `keypadToCents(buf)`→cents; `CURRENCIES`.
- `dates.js`: `toISO(y,m,d)`, `parseISO(iso)`→{y,m,d}, `todayISO(now=new Date())`, `daysInMonth(y,m)`, `monthKey(iso)`, `addMonths(ym,n)`, `addDays(iso,n)`, `dayOfWeek(iso)` (0=dom), `monthRange(ym)`→{from,to}, `clampDay(y,m,d)`, `monthLabel(ym)`→"Septiembre 2026", `dayLabel(iso)`.
- `recurring.js`: `dueDate(rec, ym)`→iso (día clamp a fin de mes), `pendingMonths(rec, currentYm)`→ym[] (desde lastGeneratedMonth+1 hasta currentYm, solo si active), `buildTx(rec, ym, now)`→transaction.
- `pin.js`: `newSalt()`, `hashPin(pin, salt)`→hex (PBKDF2 SHA-256, ≥100000 it.), `verifyPin(pin, salt, hash)`.
- `analysisConfig.js`: `CONFIG` con todos los umbrales (mín. 10 mov./14 días, p25, 8 hormigas, 2,5× mediana, 5 hist., 20%, 3 meses, día 7, 2 meses, 10% desc., máx 5, ±1 día, 80%/100%).
- `analysis.js`: `analyze(input, config=CONFIG)`→`{status:'ok'|'insufficient', currency, radiography, trends[], projection|null, insights[≤5], duplicates[], fixedWeight, weekly|null, budgets[]}`; `simulate(input, catId, pct)`→`{monthly, yearly, newBalance, newSavingsRate|null}`.
  - `input` = {month, today, currency, firstDate, totalCount, monthly:{[ym]:{income, expense, byCat:{[catId]:{total,count}}, byDow:[7 totales]}}, amounts:{all:cents[], byCat:{[catId]:cents[]}}, monthTxs:[tx del mes], categories, budgets, recurring}. Una moneda por llamada.
  - `insight` = {key, type, catId|null, text, evidence:{...números}, savingsMonthly, savingsYearly, action:{kind:'review-duplicates'|'apply-budget'|'open-simulator'|'none', ...}}. Orden: savingsMonthly desc. Nunca sobre categorías `essential`.

## js/db.js (todas async salvo `dbEvents`)
`openDB()`; `dbEvents` (EventTarget, emite 'change' tras cada escritura).
- Movs: `addTransaction(t)`, `updateTransaction(t)`, `deleteTransaction(id)`→tx borrada, `restoreTransaction(tx)` (Deshacer), `getTransaction(id)`, `queryTransactions({from,to,categoryId,type,text,limit,after})`→{items,next} (cursor sobre índice `date`, orden desc, paginado), `getMonthAgg(ym)`→{[currency]:{income,expense,byCat:{[catId]:cents}}}.
- Categorías: `listCategories()`, `saveCategory(c)`, `deleteCategory(id, reassignToId)` (una transacción), `reorderCategories(ids)`.
- Presupuestos: `listBudgets()`, `saveBudget(b)`, `deleteBudget(id)`. Fijos: `listRecurring()`, `saveRecurring(r)`, `deleteRecurring(id)`, `generateRecurring(todayISO)`→cantidad creada (UNA transacción, respeta índice `rec`, ConstraintError = ya existe = ignorar).
- Ajustes: `getSetting(key, def)`, `setSetting(key, value)`. Insights: `dismissInsight(key, month)`, `listDismissed(month)`.
- Análisis: `getAnalysisInput(ym, currency)` (agrega con cursores por mes/categoría, no carga todo).
- Backup: `exportAll()`→{schemaVersion, exportedAt, stores:{...}}, `importAll(dump)` (valida y reemplaza en una sola transacción). Primer uso: siembra categorías default.

## Rutas (hash) y pantallas (`js/ui/`)
`#/resumen` (default), `#/historial`, `#/presupuestos`, `#/ajustes`, `#/analisis?m=YYYY-MM`, `#/dev-seed` (solo localhost).
Cada pantalla: `export function render(container, params)`→ función de limpieza opcional. Se re-renderiza al evento `dbEvents 'change'`.
UI compartida: `dom.js` `h(tag, props, ...hijos)` (solo textContent), `router.js` `registerRoute(path, fn)`, `navigate(hash)`; `modal.js` `openModal(el)`→`close()` (pushState; popstate cierra el tope); `snackbar.js` `showSnackbar({text, actionLabel, onAction, ms=5000})`; `keypad.js`, `sheet.js` (carga rápida), `charts.js` (`donut(data)`, `bars(data)`→SVG).

## Conexión de módulos
`app.js` → `openDB()` → `generateRecurring(todayISO())` → router → pantalla. Pantallas solo hablan con `db.js` y `utils/`; `io/` lo llama Ajustes. SW: `sw.js` define `VERSION` y `ASSETS[]`; escucha `{type:'SKIP_WAITING'}`; `app.js` muestra snackbar "Hay una versión nueva. [Actualizar]" y recién al tocar manda SKIP_WAITING y recarga en `controllerchange`.
`io/`: `backup.js` (`exportBackup()`, `importBackup(file)`, `validateBackup(obj)`), `csv.js` (`toCSV(txs, categories)`, `exportCSV()`), `biometric.js` (`isAvailable()`, `register()`, `authenticate()`). `dev/seed.js`: `seedDemo()`.

## Fase 6: medios de pago, cuotas y #/quick-add
- **transactions** suma: `paymentMethod` ('efectivo'|'debito'|'mp'|'credito', default 'efectivo'), `installmentNumber` int|null, `totalInstallments` int|null, `purchaseGroupId` string|null, `purchaseTotal` cents|null (solo en la cuota 1, monto original). Índice `purchaseGroupId` (solo los que lo tienen; ausente, no null, en el resto). DB_VERSION=2: migración agrega el índice y pone `paymentMethod:'efectivo'` a lo existente. settings suma `lastPaymentMethod`. Solo etiquetas: nada de datos reales de tarjeta.
- **dump** (SCHEMA_VERSION 2): acepta v1 (rellena defaults) y v2; valida enums/enteros de los campos nuevos.
- `utils/installments.js`: `MAX_INSTALLMENTS=60`, `splitAmount(total, n)`→cents[] (floor(total/n) en las primeras n-1, resto exacto en la última; suma == total), `buildInstallments(base, n, groupId, now)`→tx[] (una por mes desde el mes de la compra, `clampDay` para fin de mes, cuota 1 lleva `purchaseTotal`), `normalizeInstallments(v)`→1..60.
- `db.js`: `addInstallmentPurchase(base, n)`→tx[] (UNA transacción; n=1 = movimiento común), `updateInstallments(tx, scope:'one'|'rest')` ('rest' = esa cuota y las siguientes del grupo; campos categoría/nota/medio/monto por cuota/fecha de la primera se corre en meses), `deleteInstallments(id, scope)`→tx[] borradas, `restoreTransactions(txs)` (Deshacer en bloque), `listInstallmentGroups()`→[{groupId, categoryId, note, currency, count, paid, remainingCents, endMonth, purchaseTotal}] (solo activos = con cuotas futuras a hoy).
- `utils/quickAdd.js`: `parseQuickAdd(search, categories)`→`{complete:boolean, draft:{type, amount(cents|null), categoryId|null, method, installments, note}}` (cat sin tildes e insensible a mayúsculas; amount con coma o punto → centavos; method default efectivo; installments solo si credito).
- **Análisis**: `input.installments` = listInstallmentGroups() de la moneda; `analyze` agrega `fixedWeight.installments[]` ({groupId, catId, note, remaining, endMonth, count, paid}).
- **CSV**: 4 columnas al final: paymentMethod, installmentNumber, totalInstallments, purchaseGroupId.
- **UI**: fila de medio de pago en la hoja (default = lastPaymentMethod o efectivo), chips de cuotas 1/3/6/12 + "otra" (tope 60) solo con crédito; badge "N/Total" en Historial; editar/borrar una cuota pregunta "¿Solo esta cuota o todas las restantes?"; `#/quick-add?type&amount&cat&method&installments&note` en app.js: completo → guarda directo + snackbar con Deshacer; incompleto → abre la hoja pre-llenada; después `history.replaceState` limpia la query.

## Fase 7: recibos, límite general, reportes, recurrentes y atajos
- **DB_VERSION=3**: store `receipts` (keyPath `txId`): {txId, blob (JPEG ≤1280px), createdAt}. NO va al backup JSON (son Blobs). `db.js`: `saveReceipt(txId, blob)`, `getReceipt(txId)`→blob|null, `deleteReceipt(txId)`, `listReceiptIds()`, `pruneReceipts()`→n (borra fotos de movimientos inexistentes; `app.js` lo llama al abrir, así Deshacer recupera la foto). CSP suma `img-src 'self' blob:`.
- `utils/receipt.js`: `parseReceiptNumber(s)`, `extractAmount(text)` (línea TOTAL, no SUBTOTAL; si no, el mayor importe con decimales), `extractDate(text)`. `io/receipt.js`: `pickImage()`, `shrinkImage(file)`, `canReadText()`, `readReceipt(blob)` (TextDetector del navegador si existe; sin OCR propio ni librerías). Hoja: botón cámara; si lee el total y el monto está vacío lo completa.
- **Límite general**: setting `spendLimit` = {amount, currency} | null. `utils/budget.js`: `normalizeLimit(v)`, `allowance(limit, spent, daysLeft)`→{left, perDay}. Tarjeta en Presupuestos (editar/quitar con Deshacer) y en Resumen (solo mes actual). `notifyBudget` avisa 80%/100% del límite además del de la categoría. Nada de Notification API.
- **Reportes** `#/reportes?p=dia|semana|mes&d=YYYY-MM-DD` (`ui/reportes.js`, `css/reportes.css`): `utils/reports.js` `periodRange`, `shiftPeriod`, `periodLabel`, `buildReport(txs, {from,to,today}, prevTxs)`→{[cur]: {income, expense, balance, count, shares, byDay, avgPerDay, maxDay, topExpenses, byMethod, fixed, installments, variable, incomeChange, expenseChange, projection}}, `chartBuckets`. PDF = `window.print()` con `@media print`; CSV = `exportCSV({from, to})`.
- **Recurrentes** (`#/fijos`): `utils/recurring.js` `upcoming(recs, today, days)`, `monthlyCommitment(recs)`, `detectRecurring(txs, recs, today)` (misma nota+categoría en ≥3 de los últimos 4 meses, ±15%). "Hacer fijo" no duplica el mes en curso.
- **Atajos**: `utils/quickAdd.js` `buildQuickAddUrl(base, {type, amount, cat, method, note})`. Ajustes arma el enlace y explica Atajos de iPhone (widget de inicio y Centro de control). Manifest: shortcuts Nuevo gasto / Nuevo ingreso / Reportes. Una PWA no puede crear widgets nativos.

## Fase 8: app de iPhone (Capacitor 8)
- `capacitor.config.json` (appId `com.nicolaskane.gastos`, webDir `www`). `npm run ios:sync` = `tools/build-www.mjs` (copia index, manifest, sw, css, icons, js sin js/dev) + `cap sync ios`. Guía completa: `docs/IOS.md`.
- Nativo propio: plugin **WidgetBridge** (`update(textos)` → UserDefaults del App Group `group.com.nicolaskane.gastos` + recarga widgets; `takeLink()`→{hash?} enlace pendiente de arranque en frío). Esquema `gastos://<ruta>?<query>` → `#/<ruta>?<query>` (rutas: quick-add, reportes, resumen, historial, presupuestos).
- Web: `js/io/native.js` `isNative()`, `takeLink()`, `pushWidget()`; `utils/widgetData.js` `widgetPayload({today, currency, agg, limitRaw})`→{month, spent, balance, perDay, limitPct, currency, updated} (strings), `toNativeLink(url)`. `app.js`: sin SW en nativo; al arrancar toma el enlace y empuja el widget; después de cada 'change' (800 ms) actualiza el widget. Ajustes en nativo: explica widget/control y arma enlaces gastos:// para Atajos.
- Extensión `GastosWidgets` (iOS 17+): widget chico/mediano + `ControlWidgetButton` con `OpenURLIntent` (iOS 18). Se agrega como target a mano en Xcode (pasos en docs/IOS.md).

