# Revisión del plan: Sistema de inventario y ventas para la cantina del CADB

Plan revisado: `.claude/plans/cantina-inventario-ventas/plan.md`
Contra: `idea.md`
Fecha: 2026-11-09

---

## Veredicto

**Aprobable con cambios.** El plan es sólido, cubre todos los requisitos de `idea.md`, elige bien el stack para "gratis + roles seguros" (Supabase con sign-up deshabilitado + RLS + Edge Function) y aplica los permisos en el servidor. No hay bloqueantes conceptuales. Hay **un problema técnico de seguridad concreto** que, tal como está escrito, no funcionaría (revocar `update (stock)` a nivel columna), **un agujero de manipulación de precios** introducido por la regla de "precio offline", y algunos puntos de consistencia (hora de venta enviada por el cliente, carrera en "último owner"). Por el lado de la simplicidad, la arquitectura es algo más pesada de lo que pide un club con <10 usuarios: conviene recortar módulos/carpetas y dejar varias cosas explícitamente como "no se hace".

---

## Hallazgos

### 1. [major] `revoke update (stock)` no tiene efecto con los grants por defecto de Supabase
- **Sección:** §6.3.2 (políticas de `products`).
- **Problema:** En Postgres, revocar un privilegio de **columna** no anula un privilegio de **tabla** ya concedido. Supabase concede por defecto `ALL` sobre las tablas de `public` a `anon` y `authenticated`. Por eso `revoke update (stock) on products from authenticated` no impide que un admin (que pasa la política RLS de `update`) haga `update products set stock = 9999` directo desde la consola del navegador. Pasa lo mismo con `insert`: un admin puede crear un producto con `stock` inicial arbitrario sin que quede movimiento. Eso rompe el invariante `products.stock = sum(stock_movements.quantity)` del §8.
- **Evidencia:** Documentación de Postgres sobre `GRANT/REVOKE`: los privilegios de columna se suman a los de tabla; revocar uno de columna no quita el de tabla. Esquema por defecto de Supabase: `grant all on all tables in schema public to anon, authenticated`.
- **Cambio sugerido:** En la migración, `revoke all on products from anon, authenticated;` y después `grant select on products to authenticated; grant insert (name, price, active), update (name, price, active) on products to authenticated;`. Para `sales`, `sale_items`, `stock_movements` y `profiles`, `revoke insert, update, delete` explícito además de no crear políticas (defensa en profundidad), y `revoke all ... from anon` en todas las tablas. Agregar un test pgTAP que intente `update products set stock` como admin y espere un error.

### 2. [major] La regla de "precio offline enviado por el cliente" permite vender a cualquier precio
- **Sección:** §8, tercer punto ("Precio en ventas offline").
- **Problema:** Si `register_sale` acepta el precio del cliente cuando la venta viene "marcada como offline", cualquier usuario `venta` puede llamar al RPC con esa marca y `unit_price = 0`. Esto contradice el punto 2 del mismo §8 ("el cliente no impone precios").
- **Evidencia:** La firma propuesta `register_sale(p_sale_id, p_items jsonb, ...)` con `p_items` que incluiría el precio en modo offline, y nada que valide ese precio en el servidor.
- **Cambio sugerido:** Usar **siempre** el precio del servidor (la "simplificación aceptable" del propio plan: los precios no cambian durante el partido). Si en el futuro hace falta, aceptar el precio del cliente solo cuando coincida con un precio que el producto tuvo en las últimas X horas (requiere `price_changes`); si no coincide, usar el del servidor y marcar la venta. Para el MVP: precio del servidor y nada más.

### 3. [major] `p_created_at` del dispositivo sin límites permite antedatar o postdatar ventas y deforma el balance
- **Sección:** §5 (`sales.created_at`), §6.3.3 (`register_sale`), §9.
- **Problema:** El balance usa `created_at`, que viene del cliente. Un reloj mal configurado (es común en celulares viejos o tablets compartidas) o un usuario malintencionado puede mandar ventas a otro día o mes. Tampoco hay `default`.
- **Cambio sugerido:** En `register_sale`, aceptar `p_created_at` solo si está entre `now() - interval '3 days'` y `now() + interval '5 minutes'`. Si no, usar `now()` y marcar la venta. Poner `default now()` en la columna. Así se sigue soportando la cola offline y la carga posterior de ventas anotadas en papel (ver hallazgo 12).

