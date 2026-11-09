# Plan final: Sistema de inventario y ventas de la cantina del CADB

Club Atlético Deportivo Barreal (Barreal, San Juan). Documento consolidado a partir de `plan.md` y `review.md`, revisados contra `idea.md`. Fecha: 2026-11-09.

---

## 1. Resumen

Una web interna, estática y gratuita, para reemplazar el lápiz y papel de la cantina. Tiene dos sitios: **ventas** (caja e ingreso de stock) y **admin** (productos, precios, balance y usuarios), con las mismas credenciales.

- **Stack:** Vue 3 + Vite + TypeScript, Pico CSS, **Supabase Free** (Postgres + Auth + RLS + una Edge Function) y **Cloudflare Pages**, con costo $0 usando `*.pages.dev`.
- **Seguridad:** los permisos se aplican en el servidor, con grants explícitos, RLS y funciones RPC `security definer`. El sign-up público queda desactivado y los usuarios se crean desde el panel admin mediante una Edge Function.
- **Ventas:** cada venta se registra en una sola transacción idempotente (UUID generado en el cliente). El precio lo pone siempre el servidor y cada movimiento de stock queda en un libro.
- **Proporción:** 3 módulos (`inventory`, `sales`, `users`), un solo `package.json` y el modo offline solo si la prueba en cancha lo justifica. Para los días sin señal hay un procedimiento con papel desde el MVP.

### Verificación de hechos (hecha por el árbitro con búsquedas web, 2026-11-09)

| Afirmación | Resultado |
|---|---|
| Supabase concedía por defecto `ALL` sobre tablas de `public` a `anon`/`authenticated` | **Verificado** (docs "Hardening the Data API"). Además, según el changelog oficial, desde el 30/05/2026 los proyectos nuevos **no** exponen tablas nuevas de `public` automáticamente, y desde el 30/10/2026 esto aplica a todos los proyectos. Conclusión: **los grants explícitos son obligatorios igual**, porque sin ellos la API devuelve error 42501, y con los grants viejos el `revoke` de columna no alcanza. El changelog no aclara qué pasa con `EXECUTE` sobre funciones, así que se revoca y se concede de forma explícita. |
| Supabase Free pausa proyectos tras ~1 semana de poca actividad | **Verificado** (docs "Project Pausing" y página de precios). Se puede restaurar desde el dashboard. Supabase manda un mail de aviso antes de pausar. |
| Supabase depreca las claves legacy `anon`/`service_role` y las reemplaza por publishable/secret keys | **Verificado** (docs "API keys": deprecación hacia fin de 2026). |
| Firebase: Cloud Functions (y por lo tanto el Admin SDK en servidor) requiere plan Blaze | **Verificado** (página de precios de Firebase). No verifiqué si el sign-up se puede desactivar sin Blaze vía Identity Platform. La conclusión no cambia. |
| Cloudflare Pages vs Workers Static Assets | **Parcialmente verificado.** Pages sigue funcionando y gratis, pero Cloudflare invierte en Workers Static Assets. No encontré un anuncio oficial de baja de Pages. |
| Free de Supabase sin backups descargables con retención | **No verificado** por el árbitro. Se asume que es así y se mitiga con un dump propio. |
| Límite de builds de Cloudflare Pages Free (500/mes) | **No verificado.** Es irrelevante para este volumen. |

---

## 2. Decisiones

