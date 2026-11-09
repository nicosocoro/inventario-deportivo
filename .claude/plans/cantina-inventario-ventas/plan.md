# Plan: Sistema de inventario y ventas para la cantina del CADB

Club Atlético Deportivo Barreal (Barreal, San Juan). Basado en `idea.md`.

---

## 1. Objetivos y alcance

**Objetivo:** dejar de usar lápiz y papel para el stock y las ventas de la cantina en los partidos de local, con una web interna simple, barata (idealmente $0) y que puedan usar pocas personas sin capacitación.

**En alcance (MVP):**
- Alta y edición de productos (nombre, precio, activo/inactivo).
- Configuración de precios (el precio vigente se guarda en el producto; cada venta guarda una copia del precio al momento de vender).
- Ingreso de stock (entradas) y ajustes (roturas, pérdidas, conteo).
- Registro de ventas (pantalla tipo "caja": tocar productos, cantidades, confirmar).
- Balance por rango de fechas con atajos diario / semanal / mensual: total vendido, unidades por producto, ventas por día, stock actual.
- Login obligatorio. Roles `venta`, `admin`, `owner`. Usuarios creados solo desde el panel admin.
- Dos "sitios": ventas y panel admin (subdominio), con las mismas credenciales.

**Fuera de alcance (por ahora):** facturación/AFIP, pagos integrados (Mercado Pago), múltiples cantinas/sucursales, proveedores y compras con facturas, app nativa, diseño "fancy".

**Principio rector:** simple. Si una decisión agrega complejidad que un club de barrio no va a aprovechar, se descarta.

---

## 2. Elección de stack

### 2.1 Resumen de la recomendación

| Pieza | Elección | Costo |
|---|---|---|
| Framework | Vue 3 + Vite + TypeScript | $0 |
| CSS | Pico CSS v2 (classless/semántico, ~10 KB) | $0 |
| Backend (BaaS) | **Supabase** (Postgres + Auth + Row Level Security + Edge Functions), plan Free | $0 |
| Hosting estático | **Cloudflare Pages** (CDN global, ancho de banda ilimitado, plan Free) | $0 |
| Dominio | Opcional: dominio propio `.com.ar` (pago anual a NIC Argentina, bajo costo) o subdominios gratis `*.pages.dev` | $0 o costo bajo anual |
| Tests | Vitest (dominio) + `supabase test db` (pgTAP) para reglas de seguridad | $0 |
| CI/CD | Integración Git de Cloudflare Pages (build automático al hacer push) o GitHub Actions | $0 |

> Verificar al iniciar el proyecto los límites vigentes de los planes free (cambian con el tiempo). A la fecha de este plan, el free de Supabase incluye 2 proyectos, 500 MB de base de datos, 50.000 usuarios activos mensuales y Edge Functions con cuota generosa; el free de Cloudflare Pages incluye 500 builds/mes y ancho de banda ilimitado. Para este uso (decenas de ventas por domingo, <10 usuarios) estamos varios órdenes de magnitud por debajo.

### 2.2 Backend: alternativas consideradas

**Firebase (Auth + Firestore)** — la opción mencionada en `idea.md`.
- Pros: muy conocido, acceso directo desde la web, plan Spark gratuito, hosting incluido.
- Contras para *este* caso:
  - Crear usuarios desde un panel con "sign-up deshabilitado" y asignar roles de forma segura requiere el **Admin SDK**, es decir Cloud Functions, que **solo existen en el plan Blaze** (pago por uso, exige tarjeta de crédito; la cuota gratuita suele alcanzar pero hay riesgo de costos por error y pequeños cargos de Artifact Registry/Cloud Build).
  - Los workarounds sin Functions (crear usuarios con una "segunda app" del SDK cliente) obligan a dejar el sign-up habilitado, lo que contradice "NO crear usuarios desde la web".
  - Firestore no tiene transacciones SQL ni agregaciones flexibles: el balance (sumas por producto/día/rango) se vuelve código cliente o contadores desnormalizados.
- Veredicto: viable, pero más frágil en seguridad de roles y en reportes, y empuja a Blaze.

