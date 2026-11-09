# Pruebas pendientes

Lo que los tests automáticos (81, con Postgres real en WASM) **no** cubren. Ninguna de estas pruebas se hizo todavía: el sistema no se corrió contra un proyecto Supabase real ni en un navegador.

Marcá cada ítem al terminarlo y anotá el resultado.

## 1. Puesta en marcha con Supabase real

Requisito para todo lo demás. Pasos en el [README](../README.md#puesta-en-marcha).

- [ ] Las migraciones aplican sin errores (`npm run db:push`).
  - Si ya se aplicaron antes en algún proyecto, **reaplicarlas**: cambió `register_sale` (se agregó un lock para ventas simultáneas). Opción: nueva migración con `create or replace function`.
- [ ] Supabase Auth acepta los emails sintéticos `<usuario>@cadb.local` al crear usuarios. Si los rechaza, cambiar `EMAIL_DOMAIN` en `src/shared/supabase-client.ts`, `scripts/supabase-admin.ts` y la Edge Function.
- [ ] Con el sign-up público desactivado, nadie puede registrarse desde la web.
- [ ] `npm run create-owner` crea el owner y puede entrar a los dos sitios.

## 2. Edge Function `admin-users` (no se probó nunca)

- [ ] Un admin crea un usuario `venta` y un `admin` desde *Admin → Más → Usuarios*.
- [ ] Un admin **no** puede crear un owner. El owner sí, con el aviso "no se puede quitar desde la web".
- [ ] Usuario repetido: muestra el error y no deja un usuario a medias en Auth.
- [ ] Resetear la contraseña de un `venta` (admin) y de un `admin` (solo owner).
- [ ] Desactivar un usuario: no puede volver a entrar. Si tenía la sesión abierta, sus ventas pendientes quedan **rechazadas** (visibles), no se pierden. Reactivarlo le devuelve el acceso.
- [ ] Todo lo anterior aparece en *Historial* con el usuario que lo hizo.

## 3. iPhone (obligatorio)

En tu iPhone, con la app **instalada** (Safari → Compartir → Agregar a inicio).

- [ ] La guía de instalación aparece al abrir el sitio en Safari y desaparece en la app instalada.
- [ ] Iniciar sesión **dentro de la app instalada**. Verificar que la sesión de Safari no se comparte.
- [ ] *Más → Estado del teléfono*: anotar qué devuelve "Almacenamiento persistente".
- [ ] Teclado numérico en cantidades, montos y últimos 4 dígitos. Sin zoom al tocar un campo. La barra inferior y la de total respetan la zona del gesto de inicio.
- [ ] **Venta sin señal:** modo avión → vender en efectivo, transferencia y mixto (ver el autocompletado) → cerrar la app del todo → sacar el modo avión → abrir la app → sincroniza sola ("0 pendientes").
- [ ] **Anular sin señal** una venta del día y sincronizar después.
- [ ] **Sesión vencida sin señal:** entrar, esperar más de 1 hora (o poner en el pasado `expires_at` de la sesión en el almacenamiento local), modo avión, abrir la app → tiene que abrir **enseguida en la caja** y dejar vender. Al volver la señal **no** tiene que mandar al login. El aviso "No pudimos validar tu sesión" puede aparecer un momento y tiene que irse solo.
- [ ] **PDF del balance** (desde el sitio admin, en Safari y como app): "Generar PDF" y después "Compartir PDF" abren la hoja de compartir (WhatsApp, Archivos, Imprimir). Si aparece "Tocá Compartir de nuevo", el segundo toque tiene que funcionar.
- [ ] **CSV del balance**: se comparte o se abre, y los acentos se ven bien en Excel / Numbers.
- [ ] Pantalla encendida en la caja (solo iOS 18.4 o superior; si no funciona, no es grave).
- [ ] Actualización de la app: con una versión nueva publicada aparece "Actualizar", pero **no** mientras haya ventas pendientes.

## 4. Android

- [ ] Instalar la app (menú ⋮ → Instalar app).
- [ ] Repetir: venta sin señal, anulación sin señal, PDF y CSV compartidos por WhatsApp.

## 5. Señal mala y concurrencia (con Supabase real)

- [ ] Con señal lenta o intermitente, un pedido se corta a los 15 s y el próximo sync reintenta **sin** dejar ventas rechazadas ni duplicadas.
- [ ] Dos teléfonos vendiendo el mismo producto al mismo tiempo: el stock final es correcto.
- [ ] Una venta que llega con un precio viejo (catálogo de hace horas) queda con la marca correspondiente y el pago mixto ajusta el efectivo.

## 6. Operación

- [ ] El workflow `keepalive.yml` corre y responde 200 (probar con *Run workflow*).
- [ ] El workflow `backup.yml` genera el dump en el repo privado de backups.
- [ ] **Simulacro de restore** en el proyecto de demo. Confirmar si el dump `--data-only` incluye `auth.users` (`profiles` depende de esa tabla); si no, documentar cómo restaurar los usuarios.
- [ ] Las versiones de las GitHub Actions (`checkout@v4`, `setup-node@v4`, `supabase/setup-cli@v1`) existen y corren.
- [ ] Cloudflare Pages: los dos sitios funcionan como SPA (recargar en `/mis-ventas` o `/balance` no da 404) y `sw.js` no queda cacheado.

## 7. Demo para el club

- [ ] `npm run create-demo-users` y `seed-demo.sql` en el proyecto de demo: aparecen ~15 productos, insumos y dos domingos de ventas.
- [ ] Recorrer el guion de la demo del README de punta a punta en el iPhone.
- [ ] Antes de presentarla, borrar los datos de ejemplo de los teléfonos que se usen.