| # | Tema/Hallazgo | Decisión | Motivo |
|---|---|---|---|
| R1 | `revoke update (stock)` de columna no alcanza con los grants de tabla | **Aceptado** | Verificado. Además, Supabase cambió el default y ya no expone tablas nuevas. En los dos casos la solución es la misma: `revoke all` y después grants explícitos, a nivel columna donde haga falta. Se suma un test pgTAP de "admin no puede tocar `stock` directo". |
| R1b | (Árbitro) Postgres concede `EXECUTE` a `PUBLIC` por defecto en funciones nuevas | **Aceptado (agregado)** | Sin esto, `anon` puede invocar las funciones RPC `security definer`. Se hace `revoke execute ... from public, anon` y `grant execute ... to authenticated` en cada función. Además, cada función valida `my_role()`. |
| R2 | Precio enviado por el cliente en ventas offline | **Aceptado** | Era un agujero real. El servidor usa **siempre** el precio vigente y el cliente nunca manda precio. Si hace falta, el precio cambia antes o después del partido. |
| R3 | `p_created_at` del dispositivo sin límites | **Aceptado (ajustado)** | Se acota: rol `venta` entre `now()-3 días` y `now()+5 min`. Rol admin/owner hasta 30 días atrás, para cargar ventas anotadas en papel. Fuera de rango se usa `now()`. Toda venta con hora distinta de la del servidor queda marcada (`backdated = true`). La columna tiene `default now()`. |
| R4 | Carrera "0 owners" y desactivación duplicada | **Aceptado** | Se crea el RPC `set_user_active` en SQL. `set_user_role` y `set_user_active` toman `pg_advisory_xact_lock` antes de contar owners. La regla de jerarquía vive solo en SQL. |
| R5 | Alta de usuario no atómica en la Edge Function | **Parcial** | Se valida el username antes y, si falla el insert del perfil, `auth.admin.deleteUser`. Se rechaza el trigger sobre `auth.users`: es más magia que beneficio para este tamaño. |
| R6 | `venta` puede hacer ajustes arbitrarios de stock | **Aceptado** | `idea.md` solo le da "ingresar stock" a `venta`. `add_stock` (cantidad > 0) lo pueden hacer todos los roles. `adjust_stock` (±, con nota obligatoria) es solo para admin/owner. Queda como pregunta de baja prioridad. |
| R7 | La lógica real vive en SQL y la "reemplazabilidad" está sobrevendida | **Parcial** | Se acepta decirlo con honestidad: el dominio TS es la especificación, sirve para la UX y es testeable; la aplicación de las reglas forma parte del adaptador del servidor. Cambiar de BaaS implica reescribir esas reglas. Se rechaza el `roles.cases.json` con generador de pgTAP por sobre-ingeniería. Alcanza con que ambos lados de tests se escriban desde la matriz §3.6, citada en comentarios. |
| R8 | Demasiados módulos, carpetas y puertos | **Aceptado (mayormente)** | Quedan 3 módulos y `reports` se fusiona en `sales`. Las entradas de las apps van como archivos sueltos en `src/app/`. Se fusionan `StockRepository` en `ProductRepository` y `ReportRepository` en `SaleRepository`. Quedan fuera del MVP Playwright, Cloudflare Access y staging. La regla de ESLint de imports queda como opcional, porque cuesta 5 líneas. La desviación de `src/client|server|shared` se justifica en §3.3 y no se le pregunta al usuario. |
| R9 | Keep-alive y backups vía GitHub Actions con detalles que fallan | **Aceptado** | Se agrega el RPC `public.ping()` ejecutable por `anon` (no expone datos), que el cron llama cada 3 días. Los dumps se hacen con el connection string del **pooler** (Supavisor, modo session), porque la conexión directa es IPv6 (afirmación del revisor, razonable, no verificada por mí). El dump comprimido se commitea en un **repo privado aparte**, porque los artifacts vencen. Si el workflow falla, GitHub manda un mail a la cuenta del club. |
| R10 | Claves legacy `anon`/`service_role` | **Aceptado** | Verificado. Se usan `VITE_SUPABASE_PUBLISHABLE_KEY` y la secret key solo en la Edge Function y en scripts locales. La Edge Function valida al llamador con `auth.getUser(token)` y no depende solo de `verify_jwt`. |
| R11 | Pages vs Workers, y fallback SPA con `ventas.html` | **Parcial** | Se mantiene **Cloudflare Pages**: sigue soportado, gratis y lo más simple con integración Git. Workers Static Assets queda como alternativa equivalente. El problema del `index.html` se resuelve con una carpeta raíz por sitio (`src/app/ventas/index.html`, `src/app/admin/index.html`), así cada build genera su propio `index.html`. Pages ya trae el comportamiento SPA si no hay `404.html`. |
| R12 | Plan B sin señal desde el MVP | **Aceptado** | Desde el MVP: si no hay señal, se anota en papel y después un admin carga las ventas con la fecha y hora del partido desde la misma caja (ver R3). Si la respuesta sobre la señal es "mala", la PWA con cola offline se adelanta a antes de la prueba en cancha. |
| R13 | Faltan columnas (`min_stock`, `sort_order`) y el orden de la migración | **Aceptado** | Es trivial y necesario. También se usa `bigint` en las sumas del reporte. |
| R14 | "Balance" probablemente significa ingresos − egresos | **Aceptado** | Pasa a ser la pregunta abierta #1. El modelo ya prevé `unit_cost` opcional. La tabla `expenses` se agrega solo si la respuesta es sí. |
| R15 | Afirmaciones desactualizadas sobre Firebase | **Aceptado** | Firestore sí tiene transacciones y agregaciones simples. El motivo del descarte pasa a ser: Admin SDK necesita Functions, Functions necesita Blaze (verificado), y los reportes con `group by` son incómodos. |
| R16 | Detalles de `register_sale` | **Aceptado** | Se bloquea por `id` ordenado, se rechazan productos inactivos y cantidades de 1 a 100, y si la venta ya existe se devuelve esa misma venta. |
| R17 | Semana y "último partido" | **Aceptado** | La semana va de lunes a domingo (zona San Juan). "Último partido" es el último día con ventas. |
| R18 | Renombrar, reactivar y cambiar la propia clave | **Aceptado** | Se agregan a la matriz. Reactivar sigue la misma jerarquía que desactivar. Cualquier usuario logueado puede cambiar su propia clave. |
| S1 | Backend: Supabase vs Firebase | **Supabase** | Sign-up desactivable, Edge Functions en el plan Free sin tarjeta, SQL transaccional para stock y reportes, RLS. |
| S2 | Hosting | **Cloudflare Pages** | Gratis, CDN, HTTPS, subdominios y deploy desde Git. CloudFront+S3 tiene costo y más configuración. |
| S3 | CSS | **Pico CSS v2** | Liviano, sin clases, botones grandes. |
| S4 | Stock negativo | **Permitir y señalar** | No se frena la venta en el partido. El balance lo marca para corregirlo con un ajuste. Queda confirmar con el club. |
| S5 | Login | **Usuario + contraseña** (email sintético `<usuario>@cadb.local`) | Es lo que pide `idea.md`, sin depender de que todos tengan email. |
| S6 | Offline | **MVP online + plan B papel. PWA/cola solo si hace falta** | Es proporcional. La idempotencia está desde el día 1, así que agregarlo después no rompe nada. |
| S7 | `package.json` | **Uno solo** | La Edge Function es un único archivo Deno y no necesita su propio `package.json`. |