**Supabase** — recomendado.
- Auth con opción "Allow new users to sign up" **desactivable**; los usuarios se crean con la Admin API desde una Edge Function (incluidas en el plan Free, sin tarjeta).
- Postgres: transacciones reales para descontar stock al vender, constraints, y reportes con SQL (`group by`, rangos de fechas, zona horaria).
- Row Level Security (RLS) + funciones `security definer`: las reglas de roles se aplican en la base, no en la UI.
- Contra principal: **los proyectos Free se pausan tras ~7 días sin actividad**. Si hay partidos de local cada 2 semanas, el proyecto se pausaría. Mitigación: un cron gratuito de GitHub Actions que haga una consulta liviana cada 3-4 días (o reactivar manualmente desde el dashboard, que tarda unos minutos). Ver riesgos.

**Otras descartadas:**
- *PocketBase en un VPS/Fly.io:* muy simple, pero requiere servidor propio (costo o mantenimiento) y backups manuales.
- *Appwrite Cloud:* similar a Supabase, menor familiaridad y reportes menos cómodos que SQL.
- *Google Sheets como backend:* gratis, pero sin seguridad de roles real ni transacciones.
- *Backend propio (Node + SQLite) en un servidor:* contradice "web estática + BaaS" y suma mantenimiento.

### 2.3 Hosting: alternativas

- **Cloudflare Pages (recomendado):** gratis, CDN, HTTPS automático, dominios custom y subdominios, deploy desde Git, previews por rama.
- *CloudFront + S3:* funciona, pero tiene costo (bajo, no cero tras el free tier de 12 meses en cuentas viejas) y más configuración (OAC, certificados ACM en us-east-1, invalidaciones).
- *Firebase Hosting / Netlify / GitHub Pages:* también gratis. GitHub Pages no soporta bien dos sitios con subdominios distintos desde un mismo repo; Netlify tiene límites de ancho de banda más bajos. Cualquiera es reemplazable porque el frontend es estático.

### 2.4 Frontend

- **Vue 3 + Vite + TypeScript**, Composition API, `vue-router`. Sin Pinia salvo que haga falta (composables alcanzan).
- **Pico CSS**: estiliza HTML semántico sin clases, botones grandes y legibles, dark mode automático. Alternativas: Water.css (más mínimo, menos control), Bulma (más pesado), Tailwind (requiere más decisiones de diseño; no aporta a una app interna).
- **PWA** con `vite-plugin-pwa` (fase 2) para instalarla en el celular/tablet de la cantina y tolerar cortes de conexión.

---

## 3. Arquitectura

### 3.1 Capas

```
Presentación (web/)  ->  Dominio (domain/)  <-  Infraestructura (infra/)
     Vue                 entidades, reglas,        Supabase, IndexedDB,
                         casos de uso, puertos     implementaciones de puertos
```

- **Dominio**: TypeScript puro, sin imports de Vue ni de Supabase. Contiene entidades (`Product`, `Sale`, `SaleItem`, `StockMovement`, `User`, `Role`), reglas (p. ej. `canChangeRole(actor, target, newRole)`, validación de una venta, cálculo de totales) y **casos de uso** (`registerSale`, `addStock`, `createProduct`, `getBalance`, `createUser`, `changeUserRole`).
- **Puertos (interfaces de dominio)** — el dominio depende de esto, no de Supabase:
  - `ProductRepository` (list, get, create, update)
  - `StockRepository` (addEntry, adjust, listMovements)
  - `SaleRepository` (register(sale) — atómico e idempotente, list)
  - `ReportRepository` (getBalance(range))
  - `AuthService` (signIn, signOut, currentUser, onChange)
  - `UserAdminService` (list, create, changeRole, deactivate, resetPassword)
  - `Clock` (para fechas/zona horaria testeable)
- **Infraestructura**: `SupabaseProductRepository`, `SupabaseSaleRepository`, `SupabaseAuthService`, etc. Más adelante `OfflineSaleQueue` (IndexedDB) que decora a `SaleRepository`.
- **Composition root**: un único archivo (`src/shared/container.ts`) que instancia las implementaciones y las expone a Vue vía `provide/inject`. Cambiar Supabase por Firebase u otro implica escribir nuevos adaptadores en `infra/` y tocar solo este archivo.

