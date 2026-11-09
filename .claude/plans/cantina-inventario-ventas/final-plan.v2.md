# Plan final (v2): Sistema de inventario y ventas de la cantina del CADB

Club Atlético Deportivo Barreal (Barreal, San Juan). Esta es la revisión de `final-plan.v1.md` con las respuestas del usuario a las 11 preguntas abiertas y 3 requisitos nuevos. Fecha: 2026-11-09. Es una **propuesta para el club**: todavía no se implementa en producción.

---

## 1. Resumen

Una web interna, estática y gratuita, pensada **para el teléfono** (alrededor del 99% del uso) y que también funciona en desktop. Reemplaza el lápiz y papel de la cantina y tiene dos sitios con las mismas credenciales:

- **Ventas** (`cadb-ventas.pages.dev`): caja, ingreso de compras y stock, y "mis ventas". **Funciona sin señal** y sincroniza después.
- **Admin** (`cadb-admin.pages.dev`): productos, precios, balance con PDF, historial, usuarios y permisos. Necesita conexión.

Las piezas principales:

- **Stack:** Vue 3 + Vite + TypeScript, Pico CSS, `vite-plugin-pwa` (solo en el sitio ventas), Supabase Free (Postgres, Auth, RLS y 1 Edge Function), Cloudflare Pages y jsPDF, este último cargado bajo demanda solo en el balance. Costo $0.
- **Permisos:** cada permiso es un **feature flag por rol** guardado en la tabla `role_permissions`. Tanto el servidor (RLS y RPC) como la UI consultan `has_permission('<clave>')`. La jerarquía de roles es **estructural** y no es un flag: el rol owner no se puede quitar desde la web, un admin no puede bajar a otro admin, y nadie puede cambiar su propio rol.
- **Trazabilidad:** hay un usuario por persona. Cada venta, anulación, ajuste, compra, cambio de precio y cambio de usuario o permiso queda en `audit_log` con quién, cuándo, el motivo y sus **marcas** (por ejemplo, stock negativo, precio desactualizado o venta diferida).
- **Balance:** ingresos − egresos, separado por medio de pago (efectivo o transferencia). Los egresos salen de lo que se gastó en cada compra, porque los gastos sueltos también son "productos" de tipo insumo, con "Varios" como último recurso. Se exporta en **PDF** (diario, semanal, mensual o personalizado) y en CSV.

### Cambios respecto de v1

1. **El modo offline entra al MVP**, limitado a la caja (vender y anular). Usa una única cola local (outbox) por la que pasan todas las ventas, con o sin señal. El papel queda como plan C.
2. **El precio de cada venta (R2 revisado):** el cliente informa el precio que mostró y el servidor lo acepta **solo** si figura en el historial de precios para ese producto entre los 3 días previos a la venta y el momento de la venta. Si no figura, usa el precio vigente en ese momento y marca la venta.
3. **Historial de precios** (`price_history`) obligatorio. Solo quien tiene `prices.manage` puede cambiar precios, y por defecto ese permiso lo tiene solo admin.
4. **Las compras registran su costo total** y alimentan los egresos. **Se elimina la tabla `expenses`.** Los productos tienen `for_sale`: los insumos (hielo, carbón, "Varios") no aparecen en la caja, y "Varios" exige un detalle.
5. **Medios de pago:** `efectivo` o `transferencia`. La transferencia obliga a cargar los **últimos 4 dígitos**.
6. **Permisos como feature flags por rol.** Se pueden editar desde el panel, pero solo el owner. Owner tiene todos los permisos implícitamente.
7. **Owner:** el plan arranca con uno solo (el usuario). El owner puede nombrar a otros owners, pero **ningún owner puede ser degradado ni desactivado desde la web**. Se elimina la lógica de "0 owners" y el `advisory lock`.
8. **`venta` puede anular sus ventas y ajustar stock** con motivo obligatorio, y todo queda en el historial con marcas. La venta con stock negativo se permite con aviso y queda marcada.
9. Todas las escrituras pasan por RPC (se eliminan los grants por columna de `products`). Se agregan las tablas `audit_log`, `permissions` y `role_permissions` y el arreglo `flags` en `sales`.
10. **UX mobile-first** explícita (§3.3). **Balance en PDF** con jsPDF cargado bajo demanda. Nueva sección de **demo para el club** y de migración a cuentas del club.

### Verificación de hechos (búsquedas web del árbitro, 2026-11-09)

| Afirmación | Resultado |
|---|---|
| Hechos verificados en v1 (cambio de grants por defecto de Supabase en 2026, pausa del Free a la semana, deprecación de las claves legacy, Firebase Functions requiere Blaze) | Se mantienen como en v1. No se volvieron a verificar. |
| Supabase Auth: el access token dura 1 h por defecto, el refresh token **no vence** y es de un solo uso, y hay un intervalo de reuso de 10 s con una excepción para el token padre ante redes inestables | **Verificado** (docs "User sessions"). Consecuencia: un teléfono que estuvo horas sin señal renueva la sesión al volver la conexión sin pedir login, salvo que la sesión haya sido revocada (por ejemplo, un usuario desactivado). |
| El límite de duración de sesión y el timeout por inactividad son solo de planes Pro o superiores | **Verificado** (misma página). En el plan Free las sesiones no vencen por inactividad. |
| La documentación de Supabase no describe el comportamiento offline | **Verificado.** El diseño no depende de llamar a Auth mientras no hay señal (ver §3.8). |
| `vite-plugin-pwa` sigue mantenido (1.3.0, con soporte de Vite 8) | **Parcialmente verificado**, con fuentes secundarias (notas de release en mirrors y un tutorial). No confirmé la fecha en GitHub. |
| jsPDF pesa alrededor de 230 KB gzip y pdfmake es más pesado (por las fuentes embebidas) | **Parcialmente verificado.** Las fuentes de agregadores no coinciden. Se mitiga con `import()` dinámico (solo se descarga al tocar "PDF") y midiendo el bundle. |
| En iOS, `jsPDF.save()` o abrir el blob permiten "Guardar en Archivos" o compartir. El nombre de archivo es poco confiable | **Parcialmente verificado**, con fuentes de 2017 a 2021. Hay que probar en dispositivos reales. |
| Web Share API con archivos (`navigator.canShare({files})`) funciona en Safari iOS 14+ y en Chrome Android | **Parcialmente verificado** (web.dev y WebKit). Falta probar el tipo PDF en cada plataforma. |
| Safari borra el almacenamiento escrito por script (incluido IndexedDB) tras 7 días de uso sin interacción con el sitio, y las web apps en pantalla de inicio están exentas | **Verificado con fuentes de 2020 a 2022.** No encontré cambios más recientes. Mitigación: instalar en la pantalla de inicio y sincronizar el mismo día. |

