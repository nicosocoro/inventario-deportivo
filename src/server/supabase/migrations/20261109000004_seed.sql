-- Semilla obligatoria: lista fija de permisos, flags por defecto, ajustes y el producto "Varios".
-- Mantener sincronizado con src/users/domain/permissions.ts (lo verifica un test).

insert into public.permissions (key, description) values
  ('sales.register',          'Registrar ventas (incluye sin señal)'),
  ('sales.void_own_same_day', 'Anular sus propias ventas del mismo día, dentro del límite de minutos'),
  ('sales.void_any',          'Anular cualquier venta de los últimos 30 días'),
  ('sales.backdate',          'Cargar ventas con fecha de hasta 30 días atrás'),
  ('stock.add',               'Ingresar compras (cantidad y costo total)'),
  ('stock.consume',           'Registrar consumo de insumos'),
  ('stock.adjust',            'Ajustar stock y anular compras, con motivo'),
  ('products.manage',         'Crear, editar y activar o desactivar productos'),
  ('prices.manage',           'Cambiar precios'),
  ('balance.view',            'Ver el balance y exportar PDF y CSV'),
  ('history.view',            'Ver el historial completo'),
  ('settings.manage',         'Editar ajustes'),
  ('admin.access',            'Entrar al panel admin'),
  ('users.manage',            'Gestionar usuarios (siempre sujeto a la jerarquía)');

insert into public.role_permissions (role, permission) values
  ('venta', 'sales.register'),
  ('venta', 'sales.void_own_same_day'),
  ('venta', 'stock.add'),
  ('venta', 'stock.consume'),
  ('venta', 'stock.adjust');

insert into public.role_permissions (role, permission)
select 'admin', key from public.permissions;

insert into public.settings (key, value) values
  ('void_own_window_minutes', '60'::jsonb);

with v as (
  insert into public.products (name, price, for_sale, requires_note, sort_order)
  values ('Varios', 0, false, true, 9999)
  returning id
)
insert into public.price_history (product_id, price) select id, 0 from v;