**Importante sobre seguridad:** las reglas de dominio en el cliente (p. ej. `canChangeRole`) sirven para la UX (ocultar botones, mensajes claros). **La aplicación real de permisos está en el servidor** (RLS, funciones SQL y Edge Functions). El dominio cliente y el servidor implementan la misma regla; los tests verifican ambos lados.

### 3.2 Dos sitios, un código

- Un solo proyecto Vite con **dos entradas HTML** (multi-page): `ventas.html` y `admin.html` (o `index.html` + `admin/index.html`). Cada una monta su propia app Vue con su router, compartiendo dominio, infra y componentes.
- Se publican como **dos proyectos de Cloudflare Pages** desde el mismo repo (mismo build, distinto directorio/entrada) o un único proyecto donde la app elige según `location.hostname`. Recomendación: dos builds (`vite build --mode ventas` / `--mode admin`) para que el bundle de ventas no incluya pantallas de admin. Es poco costo extra y queda más claro.
- Mismo proyecto Supabase para ambos ⇒ mismas credenciales en los dos sitios. Al entrar al panel admin con un usuario `venta`, se muestra "No tenés permisos" y se cierra sesión (y aunque se forzara la UI, el servidor rechaza las operaciones).

---

## 4. Estructura de carpetas

Combina lo pedido (`src/client`, `src/server`, `src/shared` + módulos con `web/domain/infra`) manteniéndolo plano. Propuesta: los módulos de negocio viven directamente bajo `src/`, el server bajo `src/server`.

```
cadb/
├─ package.json               # único package.json (client + scripts del server)
├─ vite.config.ts             # multi-page: ventas + admin
├─ tsconfig.json
├─ ventas.html
├─ admin.html
├─ src/
│  ├─ inventory/              # productos, precios, stock
│  │  ├─ domain/              # product.ts, stock.ts, ports.ts, use-cases.ts, *.test.ts
│  │  ├─ infra/               # supabase-product-repo.ts, supabase-stock-repo.ts
│  │  └─ web/                 # ProductsPage.vue, StockEntryPage.vue, ProductForm.vue
│  ├─ sales/                  # registrar ventas
│  │  ├─ domain/              # sale.ts, ports.ts, use-cases.ts, *.test.ts
│  │  ├─ infra/               # supabase-sale-repo.ts, (fase 2) offline-sale-queue.ts
│  │  └─ web/                 # PosPage.vue, SalesListPage.vue
│  ├─ reports/                # balance
│  │  ├─ domain/
│  │  ├─ infra/
│  │  └─ web/                 # BalancePage.vue
│  ├─ users/                  # auth, roles, gestión de usuarios
│  │  ├─ domain/              # user.ts, roles.ts (canChangeRole...), ports.ts
│  │  ├─ infra/               # supabase-auth.ts, supabase-user-admin.ts
│  │  └─ web/                 # LoginPage.vue, UsersPage.vue
│  ├─ shared/                 # container.ts, supabase-client.ts, money.ts, dates.ts, componentes base
│  ├─ client/                 # entradas de las apps
│  │  ├─ ventas/              # main.ts, router.ts, App.vue
│  │  └─ admin/               # main.ts, router.ts, App.vue
│  └─ server/                 # todo lo de Supabase (CLI con --workdir src/server)
│     └─ supabase/
│        ├─ config.toml
│        ├─ migrations/       # SQL: tablas, RLS, funciones (register_sale, set_user_role, sales_report)
│        ├─ functions/
│        │  └─ admin-users/   # Edge Function (Deno): crear usuario, reset de clave, desactivar
│        ├─ tests/            # pgTAP: tests de RLS y roles
│        └─ seed.sql          # datos de desarrollo + owner inicial (solo local)
└─ .github/workflows/         # (opcional) CI de tests + keep-alive de Supabase
```

