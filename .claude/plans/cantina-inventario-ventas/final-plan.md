# Plan final (v3): Sistema de inventario y ventas de la cantina del CADB

Club Atlético Deportivo Barreal (Barreal, San Juan). Esta es la revisión de `final-plan.v2.md` con las respuestas del usuario a las 5 preguntas abiertas de v2. Fecha: 2026-11-09. Es una **propuesta para el club**: todavía no se implementa en producción.

---

## 1. Resumen

Una web interna, estática y gratuita, pensada **para el teléfono** (alrededor del 99% del uso) y que también funciona en desktop. Reemplaza el lápiz y papel de la cantina y tiene dos sitios con las mismas credenciales:

- **Ventas** (`cadb-ventas.pages.dev`): caja, ingreso de compras, stock y consumo de insumos, y "mis ventas". **Funciona sin señal** y sincroniza después.
- **Admin** (`cadb-admin.pages.dev`): productos, precios, balance con PDF, historial, usuarios, permisos y ajustes. Necesita conexión.

Las piezas principales:

- **Stack:** Vue 3 + Vite + TypeScript, Pico CSS, `vite-plugin-pwa` (solo en el sitio ventas), Supabase Free (Postgres, Auth, RLS y 1 Edge Function), Cloudflare Pages y jsPDF, este último cargado bajo demanda solo en el balance. Costo $0.
- **Dispositivos:** cada vendedor usa **su propio teléfono** con **su propio usuario**. Se asume que **hay iPhones**: las limitaciones de iOS/Safari son requisitos de diseño y la prueba en un iPhone real es obligatoria (§3.8 y §3.11).
- **Permisos:** cada permiso es un **feature flag por rol** guardado en la tabla `role_permissions`. Tanto el servidor (RLS y RPC) como la UI consultan `has_permission('<clave>')`. La jerarquía de roles es **estructural** y no es un flag: el rol owner no se puede quitar desde la web, un admin no puede bajar a otro admin, y nadie puede cambiar su propio rol.
- **Trazabilidad:** hay un usuario por persona. Cada venta, anulación, ajuste, consumo, compra, cambio de precio, de ajustes y de usuario o permiso queda en `audit_log` con quién, cuándo, el motivo y sus **marcas** (por ejemplo, stock negativo, precio desactualizado, venta diferida o pago ajustado).
- **Ventas:** una venta tiene un medio de pago `efectivo`, `transferencia` o `mixto`. **Toda venta guarda `cash_amount` y `transfer_amount`**, que suman el total. En el pago mixto la UI completa sola el monto que falta.
- **Balance:** ingresos − egresos, separado por efectivo y transferencia (suma directa de los dos montos). Los egresos salen de lo que se gastó en cada compra. Los insumos (hielo, carbón) son **productos comunes por unidad con stock**, que no aparecen en la caja y cuyo uso se registra como "consumo". Se exporta en **PDF** (diario, semanal, mensual o personalizado) y en CSV.

### Cambios respecto de v2

1. **Un teléfono por vendedor (respuesta 1).** Se simplifica el manejo de teléfono compartido: ya no es un escenario previsto. Se mantienen como red de seguridad barata la retención de la cola por `user_id` y el bloqueo de cierre de sesión con pendientes.
2. **iOS pasa a ser de primera clase (respuesta 1).** Instalación guiada con "Compartir → Agregar a inicio", el login y el uso **dentro de la app instalada** (no comparte almacenamiento con Safari), sin depender de Background Sync (no existe en iOS), `storage.persist()` con detección, y una pantalla "Estado del teléfono". La prueba en iPhone real es obligatoria antes de la demo.
3. **Pago mixto en una única venta (respuesta 2).** `payment_method` admite `mixto`. Toda venta guarda `cash_amount` y `transfer_amount` con el invariante `cash + transfer = total` en el servidor. Si el total del servidor difiere del que vio el teléfono, se mantiene la transferencia (verificable con el banco), se ajusta el efectivo y se agrega la marca `pago_ajustado`.
4. **Anulación por `venta` solo el mismo día (respuesta 3).** El flag `sales.void_own` se reemplaza por `sales.void_own_same_day`: ventas propias del mismo día (zona San Juan) y dentro de un **límite configurable en minutos**. Fuera de eso, anula un admin (`sales.void_any`). Hay una tabla `settings` nueva, editable con el flag `settings.manage`. "Mis ventas" muestra solo el día.
5. **El arqueo sigue fuera del MVP (respuesta 4).** El usuario preguntó qué es el efectivo inicial. Queda como pregunta reformulada sobre si hay una caja física compartida (§4).
6. **Los insumos son productos por unidad con stock (respuesta 5).** Se elimina la idea de "insumo = solo gasto". `for_sale=false` queda solo como "no se muestra en la caja". Hay un movimiento nuevo `consumo` (RPC `consume_stock`, flag `stock.consume`) para registrar el uso, y alertas de stock mínimo también para los insumos.
7. Tests, fases, riesgos y demo actualizados con lo anterior.

<details>
<summary>Cambios de v1 a v2 (referencia)</summary>

1. El modo offline entra al MVP, limitado a la caja, con un único outbox. El papel queda como plan C.
2. Precio de la venta: el servidor acepta el precio mostrado solo si figura en `price_history` dentro de los 3 días previos a la venta.
3. Historial de precios obligatorio y permiso `prices.manage`.
4. Las compras registran su costo total y alimentan los egresos. Se eliminó `expenses`. "Varios" exige detalle.
5. Medios de pago con últimos 4 dígitos en transferencias.
6. Permisos como feature flags por rol, editables solo por el owner.
7. Ningún owner puede ser degradado ni desactivado desde la web.
8. `venta` puede anular sus ventas y ajustar stock con motivo; stock negativo con aviso y marca.
9. Todas las escrituras por RPC; tablas `audit_log`, `permissions`, `role_permissions` y `flags` en `sales`.
10. UX mobile-first, balance en PDF, demo para el club y migración a cuentas del club.
</details>

### Verificación de hechos (búsquedas web del árbitro, 2026-11-09)

| Afirmación | Resultado |
|---|---|
| Hechos verificados en v1 y v2 (grants de Supabase, pausa del Free, claves, sesiones de Supabase Auth: access token de 1 h y refresh token sin vencimiento; sin timeout por inactividad en Free) | Se mantienen. No se volvieron a verificar en esta ronda. |
| **iOS no implementa Background Sync** (ni Periodic Background Sync) en 2026 | **Verificado con varias fuentes secundarias coincidentes** (firt.dev, foro de Apple, guías 2026). Una fuente aislada dice lo contrario sin citar a Apple; se descarta. Consecuencia: la sincronización se dispara al abrir la app, con `online`, `visibilitychange`, un intervalo y un botón manual. Nunca se depende de `SyncManager`. |
| Desde Safari 17 (iOS 17), una web app en pantalla de inicio tiene la misma cuota que una pestaña, y `navigator.storage.persist()` se concede **por heurísticas**, por ejemplo si se abre como web app de pantalla de inicio. Un origen persistente queda exento de desalojo | **Verificado** (blog de WebKit, "Updates to Storage Policy"). |
| `persist()` puede devolver `false` igual (bug de WebKit 271401, 2024) | **Parcialmente verificado**: el bug existe y no encontré su resolución. Por eso el plan no depende de `persist()` y muestra el resultado en "Estado del teléfono". |
| El borrado del almacenamiento escrito por script tras unos 7 días sin interacción aplica a Safari y las apps en pantalla de inicio cuentan su propio uso | **Verificado con fuentes de 2020 a 2022** (v2). El post de WebKit de 2023 habla de desalojo "si el sitio no tuvo interacción por un tiempo", sin cifra. Mitigación sin cambios: instalar y sincronizar el mismo día. |
| La app de pantalla de inicio **no comparte almacenamiento** con Safari (sesión e IndexedDB separados) | **Parcialmente verificado** (bug de WebKit 181849, de larga data). Consecuencia: hay que iniciar sesión dentro de la app instalada. |
| En la UE Apple quitó las web apps standalone en iOS 17.4 | Mencionado por fuentes secundarias. **No aplica** (Argentina). |
| Screen Wake Lock: Safari 16.4+, pero roto en apps de pantalla de inicio hasta iOS 18.4 | **Parcialmente verificado** (bug de WebKit 254545, Progressier). Sigue siendo opcional, con detección. |
| PDF en iOS (`save()`, blob y Web Share con archivos) | Igual que en v2: parcialmente verificado. Hay que probar en un iPhone real. |