### 4. [minor] Carrera en "nunca quedar con 0 owners" y casos de desactivación de owners
- **Sección:** §6.3.3 (`set_user_role`), §6.3.4 (desactivar).
- **Problema:** Si dos owners se degradan entre sí al mismo tiempo, cada transacción ve "queda 1 owner" y ambas pasan: quedan 0 owners. La regla de "último owner" está en el RPC SQL, pero la **desactivación** está en la Edge Function, que también tiene que contar owners activos. Si no lo hace, un owner puede desactivar al último otro owner y quedarse solo (eso está bien), pero en la otra dirección la lógica queda duplicada en dos lugares.
- **Cambio sugerido:** En `set_user_role` y en la desactivación, tomar un lock (`select ... from profiles where role='owner' and active for update` o `pg_advisory_xact_lock`) antes de contar. Mejor todavía: que **desactivar/reactivar** también sea un RPC SQL (`set_user_active`), testeable con pgTAP, y que la Edge Function quede solo para lo que de verdad necesita `service_role` (crear usuario, resetear clave, `ban_duration`). Así la regla de jerarquía vive en un único lugar (SQL).

### 5. [minor] Creación de usuario no atómica en la Edge Function
- **Sección:** §6.3.4 (`create`).
- **Problema:** `auth.admin.createUser` y después el `insert` en `profiles` son dos operaciones. Si la segunda falla (username duplicado, por ejemplo), queda un usuario de Auth sin perfil. No es explotable (`my_role()` devuelve `null`), pero es basura que confunde al reintentar ("el email ya existe").
- **Cambio sugerido:** Validar el username antes. Si el insert falla, `auth.admin.deleteUser(id)`. Otra opción: un trigger `on auth.users insert` que cree el perfil leyendo el rol de `raw_app_meta_data` (nunca de `user_metadata`, que lo puede editar el usuario).

### 6. [minor] `venta` puede hacer "ajustes" de stock arbitrarios
- **Sección:** §6.2 (fila "Ingresar stock / ajustes"), §6.3.3 (`adjust_stock`).
- **Problema:** `idea.md` le da a `venta` "ingresar stock", no "ajustar". Un ajuste negativo libre permite tapar faltantes sin control. No es un requisito y abre una vía de error o abuso.
- **Cambio sugerido:** `venta`: solo `add_stock` con cantidad > 0. `adjust_stock` (positivo o negativo, con nota obligatoria): solo admin/owner. Confirmarlo con el club (agregar a preguntas abiertas).

### 7. [minor] La lógica de negocio central vive en SQL: el plan sobrevende la "reemplazabilidad"
- **Sección:** §3.1, §14 (fila "Cambios en planes gratuitos").
- **Problema:** `idea.md` pide que "todos los detalles de implementación estén bajo interfaces de dominio y sean reemplazables sin afectar el dominio". En el plan, las reglas reales (precio, descuento de stock, jerarquía de roles, reportes) se implementan en PL/pgSQL, y en TS hay una copia para la UX. Cambiar de Supabase obliga a reescribir esa lógica, no solo "adaptadores". Además, dos implementaciones de `canChangeRole` pueden divergir.
- **Cambio sugerido:** Decirlo honestamente en el plan: el dominio TS es la especificación y la parte de UX, y la aplicación de las reglas es parte del adaptador del servidor. Mantener una **tabla de casos única** (por ejemplo `roles.cases.json` en `src/users/domain/`) que consuman tanto Vitest como un generador simple de pgTAP, o al menos que los tests de los dos lados se escriban a partir de la misma lista de la §6.2. Reducir el `canChangeRole` del cliente a lo mínimo necesario para mostrar u ocultar botones.

### 8. [minor] Proporcionalidad: demasiados módulos y carpetas para el tamaño del proyecto
- **Sección:** §4, §3.1.
- **Problema:** 4 módulos × 3 capas + `shared` + `client/{ventas,admin}` + `server/supabase/{migrations,functions/admin-users,tests}` dan unas 20 carpetas. Varias `infra/` tendrán un único archivo, y `reports/domain` va a estar casi vacío (el reporte es una función SQL). Siete puertos para <10 usuarios. `idea.md` insiste: "evitar muchas carpetas", "énfasis en que debe ser simple".
- **Cambio sugerido:**
  - Fusionar `reports` dentro de `sales` (el balance es ventas + stock) o dentro de `inventory`. Quedan 3 módulos: `inventory`, `sales`, `users`.
  - Juntar `client/ventas` y `client/admin` en `src/app/` con `ventas.ts` y `admin.ts` (dos `main` + dos routers en archivos sueltos), o ponerlos en `users/web` / `shared`.
  - Fusionar `ReportRepository` en `SaleRepository` y `StockRepository` en `ProductRepository` si no hay motivo fuerte para separarlos.
  - Dejar explícitamente fuera del MVP: Playwright, Cloudflare Access, ESLint `no-restricted-imports` (opcional), staging.
  - La estructura `src/client` / `src/server` / `src/shared` de `idea.md` quedó mezclada con módulos en `src/`. Está bien desviarse, pero conviene justificarlo en una línea o adoptar `src/client/<modulo>/{web,domain,infra}`. Hoy hay dos criterios a la vez (por módulo y por client/server), y eso confunde.