Reglas: máximo un nivel debajo de `web/domain/infra`; si un módulo crece poco, sus archivos quedan sueltos en esa carpeta. `domain/` nunca importa de `infra/` ni de `web/` (se puede reforzar con una regla de ESLint `no-restricted-imports`).

> Nota: las Edge Functions corren en Deno y no comparten `package.json`; se mantienen mínimas (un archivo) para no necesitar un segundo `package.json`.

---

## 5. Modelo de datos (Postgres)

Dinero en **enteros (pesos, sin decimales)** o centavos (`bigint`) para evitar errores de redondeo. Fechas en `timestamptz`; reportes en zona `America/Argentina/San_Juan`.

```sql
profiles (
  id uuid pk references auth.users,
  username text unique not null,
  display_name text,
  role text not null check (role in ('venta','admin','owner')),
  active boolean not null default true,
  created_at timestamptz default now()
)

products (
  id uuid pk default gen_random_uuid(),
  name text unique not null,
  price integer not null check (price >= 0),     -- precio vigente
  stock integer not null default 0,               -- stock actual (cache consistente, ver §8)
  active boolean not null default true,
  created_at, updated_at
)

stock_movements (                                  -- libro de movimientos (auditoría)
  id uuid pk,
  product_id uuid references products,
  type text check (type in ('entrada','venta','ajuste','anulacion')),
  quantity integer not null,                       -- + entra, - sale
  unit_cost integer null,                          -- opcional, para calcular ganancia
  sale_id uuid null references sales,
  note text,
  created_by uuid references profiles,
  created_at timestamptz default now()
)

sales (
  id uuid pk,                                      -- generado en el CLIENTE (idempotencia offline)
  total integer not null,
  payment_method text null,                        -- 'efectivo' | 'transferencia' (a confirmar)
  status text default 'ok' check (status in ('ok','anulada')),
  created_by uuid references profiles,
  created_at timestamptz,                          -- hora real de la venta (del dispositivo)
  synced_at timestamptz default now()
)

sale_items (
  sale_id uuid references sales,
  product_id uuid references products,
  quantity integer check (quantity > 0),
  unit_price integer not null,                     -- snapshot del precio
  primary key (sale_id, product_id)
)
```

Opcional (si se quiere historial de precios): `price_changes(product_id, old_price, new_price, changed_by, changed_at)` cargado por trigger. Barato de agregar; se propone como pregunta abierta.

---

## 6. Autenticación, roles y seguridad

### 6.1 Login
- Supabase Auth con email + contraseña. Como el club quiere "usuario y contraseña", se usa un **email sintético** `<usuario>@cadb.local` (la UI pide solo "usuario"; el adaptador `SupabaseAuthService` arma el email). Confirmación de email desactivada; los usuarios se crean ya confirmados. Si alguien prefiere su email real, también funciona.
- **Sign-up público desactivado** en Supabase (Auth → "Allow new users to sign up" = off). Con esto, aunque alguien llame a la API pública de sign-up con la anon key, falla.
- Sesión persistente en el dispositivo (refresh token), para no pedir login en cada venta. Botón "Cerrar sesión" visible.

### 6.2 Matriz de permisos

| Acción | venta | admin | owner |
|---|:-:|:-:|:-:|
| Ver productos y stock | ✔ | ✔ | ✔ |
| Ingresar stock / ajustes | ✔ | ✔ | ✔ |
| Registrar venta | ✔ | ✔ | ✔ |
| Anular venta propia del día | ✔ (a confirmar) | ✔ | ✔ |
| Crear/editar productos y precios | ✘ | ✔ | ✔ |
| Ver balance | ✘ | ✔ | ✔ |
| Entrar al panel admin | ✘ | ✔ | ✔ |
| Crear usuarios `venta`/`admin` | ✘ | ✔ | ✔ |
| Subir `venta` → `admin` | ✘ | ✔ | ✔ |
| Bajar `admin` → `venta` / desactivar admin | ✘ | ✘ | ✔ |
| Asignar o quitar `owner` | ✘ | ✘ | ✔ (a confirmar) |
| Cambiar su propio rol | ✘ | ✘ | ✘ |

Nota: "configurar precios" figura en el alcance pero no en la lista de "Venta"; se asume que es de admin (pregunta abierta).

