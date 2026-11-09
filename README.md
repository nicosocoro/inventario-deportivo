# Cantina CADB

Inventario y ventas de la cantina del **Club Atlético Deportivo Barreal** (Barreal, San Juan).
Web estática y gratuita, pensada para usar desde el teléfono. Plan completo: [.claude/plans/cantina-inventario-ventas/final-plan.md](.claude/plans/cantina-inventario-ventas/final-plan.md).

- **Ventas** (`cadb-ventas.pages.dev`): caja, compras, stock e insumos, "Mis ventas". Es una PWA: **funciona sin señal** y sincroniza después.
- **Admin** (`cadb-admin.pages.dev`): balance (PDF y CSV), productos y precios, ventas, historial, usuarios, permisos y ajustes. Necesita conexión.

Mismo usuario y contraseña en los dos sitios. Nadie se registra solo: los usuarios los crea un admin.

Pendientes: [pruebas](docs/pruebas-pendientes.md) · [decisiones](docs/decisiones-pendientes.md).

## Stack

Vue 3 + Vite + TypeScript · Pico CSS · Supabase Free (Postgres, Auth, RLS, 1 Edge Function) · Cloudflare Pages · jsPDF (se carga solo al exportar). Costo: $0.

## Estructura

```
src/
  inventory/{domain,infra,web}   productos, precios, compras, consumo, ajustes
  sales/{domain,infra,web}       caja, pagos, cola offline, anulaciones, balance, PDF, historial
  users/{domain,infra,web}       login, roles, permisos, usuarios, ajustes
  shared/                        composition root (container.ts), cliente Supabase, fechas, dinero, componentes base
  app/ventas, app/admin          entrada de cada sitio (index.html, main.ts, router.ts, App.vue)
  server/supabase/               migraciones SQL, Edge Function admin-users, seeds, config
  server/tests/                  tests de base de datos (Postgres real en WASM, sin Docker)
scripts/                         create-owner, create-demo-users, gen-icons
```

- `domain/` es TypeScript puro (sin Vue ni Supabase). `infra/` implementa los puertos de `domain/ports.ts`. Las implementaciones se eligen solo en `src/shared/container.ts`.
- **Las reglas que importan se aplican en la base** (`migrations/*_functions.sql`): precios, pagos, stock, permisos, jerarquía de roles, ventanas de anulación y auditoría. Los clientes solo tienen `SELECT`; toda escritura pasa por funciones RPC. Cambiar de backend implica reescribir esas reglas.

## Desarrollo

```bash
npm install
cp .env.example .env        # completar con el proyecto Supabase
npm run dev:ventas          # http://localhost:5173
npm run dev:admin           # http://localhost:5174
npm test                    # dominio + base de datos (PGlite) + PDF/CSV
npm run typecheck
npm run build               # dist/ventas y dist/admin
```

Supabase local completo (opcional, requiere Docker): `npm run db:start`.

## Puesta en marcha

1. **Supabase** (plan Free, región São Paulo):
   - Auth → Providers → Email: **desactivar "Allow new users to sign up"** y la confirmación de email.
   - Auth → URL Configuration: Site URL y Redirect URLs con las dos URLs de Pages.
   - Settings → API Keys: usar la **publishable key** (frontend) y la **secret key** (solo scripts y Edge Function). No usar las claves legacy.
   - Migraciones: `npx supabase link --project-ref <ref> --workdir src/server` y `npm run db:push`.
   - Edge Function: `npx supabase secrets set SB_SECRET_KEY=<secret> SB_PUBLISHABLE_KEY=<publishable> --workdir src/server` y `npm run fn:deploy`.
2. **Owner inicial** (una vez): completar `.env` y `npm run create-owner -- <usuario> <contraseña> "Nombre"`.
3. **Cloudflare Pages**, dos proyectos desde este repo:
   - `cadb-ventas`: build `npm run build:ventas`, output `dist/ventas`.
   - `cadb-admin`: build `npm run build:admin`, output `dist/admin`.
   - Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`. Sin `404.html` (funciona como SPA).
4. **GitHub Actions** (repo privado): secrets `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` (keep-alive cada 3 días, para que Supabase no pause el proyecto) y, para el backup semanal, `SUPABASE_DB_URL` (pooler, modo session), `BACKUP_REPO` y `BACKUP_REPO_TOKEN`.

## Uso en la cancha

**Instalar la app (cada vendedor, en su teléfono):**
- **iPhone:** abrir el sitio de ventas en Safari → **Compartir** → **Agregar a inicio** → abrir desde el ícono e **iniciar sesión ahí** (la app instalada no comparte la sesión con Safari).
- **Android:** menú ⋮ → **Instalar app**.

**Antes del partido:** abrir la app instalada **con señal** (descarga precios y permisos). En *Más → Estado del teléfono* tiene que decir 0 pendientes.
**Al terminar:** abrir la app con señal hasta ver **0 pendientes**. En iPhone las ventas se envían solo con la app abierta.
**Cierre de caja:** contar el efectivo y compararlo con el efectivo del balance del día (total o por vendedor).
**Sin señal y sin app preparada:** anotar en papel; después alguien con permiso `sales.backdate` carga esas ventas desde la caja (opción "Venta de otro momento").

## Roles y permisos

- Cada permiso es un flag por rol (`venta`, `admin`) que el owner prende o apaga en *Admin → Más → Permisos*. El owner tiene todo siempre.
- Reglas fijas: un admin no le quita el rol a otro admin; nadie gestiona a un owner desde la web; nadie cambia su propio rol.
- **Quitar un owner** (solo a mano, en el SQL Editor):
  ```sql
  update public.profiles set role = 'admin' where username = '<usuario>';
  ```
- El límite de minutos para que un vendedor anule su propia venta (por defecto 60, siempre el mismo día) se cambia en *Admin → Más → Ajustes*.

## Operación

- **Supabase se pausó** (pasa tras ~1 semana sin uso si falla el keep-alive): Dashboard → proyecto → *Restore*. Probar el sábado antes de cada partido.
- **Restaurar un backup:** `gunzip` del dump y ejecutarlo con `psql "<connection string>" -f archivo.sql` sobre un proyecto vacío con las migraciones aplicadas (primero `*-schema.sql` si es un proyecto nuevo, después `*-data.sql`).

## Demo para el club

1. En un proyecto Supabase de demo: migraciones, Edge Function y `npm run create-demo-users` (`demo-venta`, `demo-venta2`, `demo-admin`).
2. Pegar `src/server/supabase/seed-demo.sql` en el SQL Editor: ~15 productos, insumos, compras y dos domingos de ventas.
3. Guion: vender en efectivo, transferencia y mixto; modo avión, vender y volver a conectar; anular una venta; cargar una compra de hielo y "Usé 1"; en el admin cambiar un precio, ver el balance y generar el PDF por WhatsApp; mostrar el historial y los permisos.

## Licencia

[MIT](LICENSE) © 2026 Nicolas Socoro. Cualquiera puede usar, copiar, modificar y distribuir el código, siempre que conserve el aviso de copyright y la licencia.