---

## 3. Plan final

### 3.1 Alcance

**MVP:**
- Alta y edición de productos (nombre, precio, activo, orden, stock mínimo).
- Precio vigente en el producto, con una copia del precio guardada en cada línea de venta.
- Ingreso de stock (todos los roles) y ajustes (solo admin/owner).
- Caja de ventas táctil, con anulación de ventas.
- Balance por rango de fechas: hoy, último partido, semana, mes o personalizado. Exporta CSV e imprime.
- Login obligatorio, roles `venta`/`admin`/`owner` y usuarios creados solo desde el panel admin.
- Dos sitios (ventas y admin en subdominio) con las mismas credenciales.

**Fuera de alcance:** AFIP/facturación, Mercado Pago integrado, varias cantinas, proveedores, app nativa, Playwright, Cloudflare Access y staging.

### 3.2 Stack

| Pieza | Elección | Costo |
|---|---|---|
| Frontend | Vue 3 + Vite + TypeScript, `vue-router`, composables (sin Pinia) | $0 |
| CSS | Pico CSS v2 | $0 |
| Backend | Supabase Free: Postgres, Auth, RLS, 1 Edge Function | $0 |
| Hosting | Cloudflare Pages (2 proyectos) | $0 |
| Dominio | `*.pages.dev` gratis, u opcional `.com.ar` (costo anual bajo) | $0 / bajo |
| Tests | Vitest + pgTAP (`supabase test db`) | $0 |
| CI/cron | GitHub Actions (repo privado): tests, keep-alive y backup | $0 |

Firebase quedó descartado porque crear usuarios y asignar roles de forma segura requiere el Admin SDK en servidor, eso requiere Cloud Functions y Cloud Functions requiere el plan Blaze, que pide tarjeta. Además, los reportes agrupados son incómodos en Firestore. PocketBase, Appwrite, Sheets y un backend propio quedaron descartados por costo, mantenimiento o falta de seguridad real.

### 3.3 Arquitectura

```
web/ (Vue)  ->  domain/ (TS puro: entidades, reglas, casos de uso, puertos)  <-  infra/ (Supabase, IndexedDB)
```

- **Dominio:** TS sin imports de Vue ni de Supabase. Tiene `Product`, `StockMovement`, `Sale`, `SaleItem`, `User`, `Role`, reglas (`canChangeRole`, validación de venta, totales, rangos de fechas) y casos de uso.
- **Puertos (5):**
  - `ProductRepository`: list, get, create, update, addStock, adjustStock, listMovements.
  - `SaleRepository`: register (idempotente), void, listToday, getBalance.
  - `AuthService`: signIn, signOut, currentUser, onChange, changeOwnPassword.
  - `UserAdminService`: list, create, setRole, setActive, resetPassword.
  - `Clock`.