### 6.3 Cómo se aplica en el servidor
1. **RLS activado en todas las tablas.** Una función `public.my_role()` (`security definer`, `stable`) devuelve el rol del `auth.uid()` si `active = true`, o `null`.
2. Políticas:
   - `products`: `select` para cualquier rol; `insert/update` solo si `my_role() in ('admin','owner')`. **No** se permite `update` directo de `stock` desde el cliente: se revoca el privilegio de columna (`revoke update (stock) on products from authenticated`), el stock solo cambia vía funciones.
   - `sales`, `sale_items`, `stock_movements`: sin `insert/update/delete` directo; todo pasa por funciones RPC. `select` para admin/owner (y para venta, solo sus ventas del día, para mostrar "últimas ventas").
   - `profiles`: `select` del propio perfil para todos; de todos para admin/owner. **Sin `update/insert/delete` para `authenticated`** — los cambios de rol pasan por `set_user_role`.
3. Funciones RPC (`security definer`, con `search_path` fijo, validando `my_role()` al inicio):
   - `register_sale(p_sale_id uuid, p_items jsonb, p_payment text, p_created_at timestamptz)` — venta/admin/owner.
   - `add_stock(p_product_id, p_quantity, p_unit_cost, p_note)` y `adjust_stock(...)` — venta/admin/owner.
   - `void_sale(p_sale_id)` — según matriz.
   - `sales_report(p_from, p_to)` — admin/owner.
   - `set_user_role(p_user_id uuid, p_new_role text)` con la regla:
     ```
     actor := my_role();  target := role actual de p_user_id
     si actor no in (admin, owner)            -> error
     si p_user_id = auth.uid()                -> error (no cambiar el propio rol)
     si target = 'owner' o p_new_role = 'owner' -> requiere actor = 'owner'
     si target = 'admin' y p_new_role <> 'admin' -> requiere actor = 'owner'   -- "admin no puede quitar admin a otro"
     si no                                     -> ok (admin puede subir venta->admin)
     además: nunca dejar el sistema con 0 owners activos
     ```
     La misma regla aplica a **desactivar** un usuario admin (solo owner) y a **resetear la contraseña** de un admin (solo owner; si no, un admin podría tomar la cuenta de otro admin).
4. **Edge Function `admin-users`** (única pieza con `service_role`, que nunca llega al navegador):
   - Recibe el JWT del llamador, lo verifica, lee su rol en `profiles`.
   - `create`: crea el usuario con `auth.admin.createUser({ email, password, email_confirm: true })` e inserta `profiles` con el rol pedido, aplicando la regla (admin puede crear `venta` y `admin`; solo owner crea `owner`).
   - `reset-password`, `deactivate` (además de `active=false`, `ban_duration` en Auth para cortar sesiones), siguiendo la misma regla de jerarquía.
   - El cambio de rol puede ir por aquí también para centralizar; recomendación: rol vía RPC SQL (testeable con pgTAP), creación/clave/baja vía Edge Function.
5. **Owner inicial**: se crea una sola vez a mano (dashboard de Supabase o script `npm run create-owner` que usa la service key localmente, nunca commiteada).

### 6.4 Otros puntos de seguridad
- La anon key es pública por diseño; la seguridad está en RLS. Test automatizado que verifique que con un usuario `venta` fallan: insertar producto, cambiar precio, leer balance, cambiar roles, actualizar `stock` directo.
- Secretos (`service_role`) solo en variables de entorno de Supabase Functions y en la máquina del owner.
- Contraseñas: mínimo 8 caracteres (config de Supabase Auth).

---

## 7. Panel admin en subdominio

- Con dominio propio (p. ej. `cantina.cadb.com.ar` o `cadb.com.ar`): `ventas.<dominio>` y `admin.<dominio>`, cada uno como custom domain de su proyecto de Cloudflare Pages. DNS en Cloudflare (gratis).
- Sin dominio propio (costo $0): `cadb-ventas.pages.dev` y `cadb-admin.pages.dev`. Técnicamente son subdominios distintos; cumple el requisito con cero costo.
- En Supabase Auth se agregan ambas URLs a "Site URL / Redirect URLs".
- El subdominio admin **no es una barrera de seguridad** (es organización/UX). La seguridad la dan login + RLS + funciones.
- Opcional: Cloudflare Access (gratis hasta 50 usuarios) delante del admin como segunda capa. Probablemente innecesario; se menciona solo como opción.

