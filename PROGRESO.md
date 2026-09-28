# PROGRESO

**Fase actual:** 8 terminada del lado Windows (app de iPhone con Capacitor: proyecto Xcode, puente, widget y control). 138 tests verdes. Falta compilar en una Mac (docs/IOS.md).

## Hecho
- Fase 0: estructura de carpetas, package.json, CLAUDE.md, docs/CONTRATO.md, 4 agentes en .claude/agents/.
- Fase 1: money/dates + tests, db.js (movs, categorías, ajustes, getMonthAgg; resto lanza 'pendiente fase N'), shell/router/modal/snackbar, carga rápida con teclado propio, historial, categorías, stubs de resumen/presupuestos/ajustes. Servidor local: `.claude/launch.json` (python http.server :8080).
- Notas F1: queryTransactions after/next = {date,id}; etiquetas de la barra inferior a 13px (12+ chars no entran a 360px); reordenar categorías con flechas; SW y manifest todavía no existen (F5).
- Fase 2: utils/summary.js (+tests), ui/charts.js (donut, bars), Resumen con selector de mes (#/resumen?m=), tarjeta por moneda, ± % vs mes anterior, dona + lista (tocar fila filtra Historial).
- Notas F2: filtro de Historial desde Resumen no distingue moneda; charts.js y css/resumen.css al precache en F5.
- Fase 3: utils/recurring.js y budget.js (+tests), db.js (budgets, recurring, generateRecurring en UNA transacción), Presupuestos con barras 80/100% y aviso en snackbar al guardar, Gastos fijos (#/fijos, desde Ajustes), app.js genera fijos al abrir.
- Notas F3: generateRecurring no crea un mes cuyo día aún no llegó (sin fechas futuras); editar un gasto no dispara aviso de presupuesto; snackbar puede tapar el pie de una hoja; falta probar unicidad con 2 pestañas a mano.
- Fase 4: analysisConfig/analysis.js + getAnalysisInput/dismiss (+tests, 5.000 movs < 300 ms), Análisis (#/analisis) con recomendaciones, simulador y tarjeta en Resumen, seed.js (#/dev-seed solo localhost; anomalías en el mes actual).
- Notas F4: al precache van js/ui/analisis.js, css/analisis.css, css/resumen.css, css/presupuestos.css, js/ui/{charts,fijos}.js; icons/icon-192.png y manifest dan 404 hasta F5.
- Fase 5: pin/lock/dumpValidation + exportAll/importAll, manifest, sw.js (VERSION 1.0.1), íconos PNG (tools/make-icons.mjs), backup, CSV, biometric, pantalla de bloqueo, Ajustes completo, registro del SW con aviso de versión nueva.
- Notas F5: sin probar la huella/Face ID ni el aviso de versión nueva en navegador; Lighthouse pendiente. Al agregar archivos: sumarlos a ASSETS de sw.js y subir VERSION.
- Fase 7: DB v3 (store receipts), foto de recibo en la hoja + lectura del total con TextDetector si el navegador lo trae, 📎 en Historial; límite general del mes (Presupuestos + Resumen + aviso 80/100%); #/reportes día/semana/mes con información avanzada, PDF (imprimir) y CSV del período; fijos con compromiso mensual, próximos 30 días y "se repiten todos los meses" → Hacer fijo; Ajustes: armador de enlaces para Atajos (widget de inicio y Centro de control de iPhone); manifest con 3 accesos directos. sw.js VERSION 1.1.0.
- Notas F7: la lectura automática del recibo solo anda donde existe TextDetector (algunos Chrome); en el resto se adjunta la foto y el monto se carga a mano. En iPhone el atajo abre Safari, que guarda datos aparte de la app instalada. Los recibos no viajan en el backup JSON. PDF sin probar en iPhone real.
- Fase 8: Capacitor 8 (devDependencies), ios/ con SPM, GastosBridge.swift (plugin WidgetBridge + enlaces gastos://), SceneDelegate con enlaces en frío y en caliente, App Group en entitlements, URL scheme y permisos de cámara/fotos en Info.plist, GastosWidgets.swift (widget chico/mediano + control iOS 18), js/io/native.js + utils/widgetData.js (+test), Ajustes adaptado en nativo, ícono 1024. sw.js VERSION 1.2.0.
- Notas F8: el Swift NO se compiló (Windows); el target de widgets se crea a mano en Xcode. El ícono es un placeholder liso. `if #available` en WidgetBundle: si Xcode se queja, subir el mínimo de GastosWidgets a iOS 18.
- Fase 6: medios de pago y cuotas (DB v2, installments.js, quickAdd.js), badge N/Total, editar/borrar 'solo esta o restantes', #/quick-add, CSV +4 columnas, cuotas activas en Análisis. sw.js VERSION 1.0.3.

## Pendiente
- En una Mac: compilar ios/, agregar target GastosWidgets, probar widget, control del Centro de control y enlaces gastos:// en frío y en caliente.
- Probar a mano: recibo con cámara en celular real, imprimir/guardar PDF en iPhone y Android, atajo en widget y Centro de control (iOS 18), huella/Face ID, aviso de versión nueva del SW, migración v1→v2 con datos reales, 2 pestañas a la vez.
- Publicar (GitHub Pages/Netlify/Cloudflare) y probar en iPhone/Android reales.

## Notas
- Repo git raíz es C:/Users/nicol. Al agregar archivos: sumarlos a ASSETS de sw.js y subir VERSION.
- Decisiones ambiguas quedan como comentarios en el código.