- **Infra:** adaptadores Supabase. Más adelante, `OfflineSaleQueue` decorando `SaleRepository`.
- **Composition root:** `src/shared/container.ts`, con `provide/inject`.
- **Sobre la reemplazabilidad:** la UI y el dominio no dependen de Supabase. Sin embargo, **la aplicación real de las reglas** (precio, descuento de stock, jerarquía de roles, reporte) está en SQL y es parte del adaptador del servidor. Cambiar de BaaS implica nuevos adaptadores **y** reescribir esas reglas en el nuevo backend. El `canChangeRole` del cliente solo decide qué botones mostrar. Los tests de ambos lados salen de la matriz §3.6.
- **Desviación de `idea.md`:** en lugar de `src/client`, `src/server` y `src/shared` como raíz de todo, los módulos de negocio cuelgan directo de `src/` (que es el ejemplo `src/inventory/{web,domain,infra}` de la propia idea) y el servidor vive en `src/server/`. Así hay un solo criterio, por módulo, y menos niveles.

### 3.4 Estructura de carpetas

```
cadb/
├─ package.json                # único
├─ vite.config.ts              # elige root según --mode ventas|admin
├─ tsconfig.json
├─ src/
│  ├─ inventory/{domain,infra,web}/   # productos, precios, stock
│  ├─ sales/{domain,infra,web}/       # caja, anulación, balance
│  ├─ users/{domain,infra,web}/       # login, roles, gestión de usuarios
│  ├─ shared/                         # container.ts, supabase-client.ts, money.ts, dates.ts, componentes base
│  ├─ app/
│  │  ├─ ventas/  index.html, main.ts, router.ts, App.vue
│  │  └─ admin/   index.html, main.ts, router.ts, App.vue
│  └─ server/supabase/
│     ├─ config.toml
│     ├─ migrations/                  # tablas, grants, RLS, funciones
│     ├─ functions/admin-users/index.ts
│     ├─ tests/                       # pgTAP
│     └─ seed.sql                     # solo local
└─ .github/workflows/                 # ci.yml, keepalive.yml, backup.yml
```

Los archivos van sueltos dentro de cada `domain/infra/web`, sin más niveles. `domain/` nunca importa de `infra/` ni de `web/` (opcionalmente con ESLint `no-restricted-imports`).

### 3.5 Modelo de datos (Postgres)

El dinero se guarda en pesos enteros (`integer`) y las sumas de reportes en `bigint`. Las fechas son `timestamptz` y los reportes usan la zona `America/Argentina/San_Juan`. El orden de creación es `profiles` → `products` → `sales` → `sale_items` → `stock_movements`.

```sql
profiles (
  id uuid pk references auth.users,
  username text unique not null,
  display_name text,
  role text not null check (role in ('venta','admin','owner')),
  active boolean not null default true,
  created_at timestamptz not null default now()
)

products (
  id uuid pk default gen_random_uuid(),
  name text unique not null,
  price integer not null check (price >= 0),
  stock integer not null default 0,          -- cache: solo lo modifican funciones
  min_stock integer null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)

sales (
  id uuid pk,                                 -- generado en el cliente (idempotencia)
  total integer not null,
  payment_method text null,                   -- según respuesta del club
  status text not null default 'ok' check (status in ('ok','anulada')),
  backdated boolean not null default false,   -- hora distinta a la del servidor
  created_by uuid not null references profiles,
  created_at timestamptz not null default now(),  -- hora de la venta (acotada, ver §3.7)
  synced_at timestamptz not null default now(),
  voided_by uuid null references profiles,
  voided_at timestamptz null
)

sale_items (
  sale_id uuid references sales,
  product_id uuid references products,
  quantity integer not null check (quantity between 1 and 100),
  unit_price integer not null,                -- copia del precio del servidor
  primary key (sale_id, product_id)
)

stock_movements (
  id uuid pk default gen_random_uuid(),
  product_id uuid not null references products,
  type text not null check (type in ('entrada','venta','ajuste','anulacion')),
  quantity integer not null,                  -- + entra / - sale
  unit_cost integer null,                     -- opcional (si balance = ingresos - costos)
  sale_id uuid null references sales,
  note text,                                  -- obligatoria en 'ajuste'
  created_by uuid not null references profiles,
  created_at timestamptz not null default now()
)
```

**Condicionales**, según las respuestas del club:
- `price_changes`: un trigger que guarda el historial de precios.
- `expenses(id, date, amount, description, created_by)`: si el balance incluye gastos sueltos.
- `cash_sessions`: si quieren arqueo de caja.

