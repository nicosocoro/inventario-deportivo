# Decisiones pendientes

Temas que necesitan una definición tuya (o del club) antes de cerrar el sistema. Cada uno tiene una recomendación; anotá la decisión y la fecha.

## 1. Quién puede ver la lista de usuarios

**Situación:** hoy cualquier usuario activo puede leer el nombre, el rol y si está activo de todos los usuarios (política RLS `profiles_read` en `src/server/supabase/migrations/20261109000003_security.sql`). El plan decía: cada uno ve solo su perfil y la lista completa la ven quienes gestionan usuarios.

**Opciones:**
- **(a) Ajustar al plan:** que la lista completa la vean solo quienes tienen `users.manage`, `history.view` o `balance.view` (estos últimos necesitan los nombres de los vendedores en el historial y el balance). Lleva un test nuevo en `src/server/tests/security.test.ts`.
- **(b) Dejarlo como está** y anotarlo en el README como desviación del plan.

**Recomendación:** (b). Es un club chico y los nombres de los vendedores no son información sensible. Elegí (a) si preferís ceñirte al plan.

**Decisión:** _pendiente_

## 2. Escudo y colores del club

**Situación:** el ícono de la app es provisorio (círculo blanco con una franja sobre verde) y el tema usa verde. En el iPhone el ícono es lo que se ve en la pantalla de inicio.

**Opciones:** pasar el escudo del club (PNG o SVG, idealmente cuadrado y con buena resolución) y sus colores, o mantener el diseño genérico.

**Recomendación:** usar el escudo antes de la demo; ayuda a que el club sienta la app como propia. Para regenerar los íconos: reemplazar `scripts/gen-icons.mjs` o los archivos de `public-ventas/icons` y `public-admin/icons`.

**Decisión:** _pendiente_

## 3. Restauración de usuarios en un backup

**Situación:** el backup semanal guarda la base, pero falta confirmar si incluye los usuarios de Auth (`auth.users`). Si no los incluye, después de restaurar habría que recrear los usuarios.

**Opciones:** agregar el schema `auth` al dump, o aceptar que ante un desastre se recrean los usuarios a mano (son pocos).

**Recomendación:** decidirlo después del simulacro de restore (ver [pruebas pendientes](pruebas-pendientes.md#6-operación)). Con pocos usuarios, recrearlos a mano es aceptable.

**Decisión:** _pendiente_

## 4. Riesgos aceptados (confirmar)

El plan y la revisión los aceptaron a propósito. Confirmá que estás de acuerdo:

- **Reloj del teléfono:** una venta o anulación hecha sin señal usa la hora del teléfono (acotada a ventanas y marcada en el historial). Un reloj manipulado podría correr una anulación dentro del plazo.
- **Anular compras:** quien tiene `stock.adjust` (por defecto también `venta`) puede anular una compra de cualquier fecha, con motivo y registro en el historial.
- **Zona horaria fija UTC-3:** San Juan no tiene horario de verano. Si Argentina volviera a tenerlo, habría que ajustar los filtros por día.
- **Versiones de las GitHub Actions** sin fijar a un commit exacto.

**Decisión:** _pendiente_

## 5. Cuando el club adopte el sistema

No hace falta decidirlo para la demo, pero sí antes de usarlo en serio (ver la sección de migración del [plan](../.claude/plans/cantina-inventario-ventas/final-plan.md)):

- Qué email del club y qué **dos personas** son dueñas de las cuentas de GitHub, Supabase y Cloudflare.
- Si hay un **segundo owner** (recomendado, para no depender de una sola persona).
- Quién revisa que el keep-alive y los backups sigan funcionando (llegan mails de GitHub si fallan).
- Si se compra un dominio propio (`.com.ar`) o se sigue con `*.pages.dev`. Conviene decidirlo **antes** de que los vendedores instalen la app, porque en iPhone habría que reinstalarla si cambia la dirección.

**Decisión:** _pendiente_