---

## 8. Ventas y consistencia de stock

- Una venta = **una llamada RPC** `register_sale`, que corre en **una transacción** Postgres:
  1. Si ya existe `sales.id = p_sale_id` → devuelve OK sin hacer nada (**idempotencia**: reintentos por mala señal no duplican ventas).
  2. Bloquea las filas de productos involucrados (`select ... for update`), lee el **precio vigente del servidor** (el cliente no impone precios) y calcula el total.
  3. Inserta `sales`, `sale_items` (con `unit_price` snapshot) y `stock_movements` (tipo `venta`, cantidad negativa).
  4. `update products set stock = stock - qty`.
- **¿Stock negativo?** Recomendación: **permitirlo pero señalarlo** (la cantina no puede dejar de vender un choripán porque alguien olvidó cargar stock; además, con modo offline, rechazar ventas ya cobradas no tiene sentido). El balance muestra productos con stock negativo como alerta para corregir con un ajuste. Pregunta abierta si se prefiere bloquear.
- Precio en ventas offline: si el precio cambió entre que se anotó offline y se sincronizó, se respeta el precio que vio el vendedor (enviado por el cliente) solo en modo offline, marcando la venta. Simplificación aceptable: los precios no cambian durante el partido. Se documenta como decisión en el código.
- Anulación: `void_sale` marca `status='anulada'`, inserta movimientos `anulacion` que devuelven stock. No se borra nada (auditoría).
- `products.stock` es un cache que siempre se actualiza en la misma transacción que el movimiento; se puede verificar con una consulta `sum(stock_movements.quantity)` (test/consulta de control).

---

## 9. Balance / reportes

- Función SQL `sales_report(p_from date, p_to date)` (admin/owner) que devuelve:
  - Total vendido, cantidad de ventas, ticket promedio.
  - Por producto: unidades y monto.
  - Por día: monto (útil para el semanal/mensual).
  - Por medio de pago (si se registra).
  - Opcional: costo y ganancia estimada si se cargan costos en las entradas de stock.
- Rangos calculados en zona `America/Argentina/San_Juan`. Atajos en la UI: **Hoy**, **Este domingo/último partido**, **Semana**, **Mes**, **Personalizado**.
- Stock actual y productos bajo mínimo/negativos en la misma pantalla.
- **Exportar CSV** (generado en el cliente) para compartir por WhatsApp o abrir en Excel. Imprimir con `window.print()` y CSS de impresión simple.
- Volúmenes ínfimos: no hace falta tablas de agregados ni vistas materializadas.

---

## 10. Conectividad en la cantina (offline)

Barreal es un pueblo; la señal móvil en la cancha puede ser mala. Propuesta en dos niveles:

- **MVP (fase 1):** online. La venta muestra claramente "Guardando… / Guardada / Error, reintentar". El `id` de la venta se genera en el cliente (UUID) desde el día 1, así los reintentos son seguros. Alternativa de bajo costo: un router 4G o el WiFi del club.
- **Fase 2 (si en la prueba real hay cortes):**
  - PWA con service worker (`vite-plugin-pwa`): la app abre sin conexión.
  - Catálogo de productos y precios cacheado en IndexedDB al iniciar sesión/entrar con señal.
  - `OfflineSaleQueue` (adaptador de `SaleRepository`): guarda la venta en IndexedDB y la envía cuando vuelve la conexión (evento `online` + reintento periódico). Indicador visible: "3 ventas pendientes de sincronizar".
  - Como `register_sale` es idempotente, no hay duplicados. La sesión de Supabase se refresca al volver la señal (el refresh token dura lo suficiente).
  - Solo ventas (y quizás entradas de stock) funcionan offline; gestión de productos, usuarios y balance requieren conexión.