### 3.6 Autenticación, roles y cómo se aplican

**Login:**
- Supabase Auth con email sintético `<usuario>@cadb.local`. La UI pide solo "usuario".
- Confirmación de email desactivada y **sign-up público desactivado**.
- Contraseña mínima de 8 caracteres.
- La sesión queda guardada en el dispositivo y hay un botón visible de cerrar sesión.
- Claves: **publishable key** en el frontend y **secret key** solo en la Edge Function y en scripts locales.

**Matriz de permisos:**

| Acción | venta | admin | owner |
|---|:-:|:-:|:-:|
| Ver productos y stock | ✔ | ✔ | ✔ |
| Ingresar stock (cantidad > 0) | ✔ | ✔ | ✔ |
| Ajustar stock (±, nota obligatoria) | ✘ | ✔ | ✔ |
| Registrar venta | ✔ | ✔ | ✔ |
| Anular venta propia del día | ✔ (a confirmar) | ✔ (cualquiera) | ✔ |
| Cargar ventas con fecha pasada (≤ 30 días) | ✘ (solo ≤ 3 días, cola offline) | ✔ | ✔ |
| Crear/editar productos y precios | ✘ (a confirmar) | ✔ | ✔ |
| Ver balance | ✘ | ✔ | ✔ |
| Entrar al panel admin | ✘ | ✔ | ✔ |
| Crear usuario `venta`/`admin` | ✘ | ✔ | ✔ |
| Crear usuario `owner` | ✘ | ✘ | ✔ |
| Subir `venta` → `admin` | ✘ | ✔ | ✔ |
| Bajar `admin` → `venta` | ✘ | ✘ | ✔ |
| Desactivar/reactivar, resetear clave, renombrar a un `venta` | ✘ | ✔ | ✔ |
| Lo mismo sobre un `admin` u `owner` | ✘ | ✘ | ✔ |
| Asignar/quitar `owner` | ✘ | ✘ | ✔ (a confirmar) |
| Cambiar el propio rol o desactivarse | ✘ | ✘ | ✘ |
| Cambiar la propia contraseña | ✔ | ✔ | ✔ |
| Quedar con 0 owners activos | nunca | nunca | nunca |

**Aplicación en el servidor:**

1. **Grants explícitos** en la migración, sin depender de defaults. Se toma como verificado que el default de Supabase cambió en 2026.
   - En todas las tablas: `revoke all on <tabla> from anon, authenticated;`
   - `products`: `grant select` a `authenticated`, más `grant insert (name, price, min_stock, sort_order, active)` y `grant update (name, price, min_stock, sort_order, active)` a `authenticated`. Nunca sobre `stock`.
   - `profiles`, `sales`, `sale_items` y `stock_movements`: solo `grant select` a `authenticated`.
   - En todas las funciones: `revoke execute ... from public, anon;` y `grant execute ... to authenticated;`. La excepción es `ping()`, que se concede a `anon`.
2. **RLS activado en todas las tablas.** `public.my_role()` (`security definer`, `stable`, `search_path` fijo) devuelve el rol si `active`, o `null`. Políticas:
   - `products`: `select` para cualquier rol no nulo. `insert/update` solo si `my_role() in ('admin','owner')`.
   - `sales`, `sale_items`, `stock_movements`: `select` para admin/owner. Para `venta`, solo sus ventas del día.
   - `profiles`: `select` del propio perfil. Admin/owner ven todos.
   - No hay políticas de escritura en `profiles`, `sales`, `sale_items` ni `stock_movements`. Toda escritura pasa por funciones RPC.
3. **Funciones RPC** (`security definer`, `set search_path = ''`, validan `my_role()` al inicio):
   - `register_sale(p_sale_id, p_items jsonb [{product_id, quantity}], p_payment, p_created_at)`.
   - `void_sale(p_sale_id)`.
   - `add_stock(p_product_id, p_quantity > 0, p_unit_cost, p_note)`.
   - `adjust_stock(p_product_id, p_delta, p_note not null)` (admin/owner).
   - `sales_report(p_from date, p_to date)` (admin/owner).
   - `set_user_role(p_user_id, p_new_role)` y `set_user_active(p_user_id, p_active)` con la regla:
     ```
     actor := my_role(); target := rol actual de p_user_id
     actor no in (admin, owner)                    -> error
     p_user_id = auth.uid()                         -> error
     target = 'owner' o p_new_role = 'owner'        -> requiere actor = 'owner'
     target = 'admin' y (baja de rol o desactivar)  -> requiere actor = 'owner'
     pg_advisory_xact_lock(<const>); si el resultado deja 0 owners activos -> error
     ```
   - `can_manage_user(p_user_id)`: devuelve bool con la misma jerarquía. La usa la Edge Function antes de resetear la clave o renombrar.
   - `ping()`: devuelve `now()` y no toca datos.