### 9. [minor] Keep-alive y backups vía GitHub Actions: detalles que fallan en la práctica
- **Sección:** §11.5, §11.6.
- **Problema:**
  - Un `select` vía REST con la anon key contra tablas con RLS devuelve vacío. Probablemente igual cuenta como actividad, pero no está garantizado ni es verificable.
  - `pg_dump`/`supabase db dump` desde los runners de GitHub: la conexión directa de Supabase es solo IPv6 y los runners de GitHub no tienen IPv6. Hay que usar el connection string del **pooler (Supavisor, modo session)**.
  - Los artifacts de Actions vencen (90 días como máximo). Un "backup" que expira no sirve como historial.
  - En repos **públicos**, los cron de Actions se desactivan tras 60 días sin actividad. El plan usa repo privado, así que no aplica, pero conviene anotarlo por si alguien lo hace público.
- **Cambio sugerido:** Crear una función `public.ping()` ejecutable por `anon` que devuelva `now()`, y que el keep-alive llame a `rpc/ping`. Hacer el backup con el string del pooler y commitear el dump comprimido en un repo privado aparte (o en una rama `backups`). Con el volumen de datos esperado, cabe sin problema. Agregar una alerta: si el workflow falla, GitHub manda mail al dueño de la cuenta del club.

### 10. [minor] Claves de Supabase: el plan usa el esquema "legacy" (anon/service_role)
- **Sección:** §6.4, §11.3.
- **Problema:** Supabase está migrando a **publishable keys / secret keys** (`sb_publishable_…`, `sb_secret_…`) y anunció la deprecación de las claves JWT legacy `anon`/`service_role`. Un proyecto nuevo en noviembre de 2026 debería usar las nuevas. Esto cambia algo el comportamiento de `verify_jwt` en Edge Functions.
- **Cambio sugerido:** Verificar al iniciar el estado actual de las claves en la documentación de Supabase, usar `VITE_SUPABASE_PUBLISHABLE_KEY` y, en la Edge Function, validar el JWT del usuario con `supabase.auth.getUser(token)` (o `getClaims`) en lugar de depender solo de `verify_jwt`.

### 11. [minor] Cloudflare Pages vs Workers Static Assets, y detalle del build multi-página
- **Sección:** §2.3, §11.3.
- **Problema:** Cloudflare viene empujando "Workers + Static Assets" como reemplazo de Pages. Pages sigue funcionando y es gratis, pero conviene confirmarlo al iniciar. Además, con `vite build --mode ventas` y entrada `ventas.html`, el output tiene `ventas.html`, no `index.html`: el fallback `/* /index.html 200` apuntaría a un archivo inexistente.
- **Cambio sugerido:** Que cada modo genere `index.html` (por ejemplo, `root` distinto por modo, o renombrar en el build), o usar `createWebHashHistory` y olvidarse del fallback. En Pages, si no hay `404.html`, el comportamiento SPA ya viene por defecto. Mencionar Workers Static Assets como alternativa equivalente (también gratis).

### 12. [minor] Plan B operativo cuando no hay señal en el MVP
- **Sección:** §10 (fase 1), §13.
- **Problema:** El MVP es solo online y el offline queda para la "fase 6, si hace falta". El riesgo de mala señal en una cancha de Barreal es alto y conocido. Sin un procedimiento definido, el primer domingo sin señal la gente vuelve al papel y no hay forma cómoda de cargar después lo vendido.
- **Cambio sugerido:** Definir desde el MVP un procedimiento simple: si no hay señal, se anota en papel y después un admin carga las ventas con "fecha/hora del partido" (para eso sirve `p_created_at` acotado, hallazgo 3) usando la misma pantalla de caja. Una "venta agrupada" (producto × cantidad total por jornada) alcanza. Preguntar en la Fase 0 por la señal real (pregunta abierta 3) y, si es mala, subir la PWA con cola offline antes de la Fase 5. La cola es chica: IndexedDB + reintento.

### 13. [minor] Faltan columnas que el propio plan usa
- **Sección:** §5, §9, §13 (Fase 5).
- **Problema:** §9 habla de "productos bajo mínimo", pero `products` no tiene `min_stock`. La Fase 5 habla de "orden de productos / favoritos" en la grilla de caja, pero no hay `sort_order` ni categoría. `stock_movements` referencia a `sales` antes de que se declare (orden de la migración).
- **Cambio sugerido:** Agregar `min_stock integer null` y `sort_order integer default 0` a `products`. Declarar `sales` antes que `stock_movements`. Sumar los totales del reporte en `bigint`.