Fuentes: [Supabase – User sessions](https://supabase.com/docs/guides/auth/sessions) · [Supabase JS auth reference](https://supabase.com/docs/reference/javascript/auth) · [vite-plugin-pwa 1.3.0 release](https://newreleases.io/project/npm/vite-plugin-pwa/release/1.3.0) · [vite-plugin-pwa en npm](https://npmjs.com/package/vite-plugin-pwa) · [npm-compare jspdf/pdfmake](https://npm-compare.com/jspdf,pdf-lib,pdfmake) · [devpick jspdf](https://devpick.pages.dev/jspdf-vs-pdfjs-dist) · [WebKit bug 226509 (guardar PDF en iOS)](https://bugs.webkit.org/show_bug.cgi?id=226509) · [SO: nombre de archivo jsPDF en iOS](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/64163555/jspdf-filename-not-showing-for-ios-using-output-instead-of-save) · [web.dev – Web Share](https://web.dev/articles/web-share) · [WebKit bug 198606](https://bugs.webkit.org/show_bug.cgi?id=198606) · [Search Engine Land – 7-day cap y PWA](https://searchengineland.com/what-safaris-7-day-cap-on-script-writeable-storage-means-for-pwa-developers-332519) · [WebKit bug 211775](https://bugs.webkit.org/show_bug.cgi?id=211775)

---

## 2. Decisiones

Marcas: **=** se mantiene de v1, **Δ** cambia respecto de v1, **+** es nueva.

| # | Tema | Decisión | Motivo |
|---|---|---|---|
| R1 Δ | Grants | `revoke all` en todas las tablas. `authenticated` solo tiene `select`. **Todas las escrituras pasan por RPC** `security definer`, incluidos los productos y precios. Ya no hay grants por columna. | Con permisos-flag y auditoría obligatoria, un único camino de escritura es más simple y más seguro. |
| R1b = | `EXECUTE` por defecto a `PUBLIC` | `revoke execute ... from public, anon` y `grant ... to authenticated` en cada función, excepto `ping()`. | Igual que en v1. |
| R2 Δ | Precio de la venta | El cliente manda el precio que mostró (`shown_price`). El servidor lo acepta si ese precio estuvo vigente para el producto en algún momento de `[t − 3 días, t]`, según `price_history`. Si no es el vigente en `t`, marca `precio_desactualizado`. Si no figura en esa ventana, usa el precio vigente en `t` y marca `precio_distinto`. | Con el modo offline, el catálogo del teléfono puede estar viejo. Así se registra lo que realmente se cobró sin dejar que el cliente invente precios. |
| R3 Δ | Hora de la venta | `created_at` es la hora efectiva y `device_created_at` la original del dispositivo. La ventana es `[now−3 d, now+5 min]`, o 30 días con `sales.backdate`. Si la hora queda fuera de la ventana se usa `now()` con la marca `fecha_corregida`. Si la venta se sincroniza más de 2 minutos después, lleva la marca `diferida`. | Cubre la sincronización tardía y la carga desde papel. La columna `backdated` se reemplaza por `flags`. |
| R4 Δ | Carrera de "0 owners" | **Se elimina.** Ningún owner puede ser degradado ni desactivado desde la web. | Respuesta 4: sin bajas de owner no puede quedar ninguno. |
| R5 = | Alta de usuario no atómica | Se valida antes y se hace rollback con `deleteUser` si falla. | Igual que en v1. |
| R6 Δ | Ajustes de `venta` | `stock.adjust` es un flag y `venta` lo tiene por defecto. El motivo es obligatorio y queda en el historial. | Respuesta 7. |
| R7 = | La lógica real vive en SQL | El dominio TS es la especificación y sirve para la UX. Las reglas se aplican en SQL. | Igual que en v1. |
| R8 = | Módulos | 3 módulos (`inventory`, `sales`, `users`) y un solo `package.json`. | Proporción. |
| R9 = | Keep-alive y backup | `ping()` cada 3 días, y dump semanal por el pooler a un repo privado aparte. | Igual que en v1. |
| R10 = | Claves | Publishable key en el frontend y secret key solo en la Edge Function y en scripts locales. | Igual que en v1. |
| R11 Δ | Hosting | Cloudflare Pages con 2 proyectos, más `_headers` para que `sw.js` no se cachee. | La PWA necesita que el service worker se actualice. |
| R12 Δ | Sin señal | El **offline de la caja entra al MVP**. El papel con carga posterior por admin queda como plan C. | Respuesta 2. Ver el veredicto en §3.8. |
| R13 = | Columnas y orden de migración | Igual que en v1, más las tablas nuevas. | Igual que en v1. |
| R14 Δ | Balance | **Resuelto:** ingresos − egresos, con los egresos tomados de las compras. Se elimina `expenses`. | Respuesta 1. |
| R15 = | Descarte de Firebase | Igual que en v1. | Igual que en v1. |
| R16 Δ | Detalles de `register_sale` | Se bloquea por `id` ordenado y la cantidad va de 1 a 100. Los productos inactivos **se aceptan** con la marca `producto_inactivo`. Es idempotente. | Una venta hecha offline no debe rechazarse porque alguien desactivó el producto mientras tanto. |
| R17 = | Semana y "último partido" | La semana va de lunes a domingo en zona San Juan. "Último partido" es el último día con ventas. | Igual que en v1. |
| R18 Δ | Renombrar, reactivar y cambiar la propia clave | Igual que en v1, pero **nadie gestiona a un owner desde la web**: solo puede cambiar su propia clave. | Respuesta 4. |
| S1–S3 = | Supabase, Cloudflare Pages, Pico CSS | Se mantienen. Pico es responsive y tiene targets grandes. | Igual que en v1. |
| S4 Δ | Stock negativo | Se permite con aviso previo en la caja y queda la marca `stock_negativo`. | Respuesta 8. |
| S5 = | Login | Usuario y contraseña, con el email sintético `<usuario>@cadb.local`. | La respuesta 3 no pidió email real. |
| S6 Δ | Offline | En el MVP, solo para la caja, con un único outbox. | Respuesta 2. |
| S7 = | Un solo `package.json` | Se mantiene. | Igual que en v1. |
| U1 + | Costos y gastos | `add_stock` exige el **costo total** de la compra (puede ser 0, por ejemplo una donación). Los insumos son productos con `for_sale=false`. "Varios" viene precargado con `requires_note=true`. | Respuesta 1. El usuario dijo "lo que se gastó", así que es el total de la compra y no un costo unitario. |
| U2 + | Mobile-first y offline | La UI se diseña para el teléfono con una mano (§3.3) y la caja funciona offline. | Respuesta 2 y consideración 1. |
| U3 + | Usuarios | Un usuario por persona. `created_by` siempre es `auth.uid()` en el servidor. | Respuesta 3: trazabilidad. |
| U4 + | Owner | Se empieza con 1 owner. El owner puede nombrar a otros owners. Quitar el rol owner o desactivar a un owner se hace **solo a mano en la base** (con un SQL documentado en el README). | Respuesta 4. |
| U5 + | Precios | El permiso es `prices.manage` (por defecto solo admin; owner lo tiene implícito). Hay historial en `price_history`. | Respuesta 5. |
| U6 + | Medios de pago | `efectivo` o `transferencia`, y para transferencia `transfer_last4` con el formato `^\d{4}$`, obligatorio. El balance los separa y lista las transferencias. | Respuesta 6. |
| U7 + | Anular y ajustar | `venta` anula **sus propias** ventas de los últimos 3 días y ajusta stock. Hay que poner un motivo y queda en el historial. | Respuesta 7. |
| U8 + | Stock negativo | Se avisa antes de confirmar y el servidor marca `stock_negativo`. | Respuesta 8. |
| U9 + | Unidades | Todo se vende por unidad entera. La "docena de empanadas" es un producto. No hay combos con receta. | Respuesta 9. |
| U10 + | Dominio | `*.pages.dev`, gratis. | Respuesta 10. |
| U11 + | Cuentas | Para la propuesta se usan las cuentas personales del usuario (owner). Al adoptarse el sistema se crea un proyecto nuevo en cuentas del club (§3.12). | Respuesta 11. |
| N1 + | Responsive | Ver U2 y §3.3. | Consideración 1. |
| N2 + | PDF | jsPDF + `jspdf-autotable` con `import()` dinámico, solo en la pantalla de balance. Se entrega con Web Share (archivo) o con descarga. Se mantiene el CSV. | `window.print()` es poco confiable en los teléfonos, y las fuentes embebidas de pdfmake lo hacen más pesado. |
| N3 + | Feature flags | Hay una lista fija de claves en `permissions` y una tabla `role_permissions(role, permission)` para `venta` y `admin`, con owner implícito. Se usa `has_permission()` en RLS y RPC y `my_permissions()` en la UI. Solo el owner edita la matriz, desde el panel. | Consideración 3. La jerarquía queda fuera de los flags para evitar quedarse sin acceso o escalar privilegios. |

---

## 3. Plan final

### 3.1 Alcance

**MVP:**
- **Productos:** nombre, precio, tipo (`for_sale` es "a la venta", y si no, es insumo o gasto), `requires_note`, stock mínimo, orden y activo. El historial de precios va en una tabla aparte.
- **Ingreso de compras:** cantidad y **costo total**, por productos a la venta o insumos ("Hielo", "Carbón" o "Varios" con detalle). También se puede anular una compra cargada mal.
- **Ajuste de stock** (±, con motivo).
- **Caja táctil:** medio de pago, aviso de stock negativo, **funcionamiento offline** con sincronización, y anulación con motivo.
- **Balance:** ingresos − egresos por período, separado por medio de pago y por producto, con incidencias. Se exporta en **PDF** y CSV.
- **Historial** (auditoría) con filtros y marcas.
- **Usuarios** (uno por persona), roles `venta`, `admin` y `owner`, y **permisos por rol editables** por el owner.
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

Se diseña primero para un teléfono de alrededor de 360 px de ancho, usado con una mano y al sol. En desktop es el mismo layout centrado (máximo unos 960 px) y la grilla de la caja muestra más columnas.

**Criterios generales:**
- Los objetivos táctiles miden **48 px o más** y hay separación entre botones.
- Los inputs usan una fuente de 16 px o más, para que iOS no haga zoom.
- Se usa `inputmode="numeric"` en cantidades, costos y últimos 4 dígitos.
- Nada depende de hover.
- Alto contraste, sin animaciones innecesarias.
- Las acciones principales quedan en la zona del pulgar (abajo).
- Los textos son cortos y en voseo ("Cobrar", "Anular", "Guardada en el teléfono").

**Sitio ventas:**
- **Barra inferior fija** con 4 pestañas: **Caja · Compras · Mis ventas · Más**. "Más" incluye stock, cambiar clave y cerrar sesión.
- **Encabezado** con un indicador de conexión: "En línea", "Sin señal · 3 ventas pendientes" o "Sincronizando…".

**Caja:**
- Grilla de botones grandes por producto: 2 columnas en el teléfono y de 4 a 6 en desktop. Cada botón muestra nombre, precio y un contador si el producto ya está en la venta.
- Un toque suma 1. Los productos con stock ≤ 0 se ven con un borde de aviso, pero no se bloquean.
- **Barra de total fija** abajo: "3 ítems · $4.500 · [Cobrar]". Al tocar el total se abre una hoja inferior con el detalle y botones −/+ y quitar.
- **Cobrar** abre una hoja inferior:
  - Dos botones grandes: **Efectivo** y **Transferencia**.
  - Si es transferencia, aparece un campo de 4 dígitos con teclado numérico.
  - Si es efectivo, hay un campo opcional "Paga con" que solo calcula el vuelto y no se guarda.
  - Si algún ítem queda en negativo, aparece el aviso "Sin stock cargado de X. ¿Vender igual?".
  - El último paso es **Confirmar**.
- Al confirmar, el estado aparece en un toast con acciones: "Guardada en el teléfono" y, cuando llega al servidor, "Sincronizada ✓". Si hay un error, ofrece reintentar.
- Opcional y barato: la Screen Wake Lock API mantiene la pantalla encendida mientras la caja está abierta.

**Compras:**
- Se elige el producto con un buscador y una lista. Los insumos y "Varios" aparecen al final.
- Se cargan la cantidad y el **total gastado**. El detalle es obligatorio en "Varios".
- Esta pantalla requiere conexión.

**Mis ventas:**
- Lista las ventas del usuario de los últimos 3 días, con su estado (pendiente o sincronizada) y sus marcas.
- Cada venta tiene la opción **Anular**, que pide un motivo.

**Sitio admin:** es mobile-first también.
- En el teléfono usa una barra inferior con **Balance · Productos · Historial · Más**. "Más" incluye usuarios, permisos y cambiar clave.
- En desktop las mismas secciones van en una barra superior.
- Las tablas se convierten en tarjetas apiladas en pantallas angostas.

### 3.4 Arquitectura

```
web/ (Vue)  ->  domain/ (TS puro: entidades, reglas, casos de uso, puertos)  <-  infra/ (Supabase, IndexedDB, jsPDF)
```

**Dominio:**
- Entidades: `Product`, `PriceChange`, `StockMovement`, `Sale`, `SaleItem`, `User`, `Role` y `Permission` (claves).
- Reglas para la UX: totales, validación de la venta (los 4 dígitos), rangos de fecha, `canManageUser` y `canAssignRole` (para mostrar u ocultar botones), y una regla de `canSync` del outbox.

**Puertos (6):**
- `ProductRepository`: list, create, update, setPrice, priceHistory, addStock(costo), adjustStock, voidEntry, listMovements.
- `SaleRepository`: register (idempotente), void(motivo), listMine, getBalance, listHistory.
- `SaleOutbox`: enqueue, pending, sync y onChange. Es un decorador de `SaleRepository` para register y void.
- `AuthService`: signIn, signOut, currentUser, myPermissions, onChange, changeOwnPassword.
- `UserAdminService`: list, create, setRole, setActive, resetPassword, rename, getRoleMatrix, setRolePermission.
- `Clock`.

**Resto:**
- **Infra:** adaptadores de Supabase, el `IdbSaleOutbox` y `CatalogCache` sobre IndexedDB, y `BalancePdf` (jsPDF, carga diferida).
- **Composition root:** `src/shared/container.ts`, con `provide/inject`.
- **Reemplazabilidad (honesta, como en v1):** la UI y el dominio no dependen de Supabase, pero la aplicación real de las reglas (precios, stock, permisos, jerarquía y auditoría) vive en SQL. Cambiar de BaaS implica nuevos adaptadores **y** reescribir esas reglas.
- **Desviación de `idea.md`:** los módulos cuelgan directo de `src/` (siguiendo el ejemplo `src/inventory/{web,domain,infra}`) y el servidor está en `src/server/`. La justificación es la misma de v1.

### 3.5 Estructura de carpetas

```
cadb/
├─ package.json                # único
├─ vite.config.ts              # root según --mode ventas|admin; PWA solo en ventas
├─ tsconfig.json
├─ public-ventas/_headers      # Cache-Control: no-cache para /sw.js e /index.html
├─ src/
│  ├─ inventory/{domain,infra,web}/   # productos, precios, compras, ajustes
│  ├─ sales/{domain,infra,web}/       # caja, outbox, anulación, balance, PDF, historial
│  ├─ users/{domain,infra,web}/       # login, roles, permisos, usuarios
│  ├─ shared/                         # container.ts, supabase-client.ts, money.ts, dates.ts, componentes base (BottomNav, BottomSheet, Toast)
│  ├─ app/
│  │  ├─ ventas/  index.html, main.ts, router.ts, App.vue
│  │  └─ admin/   index.html, main.ts, router.ts, App.vue
│  └─ server/supabase/
│     ├─ config.toml
│     ├─ migrations/                  # tablas, grants, RLS, funciones, semilla de permissions/role_permissions
│     ├─ functions/admin-users/index.ts
│     ├─ tests/                       # pgTAP
│     ├─ seed.sql                     # local
│     └─ seed-demo.sql                # productos y datos de ejemplo para la demo
├─ scripts/                           # create-owner.ts, create-demo-users.ts
└─ .github/workflows/                 # ci.yml, keepalive.yml, backup.yml
```

### 3.6 Modelo de datos (Postgres)

El dinero se guarda en pesos enteros (`integer`) y las sumas en `bigint`. Las fechas son `timestamptz` y los reportes usan la zona `America/Argentina/San_Juan`. El orden de creación es `profiles` → `permissions` → `role_permissions` → `products` → `price_history` → `sales` → `sale_items` → `stock_movements` → `audit_log`.

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

products (
  id uuid pk default gen_random_uuid(),
  name text unique not null,
  price integer not null check (price >= 0),   -- cache del precio vigente (lo escribe set_price)
  stock integer not null default 0,            -- cache: lo modifican solo las funciones
  for_sale boolean not null default true,      -- false = insumo/gasto (hielo, carbón, Varios): no aparece en caja
  requires_note boolean not null default false,-- true en "Varios"
  min_stock integer null,
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
  total integer not null,
  payment_method text not null check (payment_method in ('efectivo','transferencia')),
  transfer_last4 text null check (transfer_last4 ~ '^\d{4}$'),
  -- check: (payment_method = 'transferencia') = (transfer_last4 is not null)
  status text not null default 'ok' check (status in ('ok','anulada')),
  flags text[] not null default '{}',           -- diferida, fecha_corregida, stock_negativo,
                                                -- precio_desactualizado, precio_distinto, producto_inactivo
  created_by uuid not null references profiles, -- siempre auth.uid()
  created_at timestamptz not null default now(),-- hora efectiva de la venta
  device_created_at timestamptz null,           -- hora informada por el dispositivo
  synced_at timestamptz not null default now(),
  voided_by uuid null references profiles,
  voided_at timestamptz null,
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
  type text not null check (type in ('entrada','venta','ajuste','anulacion_venta','anulacion_entrada')),
  quantity integer not null,                    -- + entra / - sale
  total_cost integer null,                      -- obligatorio en 'entrada' (>= 0); negativo en 'anulacion_entrada'
  sale_id uuid null references sales,
  reverses_id uuid null references stock_movements, -- en anulacion_entrada
  note text,                                    -- obligatoria en ajuste, anulaciones y productos requires_note
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
)

audit_log (
  id bigint generated always as identity pk,
  at timestamptz not null default now(),
  actor uuid not null references profiles,
  action text not null,        -- sale.register, sale.void, stock.add, stock.adjust, stock.void_entry,
                               -- product.create, product.update, price.set, user.create, user.role,
                               -- user.active, user.password_reset, user.rename, role_permission.set
  entity_id text null,
  reason text null,
  flags text[] not null default '{}',
  detail jsonb not null default '{}'   -- p. ej. {precio_anterior, precio_nuevo} o {rol_anterior, rol_nuevo}
)
```

**Notas:**
- **Invariante:** `products.stock = sum(stock_movements.quantity)` por producto, y lo verifica un test. Los insumos también llevan stock, pero la UI no lo muestra.
- **Egresos:** se calculan como `sum(total_cost)` de los movimientos `entrada` y `anulacion_entrada` del período. Es un balance de caja, no un margen sobre lo vendido.
- **"Varios":** la semilla lo crea con `for_sale=false` y `requires_note=true`. La UI lo muestra último y con el texto "Usar solo si no existe un producto".

### 3.7 Autenticación, roles y permisos

**Login:**
- Supabase Auth con el email sintético `<usuario>@cadb.local`. La confirmación de email y el **sign-up público** están desactivados, y la contraseña tiene 8 caracteres como mínimo.
- La sesión queda guardada en el dispositivo (configuración por defecto de supabase-js, con `autoRefreshToken`).
- **Cerrar sesión se bloquea** si el usuario tiene ventas pendientes de sincronizar (ver §3.8).

**Permisos (feature flags):** la lista es fija y la crea la migración. Los valores por defecto son los de esta tabla.

| Clave | Qué habilita | venta | admin | owner |
|---|---|:-:|:-:|:-:|
| `sales.register` | Registrar ventas (incluye offline) | ✔ | ✔ | ✔ |
| `sales.void_own` | Anular **sus** ventas de los últimos 3 días, con motivo | ✔ | ✔ | ✔ |
| `sales.void_any` | Anular cualquier venta, hasta 30 días, con motivo | ✘ | ✔ | ✔ |
| `sales.backdate` | Cargar ventas con fecha de hasta 30 días atrás (plan C, papel) | ✘ | ✔ | ✔ |
| `stock.add` | Ingresar compras (cantidad y costo total) | ✔ | ✔ | ✔ |
| `stock.adjust` | Ajustar stock (±) y anular compras, con motivo | ✔ | ✔ | ✔ |
| `products.manage` | Crear, editar y activar o desactivar productos | ✘ | ✔ | ✔ |
| `prices.manage` | Cambiar precios | ✘ | ✔ | ✔ |
| `balance.view` | Ver el balance y exportar PDF y CSV | ✘ | ✔ | ✔ |
| `history.view` | Ver el historial completo (auditoría) | ✘ | ✔ | ✔ |
| `admin.access` | Entrar al sitio admin | ✘ | ✔ | ✔ |
| `users.manage` | Crear usuarios, cambiar roles, desactivar, resetear claves y renombrar, siempre sujeto a la jerarquía | ✘ | ✔ | ✔ |

Owner tiene todo de forma **implícita**: no tiene filas en la tabla y sus permisos no se pueden editar. Por eso el owner nunca puede quitarse acceso por error.

**Reglas estructurales** (no son flags, viven en SQL):
1. **Rango:** `owner > admin > venta`.
2. **Gestionar a un usuario** (rol, activo, clave, nombre) requiere `users.manage` y que `rank(target) < rank(actor)`. Por ejemplo, un admin gestiona a un `venta` y un owner gestiona a admins y `venta`. **Nadie gestiona a un owner desde la web.**
3. **Asignar un rol `r`** (al crear el usuario o al cambiarle el rol) requiere `rank(r) ≤ rank(actor)`. Así, un admin puede crear o subir a otro admin (como pide `idea.md`) pero no bajarlo, y un owner puede nombrar a otro owner. La UI lo confirma con el texto "No se puede deshacer desde la web".
4. Nadie cambia su propio rol ni se desactiva a sí mismo. Cualquier usuario puede cambiar su propia clave.
5. **Quitar el rol owner o desactivar a un owner** se hace solo con SQL manual en el dashboard. El snippet está documentado en el README.
6. **Solo el owner** edita `role_permissions`, desde la pantalla "Permisos" del admin: una matriz de casillas por rol para `venta` y `admin`. Cada cambio queda en `audit_log`.
7. Un usuario inactivo no tiene ningún permiso.

**Aplicación en el servidor:**
1. **Grants:**
   - En todas las tablas: `revoke all ... from anon, authenticated`.
   - `grant select` a `authenticated` en las tablas de lectura.
   - Sin grants de escritura.
   - En cada función: `revoke execute ... from public, anon` y `grant execute ... to authenticated`. La excepción es `ping()`, que se concede a `anon`.
2. **Funciones auxiliares** (`security definer`, `stable` y `search_path` fijo):
   - `has_permission(p_key)`: devuelve true si el perfil está activo y su rol es owner o tiene la fila correspondiente en `role_permissions`.
   - `my_permissions()`: devuelve un `text[]` para la UI.
   - `my_rank()`.
3. **RLS:**
   - `products`, `price_history`, `permissions` y `role_permissions`: `select` para cualquier usuario activo.
   - `sales`, `sale_items` y `stock_movements`: `select` completo si `has_permission('history.view')` o `has_permission('balance.view')`. Sin esos permisos, solo las ventas propias de los últimos 3 días y sus ítems.
   - `audit_log`: `select` solo con `history.view`.
   - `profiles`: el propio perfil, o todos si tiene `users.manage`.
4. **RPC** (`security definer`, `set search_path = ''`). Cada una valida el permiso al inicio, escribe en `audit_log` y fija `actor = auth.uid()`.
   - Productos y precios:
     - `create_product(...)`, con `products.manage`. Crea la fila inicial de `price_history`.
     - `update_product(...)`, con `products.manage`. No toca precio ni stock.
     - `set_price(p_product_id, p_price)`, con `prices.manage`. Inserta en `price_history`, actualiza la cache y registra el precio anterior y el nuevo.
   - Stock:
     - `add_stock(p_product_id, p_quantity > 0, p_total_cost >= 0, p_note)`, con `stock.add`. La nota es obligatoria si el producto tiene `requires_note`.
     - `adjust_stock(p_product_id, p_delta <> 0, p_note not null)`, con `stock.adjust`.
     - `void_stock_entry(p_movement_id, p_note not null)`, con `stock.adjust`. Genera el movimiento inverso con `-qty` y `-cost`, y es idempotente.
   - Ventas:
     - `register_sale(p_sale_id, p_items jsonb [{product_id, quantity, shown_price}], p_payment, p_last4, p_device_created_at)`, con `sales.register`. Ver §3.8.
     - `void_sale(p_sale_id, p_reason not null)`, con `sales.void_any`, o con `sales.void_own` si la venta es propia y `created_at > now() − 3 d`. Es idempotente: si la venta ya está anulada, devuelve ok.
   - Reportes:
     - `balance_report(p_from date, p_to date)`, con `balance.view`.
   - Usuarios y permisos:
     - `set_user_role(p_user_id, p_role)`, `set_user_active(p_user_id, p_active)` y `rename_user(...)`, según las reglas estructurales.
     - `can_manage_user(p_user_id)` y `can_assign_role(p_role)`, que usa la Edge Function.
     - `set_role_permission(p_role, p_key, p_enabled)`, solo para owner.
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
- Al iniciar sesión obtiene `my_permissions()`, lo cachea en IndexedDB (para que el router y la UI funcionen offline) y oculta lo que el usuario no puede hacer.
- El sitio admin exige `admin.access`. Si no lo tiene, muestra "No tenés permisos" y cierra la sesión.
- Ocultar elementos en la UI es solo UX: la autorización real la hace el servidor.

### 3.8 Ventas, stock, offline y sincronización

**Veredicto sobre "cargar offline y después sincronizar": sí, en el MVP, limitado a la caja.**

- **A favor:**
  - El uso es 99% en el teléfono, en una cancha de pueblo con señal incierta.
  - La idempotencia por UUID ya estaba prevista, así que el costo extra es moderado (alrededor de 2 a 3 días): el service worker, el catálogo cacheado, el outbox y las reglas de sesión.
  - Evita la doble carga desde papel y la pérdida de trazabilidad por persona.
- **En contra:**
  - El service worker puede quedar con una versión vieja.
  - En iOS existe el borrado de IndexedDB si la app no se instala en la pantalla de inicio.
  - El catálogo puede tener precios o stock viejos.
  - La sesión puede ser revocada mientras el teléfono está offline.
  - La depuración es más difícil.
- **Mitigación:** todo lo anterior se cubre con las reglas de abajo. El offline queda **solo** en el sitio ventas, para vender y anular ventas. Compras, ajustes, precios, balance y usuarios requieren conexión.

**Requisito operativo:** antes del partido, cada vendedor **abre la app con señal y con su usuario**. Así se cachean la sesión, los permisos y el catálogo. No se puede iniciar sesión por primera vez sin señal. En iOS, además, se recomienda instalar la app en la pantalla de inicio.

**Outbox único**, tanto online como offline:
1. Al confirmar, la venta se guarda en IndexedDB (`pending_ops`) con `{op:'sale', id: uuid, user_id, device_created_at, items[{product_id, quantity, shown_price}], payment, last4}`. La UI muestra "Guardada en el teléfono".
2. Inmediatamente se intenta sincronizar. Con señal, la venta queda "Sincronizada" en alrededor de 1 segundo.
3. Una anulación también es una operación encolada (`{op:'void', sale_id, reason}`), que sirve tanto para ventas pendientes como para sincronizadas. El orden FIFO garantiza que la venta llegue antes que su anulación.
4. La sincronización se dispara después de cada operación, con el evento `online`, con `visibilitychange`, con un intervalo de 30 s y con el botón "Sincronizar ahora".
5. **Atribución:** una operación solo se sincroniza si `session.user.id == op.user_id`. El servidor siempre usa `auth.uid()`, así que nunca se atribuye una venta a otra persona. Si otra persona inicia sesión en el mismo teléfono, las operaciones del primero quedan retenidas hasta que vuelva a entrar.
6. **Cerrar sesión** se bloquea si quedan operaciones pendientes del usuario, con el mensaje "Tenés N ventas sin sincronizar. Conectate antes de salir".
7. **Errores:**
   - De red o 5xx: se reintenta con backoff.
   - Si la sesión es inválida (el refresh fue rechazado): se pide iniciar sesión otra vez **con el mismo usuario**, sin perder lo que está en cola.
   - De negocio (por ejemplo, usuario desactivado o falta de permiso): la operación queda como **"Rechazada"**, visible y no se borra. Se muestra el mensaje "Avisale a un admin". Un admin puede volver a cargarla con `sales.backdate`.
8. **Sesión offline:** el access token dura 1 h y el refresh token no vence (verificado). Sin señal no se llama a Auth. La app usa la sesión, los permisos y el catálogo cacheados. Al volver la señal, supabase-js renueva la sesión y recién entonces se sincroniza.
9. **Persistencia:** se pide `navigator.storage.persist()`. Se recomienda instalar la app en la pantalla de inicio y sincronizar el mismo día. El borrado de 7 días de Safari no afecta a una cola que se vacía en horas.

**Catálogo cacheado:** se guardan los productos (con `price` y `stock`) y los permisos en IndexedDB. Se refrescan al abrir la app, después de cada sincronización y cada 5 minutos si hay señal. La caja muestra "Precios actualizados hace X" cuando el catálogo tiene más de 1 hora.

**`register_sale` en una transacción:**
1. **Idempotencia:** si `p_sale_id` ya existe, devuelve esa venta.
2. **Validación:**
   - Que tenga `sales.register`.
   - Que haya ítems, sin duplicados, con cantidades de 1 a 100.
   - Que los productos existan y tengan `for_sale = true`. Si alguno está inactivo, agrega la marca `producto_inactivo`.
   - Que el medio de pago sea válido y, si es transferencia, que traiga los 4 dígitos.
3. **Hora efectiva `t`:**
   - Se toma `p_device_created_at` si está en `[now − 3 d, now + 5 min]`, o en `[now − 30 d, now + 5 min]` si tiene `sales.backdate`.
   - Si está fuera de la ventana, `t = now()` y se agrega la marca `fecha_corregida`.
   - Si `now() − t > 2 min`, se agrega la marca `diferida`.
4. **Bloqueo:** se hace `select ... for update` de los productos, ordenados por id.
5. **Precio por ítem:**
   - Sea `P(t)` el precio vigente en `t` según `price_history`.
   - Si `shown_price = P(t)`, se usa ese precio.
   - Si no, pero `shown_price` estuvo vigente en algún momento de `[t − 3 d, t]`, se usa `shown_price` y se agrega la marca `precio_desactualizado`. En ese caso el teléfono tenía el precio viejo y eso es lo que se cobró.
   - Si no se cumple ninguna de las dos, se usa `P(t)` y se agrega la marca `precio_distinto`.
   - El total lo calcula el servidor.
6. **Escrituras:**
   - Inserta en `sales`, `sale_items` y `stock_movements` (`venta`, negativo).
   - Ejecuta `update products set stock = stock − qty`.
   - Si algún stock queda por debajo de 0, agrega la marca `stock_negativo`.
   - Registra en `audit_log` con las mismas marcas.
7. **Respuesta:** devuelve `{id, total, flags}`. El cliente muestra las marcas en "Mis ventas".

**Anulación:** `void_sale` pone `status = 'anulada'`, guarda `voided_by`, `voided_at` y `void_reason`, y crea los movimientos `anulacion_venta` (positivos). Nada se borra.

**Plan C (papel):** si un teléfono no se pudo preparar o se perdió la cola, se anota en papel. Después alguien con `sales.backdate` carga esas ventas desde la caja, eligiendo la fecha y hora del partido, y quedan con la marca `diferida`.

**Varias cajas a la vez:** el bloqueo ordenado evita deadlocks. El stock del teléfono es orientativo y el que vale es el del servidor.

### 3.9 Balance, historial y PDF

**`balance_report(p_from, p_to)`** (con `balance.view`, sumas en `bigint`, zona San Juan) devuelve:
- **Ingresos:** las ventas `ok` del período, con el total, la cantidad de ventas y el ticket promedio.
- **Por medio de pago:** el monto y la cantidad en efectivo y en transferencia, más la **lista de transferencias** (hora, monto, últimos 4 dígitos y vendedor) para conciliar con el banco.
- **Egresos:** `sum(total_cost)` de las compras del período, neto de las compras anuladas, separado por producto. En "Varios" se incluyen los detalles.
- **Resultado:** ingresos − egresos.
- **Por producto:** unidades y monto vendidos.
- **Por día:** el monto, para los períodos semanales y mensuales.
- **Por vendedor:** cantidad de ventas y monto.
- **Incidencias:** las anulaciones (con motivo y quién), los ajustes y las compras anuladas, y las ventas con alguna marca, contadas y listadas.
- **Stock actual:** solo productos a la venta, con los que están bajo `min_stock` o en negativo.

**UI de balance:** tiene atajos **Hoy**, **Último partido**, **Semana** (lunes a domingo), **Mes** y **Personalizado**. Muestra primero tarjetas con los resultados (ingresos, egresos, resultado, efectivo y transferencias) y, debajo, las secciones plegables.

**Historial** (con `history.view`):
- Lista paginada de `audit_log`.
- Filtros por fecha, usuario, acción y "solo con marcas".
- Cada entrada muestra quién, cuándo, qué, el motivo y las marcas como chips de color.

**PDF:**
- Al tocar "PDF", se ejecuta `import('jspdf')` + `jspdf-autotable`. Así el resto de la app no carga la librería.
- El documento va en tamaño A4, con las fuentes estándar de jsPDF (Helvetica, con codificación WinAnsi, que cubre á, é, ñ y $).
- **Contenido:**
  - Encabezado: "CADB – Cantina – Balance <período>", generado por <usuario> el <fecha y hora>.
  - Resumen: ingresos, egresos y resultado.
  - Tabla de medios de pago.
  - Tabla de ventas por producto.
  - Tabla de egresos.
  - Incidencias.
  - Anexo con las transferencias.
- **Entrega:**
  - Si `navigator.canShare({files:[pdf]})` funciona, se abre la hoja de compartir con WhatsApp, Drive o Imprimir.
  - Si no, se usa `doc.save('balance-<período>.pdf')`.
  - En iOS, como respaldo, se abre el blob en una pestaña nueva, desde donde se puede compartir o guardar en Archivos.
  - Hay que **probar en un Android y un iPhone reales** antes de la demo.
- **CSV:** se genera en el cliente con las mismas tablas, porque es barato y útil para Excel.

### 3.10 Hosting y deploy

1. **Cuentas (etapa de propuesta):** GitHub (repo privado), Supabase y Cloudflare, todas personales del owner. Cómo se pasan a cuentas del club está en §3.12.
2. **Supabase:**
   - Proyecto Free en São Paulo.
   - `supabase db push --workdir src/server` y `supabase functions deploy admin-users`.
   - Auth: sign-up desactivado, confirmación desactivada, y Site URL y Redirect URLs de los dos sitios.
   - Claves publishable y secret.
3. **Cloudflare Pages**, dos proyectos desde el mismo repo:
   - `cadb-ventas`: `npm run build:ventas` con output en `dist/ventas`. Incluye el manifest, `sw.js` y `_headers`, con `Cache-Control: no-cache` para `/sw.js` y `/index.html`.
   - `cadb-admin`: `npm run build:admin` con output en `dist/admin`, sin PWA.
   - Variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Sin `404.html`, así funciona como SPA.
4. **PWA:**
   - `registerType: 'prompt'`. Cuando hay una versión nueva, se muestra "Actualización disponible", pero **solo si no hay operaciones pendientes**, para no recargar en medio de una venta.
   - El precache incluye solo el app shell del sitio ventas.
   - El manifest tiene nombre "Cantina CADB", íconos y `display: standalone`.
5. **Subdominios:** `cadb-ventas.pages.dev` y `cadb-admin.pages.dev`, con las mismas credenciales. El subdominio separa la organización y la UX, pero **no** es una barrera de seguridad.
6. **Keep-alive:** `keepalive.yml`, con un cron cada 3 días que llama a `POST /rest/v1/rpc/ping`. Se prueba el sistema el sábado antes de cada partido.
7. **Backup:** `backup.yml` semanal con `supabase db dump` por el pooler (modo session), que se commitea en un repo privado aparte. Se suman el PDF y el CSV mensuales.
8. **Entornos:** local con `supabase start` y un proyecto remoto, que primero es de demo y después de producción (ver §3.12).

### 3.11 Testing

**Vitest:**
- Dominio:
  - Totales y validación de los 4 dígitos.
  - Rangos de fecha (lunes a domingo, mes, último partido, zona San Juan).
  - `canManageUser` y `canAssignRole` con cada combinación de rangos.
- **Outbox** (con `fake-indexeddb`):
  - Orden FIFO de venta y anulación.
  - Retención por `user_id` distinto.
  - Bloqueo de logout con pendientes.
  - Reintento ante error de red y estado "Rechazada" ante un error de negocio.
  - Idempotencia ante una respuesta perdida.
- Un test que compara las claves de permisos de TS con las de la semilla SQL, leyendo el archivo de migración.
- Un smoke test de `BalancePdf`, que genera el PDF con datos de ejemplo y verifica que el blob no esté vacío.

**pgTAP:**
- Grants y acceso:
  - `anon` solo puede ejecutar `ping`.
  - Ningún rol puede escribir tablas directamente.
- Feature flags:
  - Sacar `stock.adjust` a `venta` hace fallar `adjust_stock`.
  - Agregar `balance.view` a `venta` habilita `balance_report`.
  - Owner siempre pasa.
  - Solo owner puede ejecutar `set_role_permission`.
- Jerarquía:
  - Admin no puede bajar, desactivar, resetear ni renombrar a otro admin, pero sí puede subir a un `venta` a admin.
  - Owner puede nombrar a otro owner.
  - **Nadie** (ni otro owner) puede bajar ni desactivar a un owner.
  - Nadie puede cambiar su propio rol.
- `register_sale`:
  - Es idempotente.
  - `created_by = auth.uid()`.
  - Las tres ramas de precio dan el precio y la marca correctos.
  - La ventana de fecha cambia según `sales.backdate`.
  - Se marcan `stock_negativo` y `producto_inactivo`.
  - La transferencia sin dígitos se rechaza.
- `void_sale`:
  - Con `void_own` no se puede anular la venta de otro ni una de hace más de 3 días.
  - Repone el stock.
  - Es idempotente.
- Compras:
  - `add_stock` exige el costo, y la nota en "Varios".
  - `void_stock_entry` revierte cantidad y costo.
- Se cumple el invariante del stock.
- `balance_report`: ingresos, egresos, separación por medio de pago y zona horaria.
- Toda RPC de escritura deja una fila en `audit_log`.

**Edge Function:** prueba manual guiada más 2 o 3 pruebas con `supabase functions serve` (alta, rollback y jerarquía).

**Pruebas en dispositivos** (manual, con checklist):
- Un Android con Chrome y un iPhone con Safari, con la app instalada en la pantalla de inicio.
- Vender en modo avión, cerrar la app, volver a abrirla, reactivar la señal y comprobar que se sincroniza.
- Sesión de más de 1 hora offline.
- Cambio de usuario con ventas pendientes.
- PDF compartido por WhatsApp e impreso.

**Prueba real:** 1 o 2 partidos en paralelo con el papel, después de que el club adopte el sistema.

### 3.12 Demo para el club y migración a cuentas del club

**Demo (propuesta):**
- Proyecto en las cuentas personales del owner, con `seed-demo.sql`:
  - Alrededor de 15 productos reales de cantina, más "Hielo", "Carbón" y "Varios".
  - Compras con costo.
  - Dos domingos de ventas de ejemplo, con algunas marcas.
- `scripts/create-demo-users.ts` crea `demo-venta` y `demo-admin` con claves conocidas.
- **Guion de unos 5 minutos:**
  1. Desde un teléfono, vender en efectivo y por transferencia.
  2. Activar el modo avión, vender, desactivarlo y ver cómo se sincroniza.
  3. Anular una venta con motivo.
  4. Cargar una compra de hielo.
  5. En el admin, cambiar un precio y ver su historial.
  6. Ver el balance del día y generar el PDF por WhatsApp.
  7. Ver el historial con las marcas.
  8. Abrir la matriz de permisos.
- Antes de la demo se borran los datos de ejemplo de los teléfonos que se usen.

**Migración al adoptarse:**
- Crear las cuentas del club con un email del club, transferir el repo de GitHub o crearlo de nuevo, crear un **proyecto Supabase nuevo** en la cuenta del club y aplicar las migraciones, sin los datos de la demo.
- Recrear los 2 proyectos de Pages en la cuenta Cloudflare del club y crear el owner con `create-owner`.
- No dependemos de transferir el proyecto Supabase entre cuentas. No lo verifiqué, y empezar limpio es más simple.
- Las URLs `*.pages.dev` pueden cambiar con la migración. Por eso conviene hacerla antes de repartir los accesos.

### 3.13 Fases de implementación

0. **Setup (½ día):**
   - Repo, Vite + Vue + TS, Pico y Vitest.
   - Raíces `ventas` y `admin`, Supabase CLI, proyecto de demo y 2 proyectos de Pages con un "hola mundo".
1. **Usuarios, permisos y seguridad:**
   - `profiles`, `permissions`, `role_permissions`, `audit_log`, grants y RLS.
   - `has_permission` y `my_permissions`.
   - RPC de usuarios y de matriz de permisos.
   - Edge Function, `create-owner`, login en los dos sitios y guards.
   - Pantallas de usuarios y de permisos.
   - pgTAP de flags y jerarquía.
2. **Inventario:**
   - `products`, `price_history`, `stock_movements`.
   - `create_product`, `update_product`, `set_price`, `add_stock` (con costo), `adjust_stock` y `void_stock_entry`.
   - Admin: ABM de productos y precios, con su historial.
   - Ventas: pantallas de Compras y de stock.
3. **Ventas online a través del outbox:**
   - `sales`, `sale_items`, `register_sale` (precio y marcas) y `void_sale`.
   - Caja mobile-first con hoja de cobro, medios de pago y aviso de stock negativo.
   - Pantalla "Mis ventas" con anulación.
   - Carga con fecha pasada (plan C).
4. **Offline:**
   - PWA, catálogo y permisos cacheados, reglas de sesión y bloqueo de logout, persistencia y prompt de actualización.
   - Checklist en dispositivos reales.
5. **Balance, historial y PDF:**
   - `balance_report`, pantalla con atajos e historial con filtros.
   - PDF con jsPDF (carga diferida) y CSV.
   - Prueba del PDF en Android y iOS.
6. **Operación:**
   - `ci.yml`, `keepalive.yml` y `backup.yml`.
   - README corto: crear usuarios, quitar un owner por SQL, qué hacer si Supabase se pausó y cómo restaurar un dump.
7. **Demo al club:** `seed-demo`, usuarios de demo y guion.
8. **Si el club lo adopta:** migración a sus cuentas (§3.12), carga de usuarios reales y prueba en cancha en paralelo con el papel.

### 3.14 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Pausa de Supabase Free | El domingo no anda la sincronización (la caja offline sigue funcionando) | `ping` cada 3 días, mail de aviso de Supabase, prueba el sábado |
| Grants, RLS o flags mal configurados | Escalada de privilegios o API con error 42501 | Escrituras solo por RPC, `has_permission` en cada RPC, pgTAP de flags y jerarquía |
| El vendedor no preparó el teléfono (no inició sesión con señal) | No puede vender offline | Checklist "abrir la app con señal antes del partido" y plan C con papel |
| Cola perdida (borrado de datos, teléfono perdido o iOS sin instalar la app) | Ventas sin registrar | Sincronización inmediata cuando hay señal, `storage.persist()`, instalar en la pantalla de inicio, sincronizar el mismo día, plan C |
| Service worker con una versión vieja | Comportamiento inconsistente | `_headers` con `no-cache` para `sw.js`, prompt de actualización sin operaciones pendientes |
| Catálogo con precios viejos offline | Diferencias de caja | Regla de precio con ventana de 3 días, marcas `precio_desactualizado` y `precio_distinto`, aviso "precios de hace X" |
| Usuario desactivado o sesión revocada con ventas en cola | Ventas rechazadas | Estado "Rechazada" visible, sin borrado, y recarga por un admin |
| El PDF no se comparte o descarga bien en algún teléfono | No hay reporte impreso | Tres vías de entrega (Web Share, descarga, pestaña nueva), CSV, prueba en dispositivos |
| Hay un solo owner y se va o pierde el acceso | Nadie puede bajar admins ni editar permisos | Las cuentas pasan al club al adoptarse. El owner puede nombrar a un segundo owner. El README tiene el SQL para nombrar o quitar un owner desde el dashboard |
| El owner nombra a otro owner por error | No se puede deshacer desde la web | Confirmación explícita en la UI y SQL manual documentado |
| Reloj del dispositivo mal configurado | Ventas en el día equivocado | Ventana acotada, `device_created_at` guardado y marca `fecha_corregida` |
| Sobre-ingeniería | El proyecto no se termina | El offline queda solo en la caja, la lista de permisos es fija, sin arqueo ni combos, y con fases cortas |

---

## 4. Preguntas abiertas (priorizadas)

1. **Teléfonos:** ¿cada voluntario vende con su propio teléfono, o hay un teléfono o tablet del club que se pasan entre ellos? Si es compartido, se cierra sesión al cambiar de turno y la cola retiene las ventas por usuario. ¿Hay iPhones entre los teléfonos? Así se sabe si la prueba en iOS es obligatoria.
2. **Pago mixto:** si alguien paga una parte en efectivo y otra por transferencia, la propuesta es registrar **dos ventas**. ¿Les sirve?
3. **Anulación por `venta`:** la propuesta es que pueda anular solo sus propias ventas de los últimos 3 días. ¿Está bien, o prefieren limitarlo al mismo día?
4. **Arqueo de caja:** ¿quieren cargar el efectivo inicial y final de cada jornada para compararlo con las ventas en efectivo? Hoy queda fuera del MVP.
5. **Insumos:** ¿alcanza con registrar el gasto (hielo, carbón), o quieren también controlar el stock de los insumos? Hoy solo se registra el gasto.