4. **Edge Function `admin-users`**, la única pieza con secret key:
   - Valida al llamador con `auth.getUser(token)` y lee su rol.
   - `create`: valida rol y username, ejecuta `auth.admin.createUser({email, password, email_confirm: true})` e inserta el perfil. Si el insert falla, `auth.admin.deleteUser`.
   - `reset-password`: requiere `can_manage_user`.
   - `set-active`: llama a `set_user_active` con el JWT del usuario (así la regla es la de SQL) y, si funciona, aplica `ban_duration` en Auth para cortar las sesiones (o lo quita al reactivar).
5. **Owner inicial:** se crea una vez con `npm run create-owner`, un script local que usa la secret key desde una variable de entorno que nunca se commitea, o a mano desde el dashboard. Se recomiendan 2 owners.

### 3.7 Ventas y consistencia de stock

`register_sale` ocurre en una sola transacción:

1. Si `p_sale_id` ya existe, devuelve la venta existente con su total. Esa es la idempotencia.
2. Valida los ítems: productos `active`, cantidades entre 1 y 100, sin duplicados.
3. Hace `select ... for update` de los productos **ordenados por id**, para evitar deadlocks con varias cajas.
4. Toma el **precio del servidor** (el cliente nunca manda precio) y calcula el total.
5. Hora de la venta:
   - Para `venta`, se acepta `p_created_at` entre `now()-3d` y `now()+5min`.
   - Para admin/owner, entre `now()-30d` y `now()+5min`.
   - Fuera de rango se usa `now()`.
   - Si la hora final difiere más de 5 minutos de `now()`, la venta queda con `backdated = true`.
6. Inserta en `sales`, `sale_items` y `stock_movements` (`venta`, negativo), y ejecuta `update products set stock = stock - qty`.

Reglas generales:
- **Stock negativo:** se permite y se señala en la caja y el balance (a confirmar).
- **Anulación:** `void_sale` pone `status='anulada'`, guarda `voided_by/at` y crea movimientos `anulacion` positivos. No se borra nada.
- **Invariante:** `products.stock = sum(stock_movements.quantity)` por producto. Es una consulta de control en los tests, y los grants impiden romperla desde el cliente.

### 3.8 Balance

`sales_report(p_from, p_to)` (admin/owner, solo ventas `ok`, sumas en `bigint`) devuelve:
- Total vendido, cantidad de ventas y ticket promedio.
- Unidades y monto por producto.
- Monto por día.
- Monto por medio de pago, si se registra.
- Si la respuesta a la pregunta 1 es "sí": costo aproximado de lo vendido (con `unit_cost` de las entradas, último costo conocido) y gastos sueltos, para mostrar **ingresos − egresos**.

En la UI:
- Atajos de fecha: **Hoy**, **Último partido** (el último día con ventas), **Semana** (lunes a domingo), **Mes** y **Personalizado**. Todo en zona San Juan.
- En la misma pantalla, el stock actual con productos bajo `min_stock` o en negativo.
- Exportar CSV desde el cliente (para WhatsApp o Excel) e imprimir con `window.print()`.
- Sin vistas materializadas.

### 3.9 Conectividad (offline)

- **MVP:** online.
  - La caja muestra "Guardando… / Guardada / Error, reintentar" y genera el UUID en el cliente, así reintentar es seguro.
  - **Plan B sin señal:** se anota en papel y después un admin carga las ventas desde la caja eligiendo la fecha y hora del partido. Se permite una "venta agrupada", es decir producto × cantidad total.
  - Alternativas de hardware: router 4G o el WiFi del club.
- **Fase offline**, si la señal es mala (se adelanta antes de la prueba en cancha si el club ya sabe que no hay señal):
  - PWA con `vite-plugin-pwa`.
  - Catálogo cacheado en IndexedDB.
  - `OfflineSaleQueue`, que guarda en IndexedDB y reintenta con el evento `online` y con un intervalo.
  - Indicador "N ventas pendientes".
  - Solo la caja (y quizás el ingreso de stock) funciona offline.
  - La ventana de 3 días de R3 cubre la sincronización tardía.

### 3.10 Hosting y deploy (incluye el subdominio admin)