- Esto es exactamente donde la arquitectura por puertos rinde: el dominio y la UI no cambian, solo se agrega un adaptador.

---

## 11. Deploy y hosting

1. Repo en GitHub (privado, gratis).
2. **Supabase:** crear proyecto Free (región más cercana disponible, p. ej. São Paulo `sa-east-1`). Aplicar migraciones con `supabase db push --workdir src/server`. Deploy de la función con `supabase functions deploy admin-users`. Configurar Auth: sign-up off, confirmación de email off, URLs de redirect.
3. **Cloudflare Pages:** dos proyectos conectados al repo:
   - `cadb-ventas`: build `npm run build:ventas`, output `dist/ventas`.
   - `cadb-admin`: build `npm run build:admin`, output `dist/admin`.
   - Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
   - Regla SPA fallback (`_redirects`: `/* /index.html 200`).
4. Entornos: `supabase start` local (Docker) para desarrollo y tests; un solo proyecto remoto de producción (el segundo proyecto free podría ser "staging", pero probablemente no vale la pena).
5. **Backups:** el plan Free no incluye backups descargables con retención garantizada. Mitigación: GitHub Action semanal con `supabase db dump` (o `pg_dump`) guardado como artifact/repo privado, más la exportación CSV manual del balance mensual.
6. **Keep-alive:** GitHub Action con cron cada 3 días que hace un `select` liviano vía REST, para evitar la pausa por inactividad.

---

## 12. Estrategia de testing (proporcional)

- **Dominio (Vitest):** reglas de roles (`canChangeRole` con toda la matriz), cálculo de totales, validaciones de venta/producto, rangos de fechas del balance (zona horaria, semana/mes). Casos de uso probados con repositorios **in-memory** (fakes que implementan los puertos) — también prueban que el dominio no depende de Supabase.
- **Base de datos (pgTAP con `supabase test db`):** lo más importante, porque ahí vive la seguridad:
  - Usuario `venta` no puede crear productos, cambiar precios, ver balance, cambiar roles ni tocar `stock` directo.
  - Admin no puede bajar a otro admin ni desactivarlo ni resetear su clave; owner sí; nadie cambia su propio rol; no se puede quedar sin owners.
  - `register_sale` descuenta stock, guarda snapshot de precio, y llamada repetida con el mismo id no duplica.
  - `sales_report` suma correctamente y respeta zona horaria.
- **Edge Function:** test manual guiado + 2-3 tests con el runtime local (`supabase functions serve`).
- **E2E:** opcional, un smoke test con Playwright (login → venta → ver balance). No imprescindible.
- **Prueba real:** usar el sistema en paralelo con el papel en 1-2 partidos antes de abandonar el papel.

---

## 13. Fases de implementación

**Fase 0 — Setup (½ día)**
- Repo, Vite + Vue + TS, Pico CSS, Vitest, ESLint (regla de imports de dominio), multi-page ventas/admin.
- Supabase CLI local en `src/server`, proyecto remoto, Cloudflare Pages con deploy de un "hola mundo" en ambos subdominios.

**Fase 1 — Usuarios y seguridad (base de todo)**
- Migración `profiles`, `my_role()`, RLS, `set_user_role`.
- Edge Function `admin-users` (crear, reset clave, desactivar).
- Owner inicial. Login en ambos sitios; guard de rol en el admin.
- Pantalla admin "Usuarios". Tests pgTAP de roles.

**Fase 2 — Inventario**
- `products`, `stock_movements`, `add_stock`, `adjust_stock`.
- Admin: ABM de productos y precios. Ventas: pantalla "Ingresar stock". Lista de stock actual.

**Fase 3 — Ventas**
- `sales`, `sale_items`, `register_sale` (transaccional, idempotente), `void_sale`.
- Pantalla de caja: grilla de botones grandes por producto, contador, total, medio de pago, confirmar. "Últimas ventas" del día con anulación.

**Fase 4 — Balance**
- `sales_report`, pantalla con atajos de rango, tabla por producto/día, stock negativo/bajo, exportar CSV, imprimir.