Fuentes: [WebKit – Updates to Storage Policy](https://webkit.org/?p=14403) · [WebKit bug 271401 (persist() false)](https://bugs.webkit.org/show_bug.cgi?id=271401) · [WebKit bug 181849 (pantalla de inicio sin almacenamiento compartido)](https://bugs.webkit.org/show_bug.cgi?id=181849) · [firt.dev – iOS PWA Compatibility](https://firt.dev/notes/pwa-ios/) · [Apple Developer Forums – Background Sync en iOS](https://developer.apple.com/forums/thread/694805) · [MagicBell – PWA iOS limitations](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) · [zylos.ai – PWAs 2026](https://zylos.ai/research/2026-02-04-progressive-web-apps) · [WebKit bug 254545 (Wake Lock en pantalla de inicio)](https://bugs.webkit.org/show_bug.cgi?id=254545) · [Progressier – Screen Wake Lock](https://progressier.com/pwa-capabilities/screen-wake-lock) · Fuentes de v2: [Supabase – User sessions](https://supabase.com/docs/guides/auth/sessions) · [web.dev – Web Share](https://web.dev/articles/web-share) · [WebKit bug 226509](https://bugs.webkit.org/show_bug.cgi?id=226509) · [Search Engine Land – 7-day cap](https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519)

---

## 2. Decisiones

Marcas: **=** se mantiene de v2, **Δ** cambia respecto de v2, **+** es nueva en v3.

| # | Tema | Decisión | Motivo |
|---|---|---|---|
| R1 = | Grants | `revoke all` en todas las tablas. `authenticated` solo tiene `select`. **Todas las escrituras pasan por RPC** `security definer`. | Un único camino de escritura con auditoría obligatoria. |
| R1b = | `EXECUTE` por defecto a `PUBLIC` | `revoke execute ... from public, anon` y `grant ... to authenticated` en cada función, excepto `ping()`. | Igual que antes. |
| R2 = | Precio de la venta | El cliente manda `shown_price`. El servidor lo acepta si estuvo vigente en `[t − 3 días, t]` según `price_history` (marca `precio_desactualizado` si no es el vigente en `t`). Si no, usa `P(t)` y marca `precio_distinto`. | Catálogo offline posiblemente viejo. |
| R3 = | Hora de la venta | `created_at` efectiva y `device_created_at` original. Ventana `[now−3 d, now+5 min]`, o 30 días con `sales.backdate`. Fuera de la ventana, `now()` con `fecha_corregida`. Más de 2 min de demora: `diferida`. | Sincronización tardía y carga desde papel. |
| R4 = | Owners | Ningún owner puede ser degradado ni desactivado desde la web. | Sin bajas de owner no puede quedar ninguno. |
| R5 = | Alta de usuario no atómica | Validar antes y rollback con `deleteUser` si falla. | Igual que antes. |
| R6 = | Ajustes de `venta` | `stock.adjust` es un flag que `venta` tiene por defecto, con motivo obligatorio. | Respuesta 7 de v1. |
| R7 = | La lógica real vive en SQL | El dominio TS es especificación y UX; las reglas se aplican en SQL. | Igual que antes. |
| R8 = | Módulos | 3 módulos (`inventory`, `sales`, `users`) y un solo `package.json`. | Proporción. |
| R9 = | Keep-alive y backup | `ping()` cada 3 días y dump semanal a un repo privado aparte. | Igual que antes. |
| R10 = | Claves | Publishable key en el frontend; secret key solo en la Edge Function y scripts locales. | Igual que antes. |
| R11 = | Hosting | Cloudflare Pages con 2 proyectos y `_headers` para que `sw.js` no se cachee. | Actualización del service worker. |
| R12 = | Sin señal | Offline de la caja en el MVP; papel como plan C. | Igual que v2. |
| R14 Δ | Balance | Ingresos − egresos; egresos desde las compras. **Ingresos por medio = `sum(cash_amount)` y `sum(transfer_amount)`.** | El pago mixto se reparte sin lógica especial. |
| R16 = | Detalles de `register_sale` | Bloqueo por `id` ordenado, cantidad de 1 a 100, inactivos aceptados con `producto_inactivo`, idempotente. | Igual que v2. |
| R17 = | Semana y "último partido" | Lunes a domingo, zona San Juan; "último partido" = último día con ventas. | Igual que antes. |
| R18 = | Renombrar, reactivar, clave propia | Nadie gestiona a un owner desde la web; solo cambia su propia clave. | Igual que v2. |
| S1–S3 = | Supabase, Cloudflare Pages, Pico CSS | Se mantienen. | Igual que antes. |
| S4 = | Stock negativo | Se permite con aviso y marca `stock_negativo`. | Igual que v2. |
| S5 = | Login | Usuario y contraseña con email sintético `<usuario>@cadb.local`. | Igual que antes. |
| U1 Δ | Costos y gastos | `add_stock` exige el **costo total** de la compra (puede ser 0). Los insumos son productos comunes con stock (ver V5). "Varios" sigue con `requires_note=true` para gastos que no son un producto. | Respuestas 1 de v1 y 5 de v2. |
| U2 Δ | Mobile-first y offline | La UI se diseña para el teléfono con una mano, la caja funciona offline, y **iOS es un objetivo de primera clase** (V1). | Respuesta 1. |
| U3 = | Usuarios | Un usuario por persona; `created_by = auth.uid()` en el servidor. | Trazabilidad. |
| U4 = | Owner | Se empieza con 1 owner; puede nombrar a otros; quitar un owner solo por SQL manual. | Igual que v2. |
| U5 = | Precios | `prices.manage` (por defecto solo admin) con `price_history`. | Igual que v2. |
| U6 Δ | Medios de pago | `efectivo`, `transferencia` o `mixto`. Toda venta guarda `cash_amount` y `transfer_amount`. `transfer_last4` (`^\d{4}$`) es obligatorio si `transfer_amount > 0`. | Respuesta 2 (V2). |
| U7 Δ | Anular | `venta` anula sus propias ventas **del mismo día** y dentro del límite configurable. Admin anula cualquiera (hasta 30 días). Siempre con motivo. | Respuesta 3 (V3). |
| U8 = | Stock negativo | Aviso antes de confirmar y marca en el servidor. | Igual que v2. |
| U9 = | Unidades | Todo por unidad entera, incluidos los insumos. Sin combos con receta. | Respuestas 9 de v1 y 5 de v2. |
| U10 = | Dominio | `*.pages.dev`. | Igual que v2. |
| U11 = | Cuentas | Cuentas personales del owner para la propuesta; proyecto nuevo en cuentas del club al adoptarse. | Igual que v2. |
| N2 = | PDF | jsPDF + `jspdf-autotable` con `import()` dinámico, entrega con Web Share, descarga o pestaña nueva. CSV. | Igual que v2. |
| N3 Δ | Feature flags | Lista fija en `permissions` y `role_permissions` para `venta` y `admin`, owner implícito. Claves nuevas: `sales.void_own_same_day` (reemplaza `sales.void_own`), `stock.consume` y `settings.manage`. | V3 y V5. |
| V1 + | Teléfonos | Cada vendedor usa su teléfono y su usuario. Se mantienen la retención por `user_id` y el bloqueo de logout con pendientes como red de seguridad (son baratas y evitan atribuir mal). **Se asume que hay iPhones**: instalación guiada en pantalla de inicio, login dentro de la app instalada, sincronización sin Background Sync, `persist()` con detección, pantalla "Estado del teléfono" y prueba obligatoria en iPhone real. | Respuesta 1. |
| V2 + | Pago mixto | Una sola venta con `payment_method='mixto'` y los dos montos, ambos > 0. El vendedor carga uno y la UI completa el otro (total − cargado). El cliente manda `transfer_amount` (y el efectivo se deduce); el servidor fija `cash_amount = total − transfer_amount`. Si el total del servidor difiere del del teléfono, la transferencia se respeta (es lo verificable con el banco) y se ajusta el efectivo, con marca `pago_ajustado`. Si la transferencia supera el nuevo total, se recorta al total, el efectivo queda en 0 y se guarda lo declarado en `audit_log`. | Respuesta 2. Guardar siempre los dos montos hace que el balance sea una suma simple y que el invariante valga para todas las ventas. |
| V3 + | Ventana de anulación | `sales.void_own_same_day` (por defecto en `venta`): venta propia, mismo día calendario en San Juan, y como máximo `void_own_window_minutes` minutos después de la venta (ajuste en `settings`; propuesta inicial 60; `0` = sin límite extra dentro del día). `sales.void_any` (admin): cualquier venta de los últimos 30 días. Offline: se evalúa con la hora en que se tocó "Anular" en el teléfono, acotada entre la hora de la venta y `now()`. | Respuesta 3. El límite es un valor, no un permiso; por eso va en `settings` y no en la matriz de flags. |
| V4 + | Settings | Tabla `settings(key, value)` con pocas claves fijas, editables desde el admin con `settings.manage` (por defecto admin; owner implícito). Cada cambio va a `audit_log`. | Hace falta un lugar para el límite de V3 sin hardcodearlo. Admin porque es quien resuelve las anulaciones fuera de plazo. |
| V5 + | Insumos | Hielo y carbón son productos comunes por unidad, con stock, `min_stock` y precio de costo vía compras. `for_sale=false` solo significa "no aparece en la caja" (no ensucia la grilla). El uso se registra con `consume_stock` (movimiento `consumo`, flag `stock.consume`, por defecto en `venta`, nota opcional). El consumo **no** es egreso: el egreso se cuenta al comprar (balance de caja). | Respuesta 5. Un movimiento propio distingue el uso normal de una corrección (`ajuste`) sin agregar lógica nueva. |
| V6 + | Arqueo | Fuera del MVP; queda como pregunta reformulada (§4). | Respuesta 4: el concepto no estaba claro y, con un teléfono por persona, depende de si hay una caja física compartida. |

---

## 3. Plan final

### 3.1 Alcance

**MVP:**
- **Productos:** nombre, precio, "se vende en caja" (`for_sale`), `requires_note`, stock mínimo, orden y activo. El historial de precios va en una tabla aparte. Los insumos (hielo, carbón) son productos con `for_sale=false`.
- **Ingreso de compras:** cantidad y **costo total**, para cualquier producto (a la venta o insumo) o para "Varios" con detalle. También se puede anular una compra cargada mal.
- **Consumo de insumos** ("usé 2 bolsas de hielo") y **ajuste de stock** (±, con motivo).
- **Caja táctil:** medio de pago efectivo, transferencia o mixto, aviso de stock negativo, **funcionamiento offline** con sincronización, y anulación con motivo el mismo día.
- **Balance:** ingresos − egresos por período, separado por efectivo y transferencia y por producto, con consumo de insumos e incidencias. Se exporta en **PDF** y CSV.
- **Historial** (auditoría) con filtros y marcas.
- **Usuarios** (uno por persona), roles `venta`, `admin` y `owner`, **permisos por rol editables** por el owner y **ajustes** (límite de anulación).
- **Dos sitios** (ventas como PWA y admin) con las mismas credenciales.
- **Demo** para presentar al club.

**Fuera de alcance:** AFIP y facturación, integración con Mercado Pago, combos con receta, venta por peso, varias cantinas, proveedores, app nativa, arqueo de caja (queda como pregunta), offline en el admin, Playwright y staging.

### 3.2 Stack

| Pieza | Elección | Costo |
|---|---|---|
| Frontend | Vue 3 + Vite + TypeScript, `vue-router`, composables (sin Pinia) | $0 |
| CSS | Pico CSS v2 más unas pocas reglas propias (barra inferior y grilla de la caja) | $0 |
| PWA | `vite-plugin-pwa` (generateSW), **solo** en el build de ventas | $0 |
| Almacenamiento local | IndexedDB mediante `idb-keyval` (muy chico) o un wrapper propio | $0 |
| PDF | `jspdf` + `jspdf-autotable`, cargados con `import()` dinámico | $0 |
| Backend | Supabase Free: Postgres, Auth, RLS y 1 Edge Function (`admin-users`) | $0 |
| Hosting | Cloudflare Pages (2 proyectos, `*.pages.dev`) | $0 |
| Tests | Vitest (con `fake-indexeddb` para el outbox) y pgTAP | $0 |
| CI y cron | GitHub Actions: tests, keep-alive y backup | $0 |

### 3.3 UX mobile-first

Se diseña primero para un teléfono de alrededor de 360 px de ancho, usado con una mano y al sol, **en Chrome Android y en Safari iOS** (app instalada). En desktop es el mismo layout centrado (máximo unos 960 px) y la grilla de la caja muestra más columnas.

**Criterios generales:**
- Los objetivos táctiles miden **48 px o más** y hay separación entre botones.
- Los inputs usan una fuente de 16 px o más, para que iOS no haga zoom.
- Se usa `inputmode="numeric"` en cantidades, montos y últimos 4 dígitos.
- Nada depende de hover.
- Se respetan las zonas seguras de iOS (`env(safe-area-inset-bottom)`) en la barra inferior y la barra de total.
- Alto contraste, sin animaciones innecesarias.
- Las acciones principales quedan en la zona del pulgar (abajo).
- Los textos son cortos y en voseo ("Cobrar", "Anular", "Guardada en el teléfono").

**Instalación (sitio ventas):**
- Si la app se abre en una pestaña del navegador (no instalada), se muestra un aviso fijo "Instalá la app para usarla sin señal".
- En **iOS** (Safari no muestra un aviso de instalación propio), el aviso explica con dibujos: **Compartir → Agregar a inicio → abrir desde el ícono**, y aclara que **hay que iniciar sesión dentro de la app instalada**, porque no comparte la sesión con Safari.
- En Android se usa el aviso de instalación del navegador cuando está disponible.
- La detección usa `display-mode: standalone` (y `navigator.standalone` en iOS).

**Sitio ventas:**
- **Barra inferior fija** con 4 pestañas: **Caja · Compras · Mis ventas · Más**. "Más" incluye stock e insumos, estado del teléfono, cambiar clave y cerrar sesión.
- **Encabezado** con un indicador de conexión: "En línea", "Sin señal · 3 ventas pendientes" o "Sincronizando…".

**Caja:**
- Grilla de botones grandes por producto (solo `for_sale=true`): 2 columnas en el teléfono y de 4 a 6 en desktop. Cada botón muestra nombre, precio y un contador si el producto ya está en la venta.
- Un toque suma 1. Los productos con stock ≤ 0 se ven con un borde de aviso, pero no se bloquean.
- **Barra de total fija** abajo: "3 ítems · $4.500 · [Cobrar]". Al tocar el total se abre una hoja inferior con el detalle y botones −/+ y quitar.
- **Cobrar** abre una hoja inferior:
  - Tres botones grandes: **Efectivo**, **Transferencia** y **Mixto**.
  - **Transferencia:** campo de 4 dígitos con teclado numérico.
  - **Efectivo:** campo opcional "Paga con" que solo calcula el vuelto y no se guarda.
  - **Mixto:** dos campos, "Transferido" y "Efectivo", más los 4 dígitos. Al escribir uno, el otro se completa con total − monto (por ejemplo, total $4.000 y transferido $3.000 → efectivo $1.000). El último campo editado manda. No se puede confirmar si alguno queda en 0 o si la suma no da el total (en ese caso conviene elegir efectivo o transferencia).
  - Si algún ítem queda en negativo, aparece el aviso "Sin stock cargado de X. ¿Vender igual?".
  - El último paso es **Confirmar**.
- Al confirmar, el estado aparece en un toast: "Guardada en el teléfono" y, cuando llega al servidor, "Sincronizada ✓". Si el servidor ajustó el pago, "Mis ventas" lo muestra ("Efectivo ajustado a $X por cambio de precio"). Si hay un error, ofrece reintentar.
- Opcional: la Screen Wake Lock API mantiene la pantalla encendida mientras la caja está abierta, con detección (en iOS funciona en apps instaladas desde 18.4).

**Compras:**
- Se elige el producto con un buscador y una lista. Los insumos aparecen en su propia sección y "Varios" al final.
- Se cargan la cantidad y el **total gastado**. El detalle es obligatorio en "Varios".
- Esta pantalla requiere conexión.

**Stock e insumos** ("Más → Stock"):
- Lista de productos con su stock; los que están bajo `min_stock` o en negativo, arriba y resaltados.
- En los insumos hay un botón **Usé** que abre "¿Cuántas?" (por defecto 1) y registra un consumo, con nota opcional.
- **Ajustar** (±, con motivo obligatorio) para correcciones. Requiere conexión.

**Mis ventas:**
- Lista las ventas del usuario **de hoy**, con su estado (pendiente, sincronizada o rechazada), su medio de pago y montos, y sus marcas.
- **Anular** (pide un motivo) aparece solo mientras la venta está dentro de la ventana (mismo día y límite de minutos, según el reloj del teléfono y el ajuste cacheado). Fuera de la ventana se muestra "Para anular, pedíselo a un admin".

**Estado del teléfono** ("Más → Estado"): app instalada sí/no, almacenamiento persistente sí/no (`storage.persist()`), operaciones pendientes y rechazadas, última sincronización y fecha del catálogo. Sirve para el checklist antes del partido y para diagnosticar.

**Sitio admin:** es mobile-first también.
- En el teléfono usa una barra inferior con **Balance · Productos · Historial · Más**. "Más" incluye usuarios, permisos, ajustes y cambiar clave.
- En desktop las mismas secciones van en una barra superior.
- Las tablas se convierten en tarjetas apiladas en pantallas angostas.
- En el historial de ventas, un admin con `sales.void_any` puede anular cualquier venta de los últimos 30 días.

### 3.4 Arquitectura

```
web/ (Vue)  ->  domain/ (TS puro: entidades, reglas, casos de uso, puertos)  <-  infra/ (Supabase, IndexedDB, jsPDF)
```

**Dominio:**
- Entidades: `Product`, `PriceChange`, `StockMovement`, `Sale`, `SaleItem`, `Payment` (`method`, `cash`, `transfer`, `last4`), `User`, `Role`, `Permission` (claves) y `Settings`.
- Reglas para la UX: totales, **autocompletado y validación del pago** (incluido mixto), rangos de fecha, **`canVoidOwn(sale, now, settings)`**, `canManageUser` y `canAssignRole` (para mostrar u ocultar botones), y la regla `canSync` del outbox.

**Puertos (6):**
- `ProductRepository`: list, create, update, setPrice, priceHistory, addStock(costo), consumeStock, adjustStock, voidEntry, listMovements.
- `SaleRepository`: register (idempotente), void(motivo), listMine, getBalance, listHistory.
- `SaleOutbox`: enqueue, pending, sync y onChange. Es un decorador de `SaleRepository` para register y void.
- `AuthService`: signIn, signOut, currentUser, myPermissions, onChange, changeOwnPassword.
- `UserAdminService`: list, create, setRole, setActive, resetPassword, rename, getRoleMatrix, setRolePermission, getSettings, setSetting.
- `Clock`.

**Resto:**
- **Infra:** adaptadores de Supabase, el `IdbSaleOutbox` y `CatalogCache` sobre IndexedDB, y `BalancePdf` (jsPDF, carga diferida).
- **Composition root:** `src/shared/container.ts`, con `provide/inject`.
- **Reemplazabilidad (honesta):** la UI y el dominio no dependen de Supabase, pero la aplicación real de las reglas (precios, pagos, stock, permisos, ventanas de anulación, jerarquía y auditoría) vive en SQL. Cambiar de BaaS implica nuevos adaptadores **y** reescribir esas reglas.
- **Desviación de `idea.md`:** los módulos cuelgan directo de `src/` (siguiendo el ejemplo `src/inventory/{web,domain,infra}`) y el servidor está en `src/server/`. La justificación es la misma de v1.

### 3.5 Estructura de carpetas

```
cadb/
├─ package.json                # único
├─ vite.config.ts              # root según --mode ventas|admin; PWA solo en ventas
├─ tsconfig.json
├─ public-ventas/_headers      # Cache-Control: no-cache para /sw.js e /index.html
├─ public-ventas/icons/        # íconos del manifest + apple-touch-icon (iOS)
├─ src/
│  ├─ inventory/{domain,infra,web}/   # productos, precios, compras, consumo, ajustes
│  ├─ sales/{domain,infra,web}/       # caja, pago, outbox, anulación, balance, PDF, historial
│  ├─ users/{domain,infra,web}/       # login, roles, permisos, usuarios, ajustes
│  ├─ shared/                         # container.ts, supabase-client.ts, money.ts, dates.ts, device.ts (instalada/persistente),
│  │                                  # componentes base (BottomNav, BottomSheet, Toast, InstallHint)
│  ├─ app/
│  │  ├─ ventas/  index.html, main.ts, router.ts, App.vue
│  │  └─ admin/   index.html, main.ts, router.ts, App.vue
│  └─ server/supabase/
│     ├─ config.toml
│     ├─ migrations/                  # tablas, grants, RLS, funciones, semilla de permissions/role_permissions/settings
│     ├─ functions/admin-users/index.ts
│     ├─ tests/                       # pgTAP
│     ├─ seed.sql                     # local
│     └─ seed-demo.sql                # productos y datos de ejemplo para la demo
├─ scripts/                           # create-owner.ts, create-demo-users.ts
└─ .github/workflows/                 # ci.yml, keepalive.yml, backup.yml
```

### 3.6 Modelo de datos (Postgres)

El dinero se guarda en pesos enteros (`integer`) y las sumas en `bigint`. Las fechas son `timestamptz` y los reportes usan la zona `America/Argentina/San_Juan`. El orden de creación es `profiles` → `permissions` → `role_permissions` → `settings` → `products` → `price_history` → `sales` → `sale_items` → `stock_movements` → `audit_log`.

```sql
profiles (
  id uuid pk references auth.users,
  username text unique not null,
  display_name text,
  role text not null check (role in ('venta','admin','owner')),
  active boolean not null default true,
  created_at timestamptz not null default now()
)

permissions (                       -- lista fija, la siembra la migración
  key text pk,                      -- p. ej. 'sales.void_any'
  description text not null
)

role_permissions (                  -- feature flags; owner NO tiene filas (tiene todo implícito)
  role text not null check (role in ('venta','admin')),
  permission text not null references permissions,
  primary key (role, permission)
)

settings (                          -- claves fijas, las siembra la migración
  key text pk,                      -- 'void_own_window_minutes'
  value jsonb not null,             -- p. ej. 60 (0 = sin límite extra dentro del día)
  updated_by uuid null references profiles,
  updated_at timestamptz not null default now()
)

products (
  id uuid pk default gen_random_uuid(),
  name text unique not null,
  price integer not null check (price >= 0),   -- cache del precio vigente (lo escribe set_price); 0 en insumos
  stock integer not null default 0,            -- cache: lo modifican solo las funciones
  for_sale boolean not null default true,      -- false = no aparece en caja (insumos: hielo, carbón; y "Varios")
  requires_note boolean not null default false,-- true en "Varios"
  min_stock integer null,                      -- aplica también a insumos
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

price_history (
  id bigint generated always as identity pk,
  product_id uuid not null references products,
  price integer not null check (price >= 0),
  valid_from timestamptz not null default now(),
  changed_by uuid not null references profiles
)  -- índice (product_id, valid_from desc); la fila inicial se crea con el producto

sales (
  id uuid pk,                                   -- generado en el cliente (idempotencia)
  total integer not null check (total >= 0),
  payment_method text not null check (payment_method in ('efectivo','transferencia','mixto')),
  cash_amount integer not null check (cash_amount >= 0),
  transfer_amount integer not null check (transfer_amount >= 0),
  transfer_last4 text null check (transfer_last4 ~ '^\d{4}$'),
  -- check: cash_amount + transfer_amount = total
  -- check: efectivo      -> transfer_amount = 0
  --        transferencia -> cash_amount = 0
  --        mixto         -> sin restricción extra (puede quedar un monto en 0 solo por pago_ajustado)
  -- check: (transfer_amount > 0) = (transfer_last4 is not null)
  status text not null default 'ok' check (status in ('ok','anulada')),
  flags text[] not null default '{}',           -- diferida, fecha_corregida, stock_negativo, precio_desactualizado,
                                                -- precio_distinto, producto_inactivo, pago_ajustado
  created_by uuid not null references profiles, -- siempre auth.uid()
  created_at timestamptz not null default now(),-- hora efectiva de la venta
  device_created_at timestamptz null,           -- hora informada por el dispositivo
  synced_at timestamptz not null default now(),
  voided_by uuid null references profiles,
  voided_at timestamptz null,                   -- hora efectiva de la anulación (ver §3.8)
  void_reason text null
)

sale_items (
  sale_id uuid references sales,
  product_id uuid references products,
  quantity integer not null check (quantity between 1 and 100),
  unit_price integer not null,                  -- precio aceptado por el servidor (ver §3.8)
  shown_price integer not null,                 -- precio que mostró el teléfono
  primary key (sale_id, product_id)
)

stock_movements (
  id uuid pk default gen_random_uuid(),
  product_id uuid not null references products,
  type text not null check (type in ('entrada','venta','consumo','ajuste','anulacion_venta','anulacion_entrada')),
  quantity integer not null,                    -- + entra / - sale ('consumo' siempre negativo)
  total_cost integer null,                      -- obligatorio en 'entrada' (>= 0); negativo en 'anulacion_entrada'
  sale_id uuid null references sales,
  reverses_id uuid null references stock_movements, -- en anulacion_entrada
  note text,                                    -- obligatoria en ajuste, anulaciones y productos requires_note; opcional en consumo
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
)

audit_log (
  id bigint generated always as identity pk,
  at timestamptz not null default now(),
  actor uuid not null references profiles,
  action text not null,        -- sale.register, sale.void, stock.add, stock.consume, stock.adjust, stock.void_entry,
                               -- product.create, product.update, price.set, setting.set, user.create, user.role,
                               -- user.active, user.password_reset, user.rename, role_permission.set
  entity_id text null,
  reason text null,
  flags text[] not null default '{}',
  detail jsonb not null default '{}'   -- p. ej. {precio_anterior, precio_nuevo}, {pago_declarado:{cash,transfer,total}}
)
```

**Notas:**
- **Invariante de stock:** `products.stock = sum(stock_movements.quantity)` por producto, y lo verifica un test. Aplica igual a productos a la venta e insumos.
- **Invariante de pago:** `cash_amount + transfer_amount = total` en toda venta, con `check` en la tabla.
- **Egresos:** `sum(total_cost)` de los movimientos `entrada` y `anulacion_entrada` del período. Es un balance de caja, no un margen: el consumo de insumos no suma egresos (ya se contó al comprar).
- **"Varios":** la semilla lo crea con `for_sale=false` y `requires_note=true`, para gastos que no son un producto (por ejemplo, detergente). La UI lo muestra último, con el texto "Usar solo si no existe un producto", y no lo lista en Stock.
- **Insumos:** la semilla de la demo crea "Hielo (bolsa)" y "Carbón (bolsa)" con `for_sale=false`, `price=0` y `min_stock`. Si un día el club vende hielo, basta con marcarlo `for_sale=true` y ponerle precio.

### 3.7 Autenticación, roles y permisos

**Login:**
- Supabase Auth con el email sintético `<usuario>@cadb.local`. La confirmación de email y el **sign-up público** están desactivados, y la contraseña tiene 8 caracteres como mínimo.
- Cada vendedor inicia sesión **en su propio teléfono**, y en iOS **dentro de la app instalada** (no comparte sesión con Safari). La sesión queda guardada en el dispositivo (configuración por defecto de supabase-js, con `autoRefreshToken`).
- **Cerrar sesión se bloquea** si el usuario tiene ventas pendientes de sincronizar (ver §3.8). Con un teléfono por persona casi nunca pasa, pero evita perder ventas si alguien cierra sesión por error.

**Permisos (feature flags):** la lista es fija y la crea la migración. Los valores por defecto son los de esta tabla.

| Clave | Qué habilita | venta | admin | owner |
|---|---|:-:|:-:|:-:|
| `sales.register` | Registrar ventas (incluye offline) | ✔ | ✔ | ✔ |
| `sales.void_own_same_day` | Anular **sus** ventas del mismo día, dentro del límite de minutos de `settings`, con motivo | ✔ | ✔ | ✔ |
| `sales.void_any` | Anular cualquier venta de los últimos 30 días, con motivo | ✘ | ✔ | ✔ |
| `sales.backdate` | Cargar ventas con fecha de hasta 30 días atrás (plan C, papel) | ✘ | ✔ | ✔ |
| `stock.add` | Ingresar compras (cantidad y costo total) | ✔ | ✔ | ✔ |
| `stock.consume` | Registrar consumo de insumos | ✔ | ✔ | ✔ |
| `stock.adjust` | Ajustar stock (±) y anular compras, con motivo | ✔ | ✔ | ✔ |
| `products.manage` | Crear, editar y activar o desactivar productos | ✘ | ✔ | ✔ |
| `prices.manage` | Cambiar precios | ✘ | ✔ | ✔ |
| `balance.view` | Ver el balance y exportar PDF y CSV | ✘ | ✔ | ✔ |
| `history.view` | Ver el historial completo (auditoría) | ✘ | ✔ | ✔ |
| `settings.manage` | Editar ajustes (límite de anulación) | ✘ | ✔ | ✔ |
| `admin.access` | Entrar al sitio admin | ✘ | ✔ | ✔ |
| `users.manage` | Crear usuarios, cambiar roles, desactivar, resetear claves y renombrar, siempre sujeto a la jerarquía | ✘ | ✔ | ✔ |

Owner tiene todo de forma **implícita**: no tiene filas en la tabla y sus permisos no se pueden editar. Por eso el owner nunca puede quitarse acceso por error.

**Reglas estructurales** (no son flags, viven en SQL):
1. **Rango:** `owner > admin > venta`.
2. **Gestionar a un usuario** (rol, activo, clave, nombre) requiere `users.manage` y que `rank(target) < rank(actor)`. **Nadie gestiona a un owner desde la web.**
3. **Asignar un rol `r`** (al crear el usuario o al cambiarle el rol) requiere `rank(r) ≤ rank(actor)`. Así, un admin puede crear o subir a otro admin (como pide `idea.md`) pero no bajarlo, y un owner puede nombrar a otro owner. La UI lo confirma con el texto "No se puede deshacer desde la web".
4. Nadie cambia su propio rol ni se desactiva a sí mismo. Cualquier usuario puede cambiar su propia clave.
5. **Quitar el rol owner o desactivar a un owner** se hace solo con SQL manual en el dashboard. El snippet está documentado en el README.
6. **Solo el owner** edita `role_permissions`, desde la pantalla "Permisos" del admin. Cada cambio queda en `audit_log`.
7. Un usuario inactivo no tiene ningún permiso.

**Aplicación en el servidor:**
1. **Grants:**
   - En todas las tablas: `revoke all ... from anon, authenticated`.
   - `grant select` a `authenticated` en las tablas de lectura.
   - Sin grants de escritura.
   - En cada función: `revoke execute ... from public, anon` y `grant execute ... to authenticated`. La excepción es `ping()`, que se concede a `anon`.
2. **Funciones auxiliares** (`security definer`, `stable` y `search_path` fijo):
   - `has_permission(p_key)`: true si el perfil está activo y su rol es owner o tiene la fila en `role_permissions`.
   - `my_permissions()`: devuelve un `text[]` para la UI.
   - `my_rank()`.
   - `setting_int(p_key)`.
3. **RLS:**
   - `products`, `price_history`, `permissions`, `role_permissions` y `settings`: `select` para cualquier usuario activo.
   - `sales`, `sale_items` y `stock_movements`: `select` completo con `history.view` o `balance.view`. Sin esos permisos, solo las ventas propias **del día** (San Juan) y sus ítems, y los movimientos necesarios para la pantalla de stock (el stock ya está en `products`).
   - `audit_log`: `select` solo con `history.view`.
   - `profiles`: el propio perfil, o todos si tiene `users.manage`.
4. **RPC** (`security definer`, `set search_path = ''`). Cada una valida el permiso al inicio, escribe en `audit_log` y fija `actor = auth.uid()`.
   - Productos y precios:
     - `create_product(...)`, con `products.manage`. Crea la fila inicial de `price_history`.
     - `update_product(...)`, con `products.manage`. No toca precio ni stock.
     - `set_price(p_product_id, p_price)`, con `prices.manage`.
   - Stock:
     - `add_stock(p_product_id, p_quantity > 0, p_total_cost >= 0, p_note)`, con `stock.add`. La nota es obligatoria si el producto tiene `requires_note`.
     - `consume_stock(p_product_id, p_quantity > 0, p_note)`, con `stock.consume`. Crea un movimiento `consumo` con `-qty`. Se permite en cualquier producto excepto "Varios"; si deja el stock negativo, lo marca `stock_negativo` en `audit_log`.
     - `adjust_stock(p_product_id, p_delta <> 0, p_note not null)`, con `stock.adjust`.
     - `void_stock_entry(p_movement_id, p_note not null)`, con `stock.adjust`. Genera el movimiento inverso con `-qty` y `-cost`, y es idempotente.
   - Ventas:
     - `register_sale(p_sale_id, p_items jsonb [{product_id, quantity, shown_price}], p_payment, p_transfer_amount, p_last4, p_device_created_at)`, con `sales.register`. Ver §3.8.
     - `void_sale(p_sale_id, p_reason not null, p_device_voided_at)`. Ver §3.8.
   - Reportes:
     - `balance_report(p_from date, p_to date)`, con `balance.view`.
   - Usuarios, permisos y ajustes:
     - `set_user_role(...)`, `set_user_active(...)` y `rename_user(...)`, según las reglas estructurales.
     - `can_manage_user(p_user_id)` y `can_assign_role(p_role)`, que usa la Edge Function.
     - `set_role_permission(p_role, p_key, p_enabled)`, solo para owner.
     - `set_setting(p_key, p_value)`, con `settings.manage`. Valida la clave y el valor (`void_own_window_minutes` entero entre 0 y 1440).
   - Mantenimiento:
     - `ping()`.
5. **Edge Function `admin-users`**, la única pieza que usa la secret key:
   - Valida al llamador con `auth.getUser(token)`.
   - Llama a `can_assign_role` o `can_manage_user` con el JWT del llamador.
   - `create`: crea el usuario en Auth e inserta el perfil, con rollback si falla.
   - `reset-password`.
   - `set-active`: llama a `set_user_active` y después aplica `ban_duration` en Auth, o lo quita.
   - Registra todo en `audit_log` a través de las RPC.
6. **Owner inicial:** se crea una vez con `npm run create-owner`, que usa la secret key desde una variable de entorno que nunca se commitea.

**Cliente:**
- Al iniciar sesión obtiene `my_permissions()` y `settings`, los cachea en IndexedDB (para que el router y la UI funcionen offline) y oculta lo que el usuario no puede hacer.
- El sitio admin exige `admin.access`. Si no lo tiene, muestra "No tenés permisos" y cierra la sesión.
- Ocultar elementos en la UI es solo UX: la autorización real la hace el servidor.

### 3.8 Ventas, pagos, stock, offline y sincronización

**Veredicto sobre "cargar offline y después sincronizar": sí, en el MVP, limitado a la caja** (vender y anular). Compras, consumos, ajustes de stock, precios, balance, `settings` y usuarios requieren conexión.

- **A favor:** uso 99% en el teléfono, en una cancha con señal incierta; la idempotencia por UUID ya estaba prevista; evita la doble carga desde papel.
- **En contra:** service worker viejo, desalojo del almacenamiento en iOS, catálogo con precios viejos, sesión revocada mientras está offline, depuración más difícil, y en iOS no hay sincronización en segundo plano.
- **Mitigación:** las reglas de abajo.

**Requisito operativo (checklist antes del partido, cada vendedor en su teléfono):**
1. La app está **instalada** en la pantalla de inicio y se abre desde el ícono (en iOS, obligatorio).
2. Se abre **con señal** y con su usuario: se cachean la sesión, los permisos, los ajustes y el catálogo. No se puede iniciar sesión por primera vez sin señal.
3. "Más → Estado" muestra 0 pendientes y el catálogo actualizado.
4. Al terminar la jornada, abrir la app con señal hasta ver "0 pendientes".

**iOS / Safari (se asume que hay iPhones):**
- **Instalación:** solo manual ("Compartir → Agregar a inicio"); la app muestra la guía (§3.3). Se incluyen `apple-touch-icon` y los meta de web app para que el ícono y el modo standalone queden bien.
- **Almacenamiento separado:** la app instalada no comparte sesión ni IndexedDB con Safari. Las ventas hechas en una pestaña de Safari quedan en Safari; por eso en una pestaña se muestra el aviso "Instalá la app" de forma insistente.
- **Sin Background Sync:** en iOS la cola **solo se vacía con la app abierta**. La sincronización se dispara al abrir la app, con `online`, con `visibilitychange` (al volver a primer plano), cada 30 s mientras está abierta y con el botón "Sincronizar ahora". En Android se usa el mismo mecanismo (no se agrega Background Sync: un solo camino es más simple de probar).
- **Persistencia:** se llama a `navigator.storage.persist()` al iniciar sesión. Safari 17+ lo concede por heurísticas (por ejemplo, app instalada), pero puede devolver `false`; el resultado se muestra en "Estado". El diseño no depende de él: la cola se vacía en horas y el desalojo por inactividad afecta a sitios sin uso por días.
- **PDF:** ver §3.9 (Web Share con archivo, con respaldo).

**Outbox único**, tanto online como offline:
1. Al confirmar, la venta se guarda en IndexedDB (`pending_ops`) con `{op:'sale', id: uuid, user_id, device_created_at, items[{product_id, quantity, shown_price}], payment, transfer_amount, last4, client_total}`. La UI muestra "Guardada en el teléfono".
2. Inmediatamente se intenta sincronizar. Con señal, la venta queda "Sincronizada" en alrededor de 1 segundo.
3. Una anulación también es una operación encolada (`{op:'void', sale_id, reason, device_voided_at}`), que sirve tanto para ventas pendientes como sincronizadas. El orden FIFO garantiza que la venta llegue antes que su anulación.
4. La sincronización se dispara como se describe arriba (apertura, `online`, `visibilitychange`, 30 s y botón).
5. **Atribución (red de seguridad):** una operación solo se sincroniza si `session.user.id == op.user_id`. El servidor siempre usa `auth.uid()`. Si por algún motivo otra persona inicia sesión en ese teléfono, las operaciones del primero quedan retenidas hasta que vuelva a entrar.
6. **Cerrar sesión** se bloquea si quedan operaciones pendientes del usuario: "Tenés N ventas sin sincronizar. Conectate antes de salir".
7. **Errores:**
   - De red o 5xx: se reintenta con backoff.
   - Si la sesión es inválida (el refresh fue rechazado): se pide iniciar sesión otra vez **con el mismo usuario**, sin perder lo que está en cola.
   - De negocio (usuario desactivado, falta de permiso, anulación fuera de plazo): la operación queda como **"Rechazada"**, visible y no se borra, con el mensaje "Avisale a un admin". Un admin puede volver a cargar la venta con `sales.backdate` o anularla con `sales.void_any`.
8. **Sesión offline:** el access token dura 1 h y el refresh token no vence. Sin señal no se llama a Auth. La app usa la sesión, los permisos, los ajustes y el catálogo cacheados. Al volver la señal, supabase-js renueva la sesión y recién entonces se sincroniza.

**Catálogo cacheado:** productos (con `price`, `stock` y `for_sale`), permisos y ajustes en IndexedDB. Se refrescan al abrir la app, después de cada sincronización y cada 5 minutos si hay señal. La caja muestra "Precios actualizados hace X" cuando el catálogo tiene más de 1 hora.

**`register_sale` en una transacción:**
1. **Idempotencia:** si `p_sale_id` ya existe, devuelve esa venta.
2. **Validación:**
   - Que tenga `sales.register`.
   - Que haya ítems, sin duplicados, con cantidades de 1 a 100.
   - Que los productos existan y tengan `for_sale = true`. Si alguno está inactivo, agrega la marca `producto_inactivo`.
   - Que el medio de pago sea válido; si hay transferencia (`transferencia` o `mixto`), que traiga los 4 dígitos; si es `mixto`, que `p_transfer_amount` esté entre 1 y `client_total − 1`.
3. **Hora efectiva `t`:**
   - Se toma `p_device_created_at` si está en `[now − 3 d, now + 5 min]`, o en `[now − 30 d, now + 5 min]` si tiene `sales.backdate`.
   - Si está fuera de la ventana, `t = now()` y se agrega la marca `fecha_corregida`.
   - Si `now() − t > 2 min`, se agrega la marca `diferida`.
4. **Bloqueo:** `select ... for update` de los productos, ordenados por id.
5. **Precio por ítem:**
   - Sea `P(t)` el precio vigente en `t` según `price_history`.
   - Si `shown_price = P(t)`, se usa ese precio.
   - Si no, pero `shown_price` estuvo vigente en algún momento de `[t − 3 d, t]`, se usa `shown_price` y se agrega `precio_desactualizado`.
   - Si no se cumple ninguna, se usa `P(t)` y se agrega `precio_distinto`.
   - El total lo calcula el servidor.
6. **Pago** (con el `total` del servidor):
   - `efectivo`: `cash = total`, `transfer = 0`.
   - `transferencia`: `cash = 0`, `transfer = total`.
   - `mixto`: `transfer = min(p_transfer_amount, total)` y `cash = total − transfer`.
   - Si `total ≠ client_total` (solo pasa con `precio_distinto`), o si hubo que recortar la transferencia, se agrega la marca `pago_ajustado` y `audit_log.detail` guarda lo declarado (`{cash, transfer, total}` del teléfono). En efectivo o transferencia simple, la diferencia ya queda explicada por `precio_distinto`; `pago_ajustado` se usa solo en mixto.
   - Criterio: la transferencia es lo que se puede verificar con el banco, así que se respeta, y la diferencia se absorbe en el efectivo, que es lo que el vendedor cuenta a mano.
7. **Escrituras:**
   - Inserta en `sales`, `sale_items` y `stock_movements` (`venta`, negativo).
   - `update products set stock = stock − qty`.
   - Si algún stock queda por debajo de 0, agrega `stock_negativo`.
   - Registra en `audit_log` con las mismas marcas.
8. **Respuesta:** `{id, total, cash_amount, transfer_amount, flags}`. El cliente lo muestra en "Mis ventas".

**`void_sale(p_sale_id, p_reason, p_device_voided_at)`:**
1. Idempotente: si la venta ya está anulada, devuelve ok.
2. **Hora efectiva de la anulación `v`:** `p_device_voided_at` acotada al rango `[sale.created_at, now()]` (si falta, `now()`).
3. **Autorización:**
   - Con `sales.void_any`: cualquier venta con `created_at > now() − 30 d`.
   - Si no, con `sales.void_own_same_day`: la venta es propia, `fecha_SJ(v) = fecha_SJ(sale.created_at)`, y si `void_own_window_minutes > 0`, `v − sale.created_at ≤` ese límite.
   - Si no cumple, error de negocio: "Fuera de plazo, pedile a un admin".
4. Una venta hecha y anulada offline se evalúa con las horas del teléfono, así que sincronizar tarde no la deja fuera de plazo. Si `now() − v > 2 min`, se agrega la marca `diferida` a la entrada de `audit_log`. El riesgo de un reloj manipulado se acepta: el historial muestra las dos horas y las anulaciones son visibles en el balance.
5. Pone `status = 'anulada'`, guarda `voided_by`, `voided_at = v` y `void_reason`, y crea los movimientos `anulacion_venta` (positivos). Nada se borra.

**Plan C (papel):** si un teléfono no se pudo preparar o se perdió la cola, se anota en papel (incluidos los pagos mixtos con sus dos montos). Después alguien con `sales.backdate` carga esas ventas desde la caja, eligiendo la fecha y hora del partido, y quedan con la marca `diferida`.

**Varias cajas a la vez:** el bloqueo ordenado evita deadlocks. El stock del teléfono es orientativo y el que vale es el del servidor.

### 3.9 Balance, historial y PDF

**`balance_report(p_from, p_to)`** (con `balance.view`, sumas en `bigint`, zona San Juan) devuelve:
- **Ingresos:** las ventas `ok` del período, con el total, la cantidad de ventas y el ticket promedio.
- **Por medio de pago:** **efectivo = `sum(cash_amount)`** y **transferencias = `sum(transfer_amount)`**, más la cantidad de ventas por `payment_method` (cuántas fueron mixtas). Incluye la **lista de transferencias** (hora, monto transferido, últimos 4 dígitos, vendedor y si fue mixta) para conciliar con el banco.
- **Egresos:** `sum(total_cost)` de las compras del período, neto de las compras anuladas, separado por producto (incluidos los insumos). En "Varios" se incluyen los detalles.
- **Resultado:** ingresos − egresos.
- **Por producto:** unidades y monto vendidos.
- **Insumos:** unidades compradas y consumidas en el período, y stock actual (informativo; no cambia el resultado).
- **Por día:** el monto, para los períodos semanales y mensuales.
- **Por vendedor:** cantidad de ventas, monto, efectivo y transferencias. Sirve para que cada vendedor rinda su efectivo si no hay caja compartida (ver §4).
- **Incidencias:** anulaciones (con motivo, quién y si fue por admin fuera de la ventana), ajustes, compras anuladas, y ventas con alguna marca (incluida `pago_ajustado`), contadas y listadas.
- **Stock actual:** productos a la venta e insumos bajo `min_stock` o en negativo.

**UI de balance:** atajos **Hoy**, **Último partido**, **Semana** (lunes a domingo), **Mes** y **Personalizado**. Tarjetas arriba (ingresos, egresos, resultado, efectivo y transferencias) y secciones plegables debajo.

**Historial** (con `history.view`):
- Lista paginada de `audit_log`.
- Filtros por fecha, usuario, acción y "solo con marcas".
- Cada entrada muestra quién, cuándo, qué, el motivo y las marcas como chips de color. Las anulaciones muestran la hora de la venta y la de la anulación.

**PDF:**
- Al tocar "PDF", se ejecuta `import('jspdf')` + `jspdf-autotable`.
- A4, fuentes estándar de jsPDF (Helvetica, WinAnsi: cubre á, é, ñ y $).
- **Contenido:** encabezado "CADB – Cantina – Balance <período>", generado por <usuario> el <fecha y hora>; resumen; tabla de medios de pago (efectivo, transferencias, cantidad de mixtas); ventas por producto; egresos; insumos; por vendedor; incidencias; anexo con las transferencias.
- **Entrega:**
  - Si `navigator.canShare({files:[pdf]})` funciona, se abre la hoja de compartir (WhatsApp, Drive, Imprimir). Es la vía principal en iPhone y Android.
  - Si no, `doc.save('balance-<período>.pdf')`.
  - En iOS, como respaldo, se abre el blob en una pestaña nueva, desde donde se puede compartir o guardar en Archivos (el nombre del archivo puede no respetarse).
  - Hay que **probarlo en un Android y un iPhone reales**, dentro de la app instalada y desde el sitio admin en Safari.
- **CSV:** se genera en el cliente con las mismas tablas. En iOS se entrega por la misma vía de compartir.

### 3.10 Hosting y deploy

1. **Cuentas (etapa de propuesta):** GitHub (repo privado), Supabase y Cloudflare, todas personales del owner. El paso a cuentas del club está en §3.12.
2. **Supabase:**
   - Proyecto Free en São Paulo.
   - `supabase db push --workdir src/server` y `supabase functions deploy admin-users`.
   - Auth: sign-up desactivado, confirmación desactivada, y Site URL y Redirect URLs de los dos sitios.
   - Claves publishable y secret.
3. **Cloudflare Pages**, dos proyectos desde el mismo repo:
   - `cadb-ventas`: `npm run build:ventas` con output en `dist/ventas`. Incluye el manifest, `sw.js`, `apple-touch-icon` y `_headers`, con `Cache-Control: no-cache` para `/sw.js` y `/index.html`.
   - `cadb-admin`: `npm run build:admin` con output en `dist/admin`, sin PWA.
   - Variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Sin `404.html`, así funciona como SPA.
4. **PWA:**
   - `registerType: 'prompt'`. Cuando hay una versión nueva se muestra "Actualización disponible", pero **solo si no hay operaciones pendientes**.
   - El precache incluye solo el app shell del sitio ventas.
   - Manifest: nombre "Cantina CADB", íconos, `display: standalone`, `start_url` y `scope` del sitio ventas. En `index.html`, `apple-mobile-web-app-capable`, título e ícono para iOS.
5. **Subdominios:** `cadb-ventas.pages.dev` y `cadb-admin.pages.dev`, con las mismas credenciales. El subdominio separa la organización y la UX, pero **no** es una barrera de seguridad.
6. **Keep-alive:** `keepalive.yml`, cron cada 3 días que llama a `POST /rest/v1/rpc/ping`. Prueba del sistema el sábado antes de cada partido.
7. **Backup:** `backup.yml` semanal con `supabase db dump` por el pooler (modo session), commiteado en un repo privado aparte. Se suman el PDF y el CSV mensuales.
8. **Entornos:** local con `supabase start` y un proyecto remoto, primero de demo y después de producción (§3.12).

### 3.11 Testing

**Vitest:**
- Dominio:
  - Totales y validación de los 4 dígitos.
  - **Pago:** autocompletado de mixto (último campo editado manda), rechazo de montos en 0 o que no suman el total, efectivo y transferencia simples.
  - **`canVoidOwn`:** mismo día en San Juan (incluido el cruce de medianoche), límite de minutos, `0` = sin límite.
  - Rangos de fecha (lunes a domingo, mes, último partido, zona San Juan).
  - `canManageUser` y `canAssignRole` con cada combinación de rangos.
- **Outbox** (con `fake-indexeddb`):
  - Orden FIFO de venta y anulación; la anulación lleva `device_voided_at`.
  - Retención por `user_id` distinto y bloqueo de logout con pendientes.
  - Reintento ante error de red y estado "Rechazada" ante un error de negocio (incluido "fuera de plazo").
  - Idempotencia ante una respuesta perdida.
  - Los disparadores de sincronización (apertura, `online`, `visibilitychange`, intervalo) sin depender de `SyncManager`.
- Un test que compara las claves de permisos y ajustes de TS con las de la semilla SQL.
- Un smoke test de `BalancePdf` con datos de ejemplo (blob no vacío).

**pgTAP:**
- Grants y acceso: `anon` solo ejecuta `ping`; ningún rol escribe tablas directamente.
- Feature flags:
  - Sacar `stock.adjust` o `stock.consume` a `venta` hace fallar la RPC correspondiente.
  - Agregar `balance.view` a `venta` habilita `balance_report`.
  - Owner siempre pasa. Solo owner ejecuta `set_role_permission`. `set_setting` exige `settings.manage` y valida el rango.
- Jerarquía: igual que v2 (admin no baja a otro admin, owner nombra owner, nadie baja a un owner, nadie cambia su propio rol).
- `register_sale`:
  - Idempotente; `created_by = auth.uid()`.
  - Las tres ramas de precio dan el precio y la marca correctos.
  - La ventana de fecha cambia según `sales.backdate`.
  - Se marcan `stock_negativo` y `producto_inactivo`.
  - Se rechaza un producto con `for_sale = false`.
  - **Pagos:** efectivo y transferencia guardan los montos correctos; mixto guarda `cash = total − transfer`; transferencia o mixto sin dígitos se rechaza; mixto con transferencia ≥ total del cliente se rechaza; con `precio_distinto` el mixto ajusta el efectivo y marca `pago_ajustado`; si la transferencia supera el nuevo total, se recorta y el efectivo queda en 0; el `check` `cash + transfer = total` se cumple siempre.
- `void_sale`:
  - Con `void_own_same_day`: no se puede anular la venta de otro, ni una de otro día, ni una fuera del límite de minutos; sí dentro.
  - Una anulación sincronizada tarde con `device_voided_at` dentro de la ventana se acepta; un `device_voided_at` anterior a la venta se acota.
  - Con `void_any`: cualquier venta hasta 30 días.
  - Repone el stock; es idempotente.
- Stock: `add_stock` exige el costo y la nota en "Varios"; `consume_stock` resta y no toca egresos; `void_stock_entry` revierte cantidad y costo.
- Se cumple el invariante del stock.
- `balance_report`: ingresos, egresos, efectivo y transferencias con ventas mixtas, consumo de insumos y zona horaria.
- Toda RPC de escritura deja una fila en `audit_log`.

**Edge Function:** prueba manual guiada más 2 o 3 pruebas con `supabase functions serve` (alta, rollback y jerarquía).

**Pruebas en dispositivos** (manual, con checklist). **El iPhone real es obligatorio**; si nadie del equipo tiene uno, se pide prestado antes de la demo (ver §4).
- Un Android con Chrome y un iPhone con Safari (iOS 17 o superior), con la app **instalada** en la pantalla de inicio.
- iPhone: seguir la guía de instalación, iniciar sesión dentro de la app instalada y verificar que una sesión abierta en Safari no se comparte.
- "Estado del teléfono": ver qué devuelve `storage.persist()` en cada plataforma.
- Vender (efectivo, transferencia y mixto) en modo avión, **cerrar la app del todo**, volver a abrirla con señal y comprobar que sincroniza al abrir (en iOS no hay sincronización en segundo plano).
- Anular offline una venta del día y sincronizar.
- Sesión de más de 1 hora offline.
- Teclado numérico, zoom en inputs y zonas seguras en iPhone.
- PDF y CSV compartidos por WhatsApp e impresos, desde los dos teléfonos.

**Prueba real:** 1 o 2 partidos en paralelo con el papel, después de que el club adopte el sistema.

### 3.12 Demo para el club y migración a cuentas del club

**Demo (propuesta):**
- Proyecto en las cuentas personales del owner, con `seed-demo.sql`:
  - Alrededor de 15 productos reales de cantina, más "Hielo (bolsa)", "Carbón (bolsa)" (insumos con stock) y "Varios".
  - Compras con costo, algunos consumos de insumos.
  - Dos domingos de ventas de ejemplo, con algunas mixtas y algunas marcas.
- `scripts/create-demo-users.ts` crea `demo-venta` y `demo-admin` con claves conocidas.
- **Guion de unos 5 minutos:**
  1. Desde un teléfono (idealmente un iPhone, con la app instalada), vender en efectivo, por transferencia y mixto (ver el autocompletado).
  2. Activar el modo avión, vender, desactivarlo y ver cómo se sincroniza.
  3. Anular una venta del día con motivo, y mostrar que una de ayer pide un admin.
  4. Cargar una compra de hielo y registrar "Usé 1 bolsa".
  5. En el admin, cambiar un precio y ver su historial; mostrar el ajuste del límite de anulación.
  6. Ver el balance del día (efectivo y transferencias) y generar el PDF por WhatsApp.
  7. Ver el historial con las marcas.
  8. Abrir la matriz de permisos.
- Antes de la demo se borran los datos de ejemplo de los teléfonos que se usen.

**Migración al adoptarse:**
- Crear las cuentas del club con un email del club, transferir o recrear el repo, crear un **proyecto Supabase nuevo** en la cuenta del club y aplicar las migraciones, sin los datos de la demo.
- Recrear los 2 proyectos de Pages en la cuenta Cloudflare del club y crear el owner con `create-owner`.
- No dependemos de transferir el proyecto Supabase entre cuentas (no verificado; empezar limpio es más simple).
- Las URLs `*.pages.dev` pueden cambiar con la migración. Conviene hacerla **antes** de que los vendedores instalen la app, porque en iOS habría que reinstalarla desde la URL nueva.

### 3.13 Fases de implementación

0. **Setup (½ día):**
   - Repo, Vite + Vue + TS, Pico y Vitest.
   - Raíces `ventas` y `admin`, Supabase CLI, proyecto de demo y 2 proyectos de Pages con un "hola mundo".
   - Abrir el "hola mundo" instalado en un iPhone para detectar temprano problemas de iOS.
1. **Usuarios, permisos y seguridad:**
   - `profiles`, `permissions`, `role_permissions`, `settings`, `audit_log`, grants y RLS.
   - `has_permission`, `my_permissions` y `set_setting`.
   - RPC de usuarios y de matriz de permisos.
   - Edge Function, `create-owner`, login en los dos sitios y guards.
   - Pantallas de usuarios, permisos y ajustes.
   - pgTAP de flags, ajustes y jerarquía.
2. **Inventario:**
   - `products`, `price_history`, `stock_movements`.
   - `create_product`, `update_product`, `set_price`, `add_stock` (con costo), `consume_stock`, `adjust_stock` y `void_stock_entry`.
   - Admin: ABM de productos (incluidos insumos) y precios, con su historial.
   - Ventas: pantallas de Compras y de Stock e insumos.
3. **Ventas online a través del outbox:**
   - `sales` (con montos por medio), `sale_items`, `register_sale` (precio, pago y marcas) y `void_sale` (ventana del mismo día).
   - Caja mobile-first con hoja de cobro (efectivo, transferencia y mixto con autocompletado) y aviso de stock negativo.
   - "Mis ventas" del día con anulación; anulación por admin en el historial.
   - Carga con fecha pasada (plan C).
4. **Offline e iOS:**
   - PWA, catálogo, permisos y ajustes cacheados, reglas de sesión y bloqueo de logout, disparadores de sincronización, `persist()` y prompt de actualización.
   - Guía de instalación (iOS y Android), meta e íconos de iOS y pantalla "Estado del teléfono".
   - Checklist en Android y **iPhone** reales.
5. **Balance, historial y PDF:**
   - `balance_report` (con montos por medio e insumos), pantalla con atajos e historial con filtros.
   - PDF con jsPDF (carga diferida) y CSV.
   - Prueba del PDF en Android y iPhone.
6. **Operación:**
   - `ci.yml`, `keepalive.yml` y `backup.yml`.
   - README corto: crear usuarios, instalar la app en iPhone y Android, checklist antes del partido, quitar un owner por SQL, qué hacer si Supabase se pausó y cómo restaurar un dump.
7. **Demo al club:** `seed-demo`, usuarios de demo y guion.
8. **Si el club lo adopta:** migración a sus cuentas (§3.12), carga de usuarios reales, instalación en el teléfono de cada vendedor y prueba en cancha en paralelo con el papel.

### 3.14 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Pausa de Supabase Free | El domingo no anda la sincronización (la caja offline sigue funcionando) | `ping` cada 3 días, mail de aviso de Supabase, prueba el sábado |
| Grants, RLS o flags mal configurados | Escalada de privilegios o API con error 42501 | Escrituras solo por RPC, `has_permission` en cada RPC, pgTAP de flags y jerarquía |
| El vendedor no preparó el teléfono (no instaló la app o no inició sesión con señal) | No puede vender offline | Checklist antes del partido, aviso "Instalá la app", pantalla "Estado", plan C con papel |
| En iPhone se usa la app en una pestaña de Safari en vez de la instalada | Sesión y cola separadas; más riesgo de desalojo | Aviso insistente en pestaña, guía "Agregar a inicio", login dentro de la app instalada |
| iOS sin sincronización en segundo plano | Ventas quedan en el teléfono si no se vuelve a abrir la app con señal | Sincronizar al abrir y al volver a primer plano, indicador de pendientes, paso "0 pendientes" al cerrar la jornada |
| Cola perdida (borrado de datos, teléfono perdido, desalojo en iOS) | Ventas sin registrar | Sincronización inmediata con señal, `storage.persist()`, app instalada, sincronizar el mismo día, plan C |
| No hay un iPhone para probar | Fallas de iOS descubiertas en la cancha | Prueba en iPhone obligatoria antes de la demo (pedir uno prestado), "hola mundo" instalado en la fase 0 |
| Service worker con una versión vieja | Comportamiento inconsistente | `_headers` con `no-cache` para `sw.js`, prompt de actualización sin operaciones pendientes |
| Catálogo con precios viejos offline | Diferencias de caja | Ventana de 3 días, marcas `precio_desactualizado`, `precio_distinto` y `pago_ajustado`, aviso "precios de hace X" |
| Error al cargar los montos de un pago mixto | Efectivo o transferencias mal sumados | Autocompletado, validación de que suman el total, lista de transferencias para conciliar con el banco |
| Vendedor que no llega a anular a tiempo | Venta errónea queda registrada | Un admin anula con `void_any`; límite configurable en `settings` |
| Usuario desactivado o sesión revocada con ventas en cola | Ventas rechazadas | Estado "Rechazada" visible, sin borrado, y recarga por un admin |
| Nadie registra el consumo de insumos | Stock de insumos desactualizado | No afecta el balance (el egreso es la compra); alerta de `min_stock` y ajuste con motivo para corregir |
| El PDF no se comparte o descarga bien en algún teléfono | No hay reporte impreso | Tres vías de entrega, CSV, prueba en dispositivos |
| Hay un solo owner y se va o pierde el acceso | Nadie puede bajar admins ni editar permisos | Cuentas del club al adoptarse, segundo owner, SQL documentado en el README |
| El owner nombra a otro owner por error | No se puede deshacer desde la web | Confirmación explícita y SQL manual documentado |
| Reloj del dispositivo mal configurado o manipulado | Ventas o anulaciones en el día equivocado | Ventanas acotadas, horas del dispositivo y del servidor guardadas, marcas `fecha_corregida` y `diferida` |
| Sobre-ingeniería | El proyecto no se termina | Offline solo en la caja, lista fija de permisos y ajustes, sin arqueo, combos ni Background Sync, fases cortas |

---

## 4. Preguntas abiertas (priorizadas)

1. **Caja y arqueo:** ¿hay una caja física compartida donde todos los vendedores guardan el efectivo, o cada vendedor guarda el suyo? ¿Quieren hacer un cierre de caja al final de la jornada (contar el efectivo y compararlo con lo vendido)? Si la caja es compartida, se cargaría el efectivo inicial (el cambio que se pone antes de vender) y el contado al final. Si cada uno guarda el suyo, alcanza con el balance por vendedor que ya trae el MVP.
2. **iPhone para probar:** ¿alguien del club o del equipo tiene un iPhone que se pueda usar para las pruebas antes de la demo?
3. **Límite de anulación:** la propuesta inicial es que un vendedor pueda anular hasta **60 minutos** después de la venta (y siempre el mismo día). ¿Les parece bien ese valor? Se puede cambiar después desde el admin.