1. **Cuentas:** GitHub (repo privado), Supabase y Cloudflare, todas con un **email del club** y 2 personas con acceso.
2. **Supabase:**
   - Proyecto Free en la región más cercana (São Paulo).
   - `supabase db push --workdir src/server` y `supabase functions deploy admin-users`.
   - Auth: sign-up off, confirmación off, Site URL y Redirect URLs de los dos sitios.
   - Generar las publishable y secret keys nuevas. No usar las legacy.
3. **Cloudflare Pages**, dos proyectos desde el mismo repo:
   - `cadb-ventas`: build `npm run build:ventas`, output `dist/ventas` (contiene `index.html`).
   - `cadb-admin`: build `npm run build:admin`, output `dist/admin`.
   - Variables: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
   - Sin `404.html`, así Pages sirve `index.html` en cualquier ruta (SPA).
   - Alternativa equivalente: Workers Static Assets.
4. **Subdominio admin:**
   - Sin dominio propio ($0): `cadb-ventas.pages.dev` y `cadb-admin.pages.dev`.
   - Con dominio propio: `ventas.<dominio>` y `admin.<dominio>` como custom domains, con DNS gratis en Cloudflare.
   - Es la misma base Supabase, así que las credenciales son las mismas.
   - Si un usuario `venta` entra al admin, ve "No tenés permisos" y se cierra su sesión.
   - El subdominio es organización y UX, **no** una barrera de seguridad.
5. **Keep-alive:** `keepalive.yml` con cron cada 3 días que llama `POST /rest/v1/rpc/ping` usando la publishable key. Respaldo: el mail de aviso de pausa de Supabase y el instructivo para reanudar desde el dashboard. Probar el sistema el sábado antes del partido.
6. **Backup:** `backup.yml` semanal que ejecuta `supabase db dump --db-url <pooler session>`, lo comprime y lo commitea en un **repo privado aparte** `cadb-backups`. Además, el CSV mensual del balance. Las fallas del workflow llegan por mail a la cuenta del club.
7. **Entornos:** local con `supabase start` (Docker) y un único proyecto remoto de producción.

### 3.11 Testing (proporcional)

- **Vitest (dominio):**
  - `canChangeRole` con cada fila de la matriz §3.6.
  - Totales y validaciones.
  - Rangos de fecha: semana lunes-domingo, mes, último partido, zona San Juan.
  - Casos de uso con repositorios en memoria.
- **pgTAP (lo crítico):**
  - `venta` no puede: crear o editar productos o precios, ver el balance, cambiar roles, `adjust_stock`, ni tocar `stock` directo.
  - `admin` no puede tocar `stock` directo, ni con `update` ni con `insert` con stock.
  - `anon` no puede ejecutar ninguna RPC salvo `ping`.
  - Admin no puede bajar, desactivar ni resetear a otro admin. Owner sí.
  - Nadie se cambia el propio rol y nunca quedan 0 owners.
  - `register_sale`: usa el precio del servidor, descuenta stock, es idempotente (devuelve la misma venta), rechaza productos inactivos y acota `p_created_at` según el rol.
  - `void_sale` devuelve el stock.
  - Se cumple el invariante del stock.
  - `sales_report` suma bien y respeta la zona horaria.
- **Edge Function:** prueba manual guiada más 2-3 pruebas con `supabase functions serve`: crear, rollback si el username está duplicado y reset con jerarquía.
- **Prueba real:** 1-2 partidos en paralelo con el papel.

### 3.12 Fases de implementación

0. **Setup (½ día):**
   - Repo, Vite+Vue+TS, Pico, Vitest y las dos raíces `src/app/ventas|admin`.
   - Supabase CLI en `src/server`, proyecto remoto con las claves nuevas.
   - Dos proyectos Pages con un "hola mundo".
   - Confirmar con el club las preguntas 1-3.
1. **Usuarios y seguridad:**
   - `profiles`, grants base, `my_role`, RLS, `set_user_role`, `set_user_active`, `can_manage_user`, `ping`.
   - Edge Function `admin-users`, owner inicial, login en los dos sitios y guard del admin.
   - Pantalla de usuarios.
   - pgTAP de roles y grants.
2. **Inventario:**
   - `products`, `stock_movements`, `add_stock`, `adjust_stock`.
   - Admin: ABM de productos y precios, con orden y mínimo.
   - Ventas: pantalla de ingreso de stock y lista de stock.
3. **Ventas:**
   - `sales`, `sale_items`, `register_sale`, `void_sale`.
   - Caja con grilla de botones grandes, total, medio de pago (si aplica) y confirmar.
   - "Últimas ventas" del día con anulación.
   - Carga de ventas con fecha pasada para admin (plan B).