### 14. [minor] Interpretación de "balance"
- **Sección:** §9, §15.
- **Problema:** En un club de barrio, "balance" suele significar **ingresos menos egresos** (lo que se gastó en mercadería), no solo "total vendido". El plan lo deja como "opcional: costo y ganancia".
- **Cambio sugerido:** Plantearlo como pregunta principal (no secundaria). Si la respuesta es sí, `unit_cost` en las entradas de stock alcanza para un "costo de lo vendido" aproximado. Un "gasto suelto" (hielo, carbón, sin producto) requeriría una tabla mínima `expenses`. Preguntar antes de decidir.

### 15. [nit] Afirmaciones sobre Firebase algo desactualizadas
- **Sección:** §2.2.
- **Problema:** Firestore sí tiene transacciones y, desde 2023, agregaciones `count/sum/average` en servidor (sin `group by`). Con Identity Platform se puede deshabilitar el sign-up del cliente sin Blaze. Lo que sigue siendo cierto es que crear usuarios y asignar custom claims requiere Admin SDK, o sea Functions, o sea Blaze. La conclusión no cambia.
- **Cambio sugerido:** Ajustar el texto para que el descarte se base en "Admin SDK requiere Blaze + reportes con `group by` incómodos", no en "no tiene transacciones ni agregaciones".

### 16. [nit] Detalles de `register_sale`
- **Sección:** §8.
- **Cambio sugerido:** Bloquear los productos ordenados por `id` para evitar deadlocks entre dos cajas. Rechazar productos `active = false` y cantidades fuera de rango (por ejemplo, > 100). Si el `p_sale_id` ya existe, devolver la venta existente (no solo "OK") para que la UI muestre el total real.

### 17. [nit] Semana y zona horaria
- **Sección:** §9, §12.
- **Cambio sugerido:** Fijar que la semana empieza el lunes (o que "semana" = últimos 7 días) y que "último partido" = el último día con ventas. Evita discusiones y tests ambiguos.

### 18. [nit] Edición de username/display name y reactivación
- **Sección:** §6.2.
- **Problema:** La matriz no dice quién puede renombrar o reactivar usuarios, ni si un admin puede resetear su propia clave.
- **Cambio sugerido:** Agregar estas filas: reactivar sigue la misma jerarquía que desactivar; cambiar la propia clave lo puede hacer cualquiera logueado (`auth.updateUser`).

---

## Lo que el plan hace bien

- Elige Supabase por los motivos correctos: sign-up deshabilitable, Edge Functions gratis, SQL transaccional para stock y reportes. Costo real $0 con `*.pages.dev`.
- Aplica los permisos en el servidor (RLS + RPC `security definer` + `search_path` fijo). El subdominio admin se trata como UX, no como barrera de seguridad.
- La regla de roles está bien escrita: admin no baja admins, solo owner toca owners, nadie cambia su propio rol, y se protege el último owner. Además extiende la regla a **desactivar** y **resetear clave**, lo que cierra la vía de tomar la cuenta de otro admin.
- Idempotencia de ventas con UUID de cliente desde el día 1, precio snapshot, anulación sin borrar y libro de movimientos.
- Dinero en enteros, zona `America/Argentina/San_Juan` y CSV para WhatsApp: pensado para el usuario real.
- Riesgos operativos realistas: pausa de Supabase, cuentas a nombre del club, dispositivo compartido, prueba en paralelo con papel.
- Un solo `package.json`, y la Edge Function mínima en Deno.
- Las preguntas abiertas están bien elegidas.

---

## Preguntas adicionales para el usuario

1. **Balance = ¿solo ventas o ingresos − gastos?** ¿Se registran gastos de la cantina (compra de mercadería, hielo, carbón) en el sistema?
2. **Ajustes de stock:** ¿el rol `venta` debe poder corregir stock hacia abajo (roturas, faltantes) o solo cargar entradas?
3. **Plan B sin señal:** si un domingo no hay conexión, ¿está bien anotar en papel y que un admin cargue después las ventas con la fecha del partido?
4. **Cantidad de cajas simultáneas:** ¿una sola persona/dispositivo vende, o varios al mismo tiempo (barra y parrilla)?
5. **Estructura de carpetas:** ¿se acepta fusionar `reports` dentro de `sales` (3 módulos en total) y simplificar `client/ventas` / `client/admin` a archivos sueltos, para tener menos carpetas?
6. **¿Quién mantiene el sistema** a futuro (actualizar dependencias, revisar si falló el backup)? Define cuánto automatizar (alertas por mail) versus documentar.
7. **Owners múltiples:** ¿dos owners desde el inicio (recomendado, para no depender de una persona)?