**Fase 5 — Prueba en cancha y ajustes**
- Usar en un partido en paralelo con papel. Ajustar UX (tamaño de botones, orden de productos, favoritos).

**Fase 6 — Offline (solo si hace falta)**
- PWA, cache del catálogo, `OfflineSaleQueue`, indicador de pendientes.

**Fase 7 — Operación**
- Backups automáticos, keep-alive, README corto de operación (cómo crear usuarios, qué hacer si el proyecto se pausó, cómo restaurar).

---

## 14. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Pausa del proyecto Supabase Free por inactividad (>7 días) | El domingo no anda | Cron keep-alive en GitHub Actions; instructivo para reactivar; probar el sistema el sábado |
| Mala señal en la cancha | Ventas no registradas / lentitud | UUID de venta e idempotencia desde fase 1; fase 6 offline; router 4G o WiFi del club |
| Cambios en planes gratuitos (Supabase/Cloudflare) | Costos inesperados | Arquitectura por puertos: migrar a otro BaaS = nuevos adaptadores + SQL; frontend estático portable a cualquier hosting |
| Pérdida de datos (sin backups en Free) | Se pierde historial | Dump semanal automático + CSV mensual |
| Errores de permisos (RLS mal escrita) | Un usuario venta modifica precios/roles | Tests pgTAP obligatorios para cada regla; revocar privilegios por defecto |
| Owner pierde acceso / se va del club | Nadie puede bajar admins | Permitir más de un owner; documentar recuperación vía dashboard Supabase (cuenta del club, no personal) |
| Dispositivo compartido en la cantina | Ventas atribuidas a quien dejó la sesión abierta | Usuario "cantina" genérico de rol venta, o cierre de sesión al terminar; decisión del club |
| Cuenta de Supabase/Cloudflare/GitHub a nombre de una persona | Dependencia de una persona | Crear cuentas con un email institucional del club, con 2 personas con acceso |
| Sobre-ingeniería | Proyecto que no se termina | Fases cortas; offline y extras solo si la prueba real lo justifica |

---

## 15. Preguntas abiertas para el club

1. **Dominio:** ¿el club tiene o quiere comprar un dominio (`.com.ar`, costo anual bajo)? ¿O alcanza con `cadb-ventas.pages.dev` / `cadb-admin.pages.dev` (gratis)?
2. **Frecuencia de uso:** ¿cada cuánto hay partidos de local? (define si el keep-alive de Supabase es imprescindible).
3. **Conectividad:** ¿hay señal de celular o WiFi confiable en la cantina? ¿Qué dispositivo se usa (celular, tablet, notebook)? ¿Uno solo o varios a la vez?
4. **Precios:** ¿"configurar precios" es solo de admin, o el rol venta también puede cambiarlos (p. ej. durante el partido)? ¿Se quiere historial de cambios de precio?
5. **Medios de pago:** ¿registrar efectivo vs transferencia/Mercado Pago para cuadrar la caja?
6. **Costos y ganancia:** ¿se quiere cargar el costo de compra al ingresar stock para ver ganancia en el balance, o solo ventas?
7. **Stock negativo:** ¿permitir vender sin stock cargado (y avisar) o bloquear la venta?
8. **Anulaciones:** ¿quién puede anular una venta mal cargada? ¿Solo el mismo día?
9. **Owner:** ¿cuántos owners? ¿Un owner puede nombrar a otro owner o quitarle el rol? ¿Puede un admin crear otro admin directamente (asumido: sí)?
10. **Usuarios:** ¿login con "usuario" (email interno generado) o con email real? ¿Usuario compartido para la cantina o uno por persona?
11. **Cierre de caja:** ¿se quiere un "arqueo" (efectivo inicial/final declarado vs vendido) por jornada? Es un agregado chico pero útil.
12. **Productos elaborados/combos** (p. ej. "choripán + gaseosa"): ¿existen? ¿Descuentan stock de varios productos o se manejan como producto propio?
13. **Unidades fraccionadas** (venta por porción, kilo): ¿hace falta o todo es por unidad?
14. **Cuentas:** ¿quién será dueño de las cuentas de GitHub/Supabase/Cloudflare? Recomendado: email del club.
