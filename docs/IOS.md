# App de iPhone (Capacitor)

La misma web, empaquetada como app de iOS, con **widget de inicio** y **control del Centro de control** nativos.
El código web no cambia: `tools/build-www.mjs` la copia a `www/` y Capacitor la mete en `ios/`.

## Qué se necesita
- Una **Mac** con **Xcode 16** o más nuevo (desde Windows no se puede compilar para iPhone).
- Node 20+.
- Para probar en tu iPhone alcanza con tu Apple ID gratis (la app caduca a los 7 días).
  Para que no caduque o para subirla al App Store: **Apple Developer Program** (99 USD por año).

## 1. Abrir el proyecto
```bash
npm install
npm run ios:sync      # copia la web a www/ y la sincroniza con ios/
npm run ios:open      # abre ios/App/App.xcodeproj en Xcode
```
Cada vez que cambies algo de la web, volvé a correr `npm run ios:sync`.

## 2. Firma y App Group de la app
1. En Xcode, target **App** → *Signing & Capabilities* → elegí tu **Team**.
2. Si `com.nicolaskane.gastos` ya está tomado, cambiá el Bundle Identifier (y el App Group en los 3 lugares de abajo).
3. Revisá que en **App Groups** figure `group.com.nicolaskane.gastos` (sale de `App/App.entitlements`). Si aparece en rojo, tocá ↻ para registrarlo.

## 3. Agregar la extensión de widgets (una sola vez)
Xcode no deja crear el target desde la terminal, así que se hace a mano:
1. *File → New → Target… → Widget Extension*. Nombre: **GastosWidgets**. Destildá *Include Live Activity* y *Include Configuration App Intent*. Si Xcode pregunta, tildá *Include Control*. *Activate* el esquema.
2. Borrá los `.swift` que generó Xcode dentro de la carpeta `GastosWidgets` (*Move to Trash*).
3. Arrastrá `ios/App/GastosWidgets/GastosWidgets.swift` al grupo GastosWidgets, con **solo** el target GastosWidgets tildado.
4. Target GastosWidgets → *General* → **Minimum Deployments: iOS 17.0** (el control del Centro de control aparece recién en iOS 18).
5. Target GastosWidgets → *Signing & Capabilities* → mismo Team → **+ Capability → App Groups** → tildá `group.com.nicolaskane.gastos`.
   (O en *Build Settings → Code Signing Entitlements* poné `GastosWidgets/GastosWidgets.entitlements`.)

## 4. Correr en el iPhone
Conectá el iPhone, elegilo arriba en Xcode y tocá ▶. La primera vez: en el iPhone, *Ajustes → General → VPN y gestión de dispositivos* → confiar en tu cuenta de desarrollador.

- **Widget:** mantené apretada la pantalla de inicio → Editar → Agregar widget → Gastos.
- **Centro de control (iOS 18+):** abrí el Centro de control → mantené apretado → Agregar un control → Gastos → Nuevo gasto.
- Ajustes de la app también explica esto y arma enlaces `gastos://quick-add?...` para la app Atajos.

## Cómo funciona
- `ios/App/App/GastosBridge.swift`: registra el plugin propio **WidgetBridge** (`update` guarda textos para el widget en el App Group; `takeLink` entrega el enlace con el que se abrió la app) y traduce `gastos://quick-add?x` → `#/quick-add?x`.
- `ios/App/App/SceneDelegate.swift`: usa `GastosBridgeViewController` y le pasa los enlaces que llegan.
- `js/io/native.js`: del lado web; en el navegador no hace nada. Actualiza el widget después de cada cambio en la base.
- `ios/App/GastosWidgets/GastosWidgets.swift`: widget chico/mediano (gastado del mes, saldo, cuánto queda por día si hay límite) y control del Centro de control. Todo toque abre la app con un enlace `gastos://`.
- Los datos siguen viviendo solo en el iPhone (IndexedDB dentro de la app). El widget ve únicamente los textos que la app le pasa.

## App Store (opcional)
El ícono (`AppIcon-512@2x.png`, generado por `tools/make-icons.mjs`) es un placeholder de color liso: antes de publicar, reemplazalo por un diseño real **sin transparencia**. Después: *Product → Archive → Distribute App*. Te va a pedir textos, capturas y una política de privacidad; la app no recolecta datos.