4. **Balance:** `sales_report`, pantalla con atajos, stock bajo o negativo, CSV e impresión. Si aplica, costos y gastos.
5. **Operación:** `ci.yml`, `keepalive.yml`, `backup.yml` y un README corto (crear usuarios, qué hacer si se pausó Supabase, cómo restaurar un dump).
6. **Prueba en cancha:** en paralelo con el papel. Ajustes de UX.
7. **Offline:** solo si la prueba o la respuesta sobre la señal lo justifican. Si la señal ya se sabe mala, va antes de la fase 6.

### 3.13 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Pausa de Supabase Free (~1 semana sin actividad, verificado) | El domingo no anda | Cron `ping` cada 3 días, mail de aviso de Supabase, instructivo de reanudación, prueba el sábado |
| Grants o RLS mal configurados (y el cambio de defaults de Supabase en 2026) | Un `venta` cambia precios o roles, o la API devuelve 42501 | Grants explícitos en la migración, `revoke execute` de funciones, pgTAP obligatorios |
| Mala señal en la cancha | Ventas sin registrar | Idempotencia desde el día 1, plan B papel con carga posterior, fase offline, router 4G |
| Reloj del dispositivo mal configurado | Ventas en el día equivocado | `p_created_at` acotado y marca `backdated` |
| Deprecación de claves legacy de Supabase | El frontend deja de autenticar | Publishable/secret keys desde el inicio |
| Cambios en los planes gratis (Supabase/Cloudflare) | Costos o migración | Frontend estático portable. Migrar el backend implica adaptadores nuevos **y** reescribir las reglas SQL (asumido) |
| Pérdida de datos | Se pierde el historial | Dump semanal a repo privado y CSV mensual |
| Owner sin acceso o que se va del club | Nadie puede bajar admins | 2 owners y cuentas a nombre del club |
| Dispositivo compartido | Ventas atribuidas a otra persona | Decisión del club: usuario "cantina" o uno por persona, más cierre de sesión |
| Nadie mantiene el sistema | Backups o cron rotos sin que nadie se entere | Mails de falla de GitHub a la cuenta del club y README de operación |
| Sobre-ingeniería | El proyecto no se termina | 3 módulos, fases cortas, offline y extras solo con evidencia |

---

## 4. Preguntas abiertas (priorizadas)

1. **Balance:** ¿alcanza con "lo vendido" o quieren **ingresos − egresos**? Si es lo segundo, ¿se carga el costo de compra al ingresar stock? ¿Y gastos sueltos como hielo o carbón?
2. **Conectividad y dispositivos:** ¿hay señal de celular o WiFi confiable en la cantina? ¿Con qué se vende (celular, tablet, notebook)? ¿Una sola caja o varias a la vez (barra y parrilla)? Si no hay señal, ¿está bien anotar en papel y que un admin cargue después las ventas con la fecha del partido?
3. **Usuarios:** ¿uno por persona o un usuario compartido "cantina"? ¿Alcanza con "usuario + contraseña", o alguien prefiere entrar con su email real?
4. **Owners:** ¿cuántos owners desde el inicio (se recomiendan 2)? ¿Un owner puede nombrar a otro owner y quitarle el rol?
5. **Precios:** ¿cambiar precios es solo de admin, o `venta` también puede durante el partido? ¿Quieren historial de cambios de precio?
6. **Medios de pago:** ¿registrar efectivo vs transferencia/Mercado Pago para cuadrar la caja? ¿Quieren un arqueo (efectivo inicial y final) por jornada?
7. **Anulaciones y ajustes:** ¿un `venta` puede anular sus propias ventas del día? ¿Puede corregir stock hacia abajo (roturas, faltantes), o eso queda solo para admin?
8. **Stock negativo:** ¿permitir vender sin stock cargado mostrando un aviso (propuesto), o bloquear la venta?
9. **Productos:** ¿hay combos (p. ej. choripán + gaseosa) que descuenten varios productos, o se manejan como un producto propio? ¿Se vende algo por porción o por kilo, o todo es por unidad?
10. **Dominio:** ¿el club tiene o quiere comprar un dominio (`.com.ar`, costo anual bajo), o alcanza con `cadb-ventas.pages.dev` / `cadb-admin.pages.dev` (gratis)?
11. **Cuentas y mantenimiento:** ¿qué email del club y qué 2 personas serán dueñas de las cuentas de GitHub, Supabase y Cloudflare? ¿Quién revisa que los backups y el keep-alive sigan funcionando?
