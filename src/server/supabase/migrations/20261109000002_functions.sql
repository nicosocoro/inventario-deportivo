-- Funciones: auxiliares, permisos y todas las escrituras (RPC).
-- Convención de errores: el mensaje empieza con un código y dos puntos, por ejemplo
--   'forbidden: ...', 'invalid: ...', 'not_found: ...', 'conflict: ...', 'out_of_window: ...'
-- El cliente usa ese código para decidir si reintenta (nunca para errores de negocio).

-- ---------------------------------------------------------------- auxiliares

create function public.sj_date(p_ts timestamptz) returns date
language sql stable set search_path = '' as $$
  select (p_ts at time zone 'America/Argentina/San_Juan')::date
$$;

create function public.sj_start(p_day date) returns timestamptz
language sql stable set search_path = '' as $$
  select p_day::timestamp at time zone 'America/Argentina/San_Juan'
$$;

create function public.add_flag(p_flags text[], p_flag text) returns text[]
language sql immutable set search_path = '' as $$
  select case when p_flag = any (p_flags) then p_flags else p_flags || p_flag end
$$;

create function public.role_rank(p_role text) returns integer
language sql immutable set search_path = '' as $$
  select case p_role when 'owner' then 3 when 'admin' then 2 when 'venta' then 1 else 0 end
$$;

create function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create function public.my_rank() returns integer
language sql stable security definer set search_path = '' as $$
  select public.role_rank(public.my_role())
$$;

-- Feature flag: true si el usuario está activo y es owner o su rol tiene el permiso.
create function public.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.role = 'owner'
        or exists (select 1 from public.role_permissions rp where rp.role = p.role and rp.permission = p_key)
    from public.profiles p
    where p.id = auth.uid() and p.active
  ), false)
$$;

create function public.require_permission(p_key text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_permission(p_key) then
    raise exception 'forbidden: No tenés permiso para esta acción (%)', p_key;
  end if;
end $$;

create function public.my_permissions() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case
      when p.role = 'owner' then (select array_agg(k.key order by k.key) from public.permissions k)
      else (select array_agg(rp.permission order by rp.permission) from public.role_permissions rp where rp.role = p.role)
    end
    from public.profiles p
    where p.id = auth.uid() and p.active
  ), '{}')
$$;

-- Lo que la app necesita al iniciar sesión (y cachea para usar sin señal). null = sin acceso.
create function public.session_info() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'role', p.role,
    'permissions', to_jsonb(public.my_permissions()),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb) from public.settings s)
  )
  from public.profiles p
  where p.id = auth.uid() and p.active
$$;

create function public.setting_int(p_key text) returns integer
language sql stable security definer set search_path = '' as $$
  select (s.value #>> '{}')::integer from public.settings s where s.key = p_key
$$;

-- Interna: solo la llaman otras funciones security definer.
create function public.audit(p_action text, p_entity text, p_reason text, p_flags text[], p_detail jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, entity_id, reason, flags, detail)
  values (auth.uid(), p_action, p_entity, p_reason, coalesce(p_flags, '{}'), coalesce(p_detail, '{}'))
$$;

create function public.ping() returns timestamptz
language sql stable set search_path = '' as $$
  select now()
$$;

-- ---------------------------------------------------------------- productos y precios

create function public.create_product(
  p_name text,
  p_price integer,
  p_for_sale boolean default true,
  p_requires_note boolean default false,
  p_min_stock integer default null,
  p_sort_order integer default 0
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.require_permission('products.manage');
  if p_price is null or p_price < 0 then
    raise exception 'invalid: Precio inválido';
  end if;
  begin
    insert into public.products (name, price, for_sale, requires_note, min_stock, sort_order)
    values (btrim(p_name), p_price, coalesce(p_for_sale, true), coalesce(p_requires_note, false), p_min_stock, coalesce(p_sort_order, 0))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'conflict: Ya existe un producto con ese nombre';
  end;
  insert into public.price_history (product_id, price, changed_by) values (v_id, p_price, auth.uid());
  perform public.audit('product.create', v_id::text, null, '{}',
    jsonb_build_object('name', btrim(p_name), 'price', p_price, 'for_sale', coalesce(p_for_sale, true)));
  return v_id;
end $$;

-- No toca precio ni stock.
create function public.update_product(
  p_id uuid,
  p_name text,
  p_for_sale boolean,
  p_requires_note boolean,
  p_min_stock integer,
  p_sort_order integer,
  p_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.products;
  v_new public.products;
begin
  perform public.require_permission('products.manage');
  select * into v_old from public.products where id = p_id for update;
  if not found then
    raise exception 'not_found: Producto inexistente';
  end if;
  begin
    update public.products set
      name = btrim(p_name),
      for_sale = coalesce(p_for_sale, for_sale),
      requires_note = coalesce(p_requires_note, requires_note),
      min_stock = p_min_stock,
      sort_order = coalesce(p_sort_order, sort_order),
      active = coalesce(p_active, active),
      updated_at = now()
    where id = p_id
    returning * into v_new;
  exception when unique_violation then
    raise exception 'conflict: Ya existe un producto con ese nombre';
  end;
  perform public.audit('product.update', p_id::text, null, '{}', jsonb_build_object(
    'before', to_jsonb(v_old) - 'stock' - 'price' - 'created_at' - 'updated_at',
    'after', to_jsonb(v_new) - 'stock' - 'price' - 'created_at' - 'updated_at'));
end $$;

create function public.set_price(p_product_id uuid, p_price integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old integer;
begin
  perform public.require_permission('prices.manage');
  if p_price is null or p_price < 0 then
    raise exception 'invalid: Precio inválido';
  end if;
  select price into v_old from public.products where id = p_product_id for update;
  if not found then
    raise exception 'not_found: Producto inexistente';
  end if;
  if v_old = p_price then
    return;
  end if;
  update public.products set price = p_price, updated_at = now() where id = p_product_id;
  insert into public.price_history (product_id, price, changed_by) values (p_product_id, p_price, auth.uid());
  perform public.audit('price.set', p_product_id::text, null, '{}',
    jsonb_build_object('before', v_old, 'after', p_price));
end $$;

-- ---------------------------------------------------------------- stock
-- p_id (opcional) lo genera el cliente: reintentar no duplica la operación.

create function public.add_stock(p_id uuid, p_product_id uuid, p_quantity integer, p_total_cost integer, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.products;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.require_permission('stock.add');
  if exists (select 1 from public.stock_movements where id = v_id) then
    return v_id;
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'invalid: Cantidad inválida';
  end if;
  if p_total_cost is null or p_total_cost < 0 then
    raise exception 'invalid: Cargá cuánto se gastó (puede ser 0)';
  end if;
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'not_found: Producto inexistente';
  end if;
  if not v_prod.active then
    raise exception 'invalid: El producto está desactivado';
  end if;
  if v_prod.requires_note and v_note is null then
    raise exception 'invalid: El detalle es obligatorio para %', v_prod.name;
  end if;
  insert into public.stock_movements (id, product_id, type, quantity, total_cost, note, created_by)
  values (v_id, p_product_id, 'entrada', p_quantity, p_total_cost, v_note, auth.uid());
  update public.products set stock = stock + p_quantity, updated_at = now() where id = p_product_id;
  perform public.audit('stock.add', p_product_id::text, null, '{}', jsonb_build_object(
    'movement_id', v_id, 'product', v_prod.name, 'quantity', p_quantity, 'total_cost', p_total_cost, 'note', v_note));
  return v_id;
end $$;

create function public.consume_stock(p_id uuid, p_product_id uuid, p_quantity integer, p_note text default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.products;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_flags text[] := '{}';
begin
  perform public.require_permission('stock.consume');
  if exists (select 1 from public.stock_movements where id = v_id) then
    return v_id;
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'invalid: Cantidad inválida';
  end if;
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'not_found: Producto inexistente';
  end if;
  if v_prod.requires_note then
    raise exception 'invalid: No se registra consumo de %', v_prod.name;
  end if;
  if v_prod.stock - p_quantity < 0 then
    v_flags := public.add_flag(v_flags, 'stock_negativo');
  end if;
  insert into public.stock_movements (id, product_id, type, quantity, note, created_by)
  values (v_id, p_product_id, 'consumo', -p_quantity, nullif(btrim(p_note), ''), auth.uid());
  update public.products set stock = stock - p_quantity, updated_at = now() where id = p_product_id;
  perform public.audit('stock.consume', p_product_id::text, nullif(btrim(p_note), ''), v_flags, jsonb_build_object(
    'movement_id', v_id, 'product', v_prod.name, 'quantity', p_quantity));
  return v_id;
end $$;

create function public.adjust_stock(p_id uuid, p_product_id uuid, p_delta integer, p_note text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_prod public.products;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_note text := nullif(btrim(p_note), '');
  v_flags text[] := '{}';
begin
  perform public.require_permission('stock.adjust');
  if exists (select 1 from public.stock_movements where id = v_id) then
    return v_id;
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 10000 then
    raise exception 'invalid: Cantidad inválida';
  end if;
  if v_note is null then
    raise exception 'invalid: El motivo es obligatorio';
  end if;
  select * into v_prod from public.products where id = p_product_id for update;
  if not found then
    raise exception 'not_found: Producto inexistente';
  end if;
  if v_prod.stock + p_delta < 0 then
    v_flags := public.add_flag(v_flags, 'stock_negativo');
  end if;
  insert into public.stock_movements (id, product_id, type, quantity, note, created_by)
  values (v_id, p_product_id, 'ajuste', p_delta, v_note, auth.uid());
  update public.products set stock = stock + p_delta, updated_at = now() where id = p_product_id;
  perform public.audit('stock.adjust', p_product_id::text, v_note, v_flags, jsonb_build_object(
    'movement_id', v_id, 'product', v_prod.name, 'delta', p_delta, 'stock_before', v_prod.stock));
  return v_id;
end $$;

-- Anula una compra cargada mal: movimiento inverso de cantidad y costo. Idempotente.
create function public.void_stock_entry(p_movement_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_mov public.stock_movements;
  v_existing uuid;
  v_id uuid;
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.require_permission('stock.adjust');
  if v_note is null then
    raise exception 'invalid: El motivo es obligatorio';
  end if;
  select * into v_mov from public.stock_movements where id = p_movement_id;
  if not found or v_mov.type <> 'entrada' then
    raise exception 'not_found: Compra inexistente';
  end if;
  select id into v_existing from public.stock_movements where reverses_id = p_movement_id;
  if v_existing is not null then
    return v_existing;
  end if;
  perform 1 from public.products where id = v_mov.product_id for update;
  insert into public.stock_movements (product_id, type, quantity, total_cost, reverses_id, note, created_by)
  values (v_mov.product_id, 'anulacion_entrada', -v_mov.quantity, -v_mov.total_cost, v_mov.id, v_note, auth.uid())
  returning id into v_id;
  update public.products set stock = stock - v_mov.quantity, updated_at = now() where id = v_mov.product_id;
  perform public.audit('stock.void_entry', v_mov.product_id::text, v_note, '{}', jsonb_build_object(
    'movement_id', v_id, 'reverses_id', v_mov.id, 'quantity', v_mov.quantity, 'total_cost', v_mov.total_cost));
  return v_id;
end $$;

-- ---------------------------------------------------------------- ventas

create function public.sale_json(p_sale public.sales) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p_sale.id,
    'total', p_sale.total,
    'payment_method', p_sale.payment_method,
    'cash_amount', p_sale.cash_amount,
    'transfer_amount', p_sale.transfer_amount,
    'transfer_last4', p_sale.transfer_last4,
    'status', p_sale.status,
    'flags', to_jsonb(p_sale.flags),
    'created_at', p_sale.created_at,
    'created_by', p_sale.created_by,
    'voided_at', p_sale.voided_at,
    'void_reason', p_sale.void_reason)
$$;

-- p_items: [{product_id, quantity, shown_price}]. Idempotente por p_sale_id.
create function public.register_sale(
  p_sale_id uuid,
  p_items jsonb,
  p_payment text,
  p_transfer_amount integer default null,
  p_last4 text default null,
  p_device_created_at timestamptz default null,
  p_client_total integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_existing public.sales;
  v_sale public.sales;
  v_t timestamptz;
  v_window interval;
  v_flags text[] := '{}';
  v_item record;
  v_prod public.products;
  v_p integer;
  v_unit integer;
  v_total integer := 0;
  v_lines jsonb := '[]';
  v_n integer;
  v_cash integer;
  v_transfer integer;
  v_detail jsonb;
begin
  perform public.require_permission('sales.register');
  if p_sale_id is null then
    raise exception 'invalid: Falta el id de la venta';
  end if;

  -- 1. Idempotencia. El lock serializa dos llamadas concurrentes con el mismo id (dos pestañas,
  --    o un reintento por timeout mientras la primera sigue en curso): la segunda espera y ve la venta.
  perform pg_advisory_xact_lock(hashtextextended(p_sale_id::text, 0));
  select * into v_existing from public.sales where id = p_sale_id;
  if found then
    if v_existing.created_by <> v_uid then
      raise exception 'conflict: La venta ya existe';
    end if;
    return public.sale_json(v_existing);
  end if;

  -- 2. Validación
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid: La venta no tiene productos';
  end if;
  v_n := jsonb_array_length(p_items);
  if v_n = 0 or v_n > 50 then
    raise exception 'invalid: Cantidad de productos inválida';
  end if;
  if (select count(distinct e ->> 'product_id') from jsonb_array_elements(p_items) e) <> v_n then
    raise exception 'invalid: Productos repetidos en la venta';
  end if;
  if p_payment is null or p_payment not in ('efectivo', 'transferencia', 'mixto') then
    raise exception 'invalid: Medio de pago inválido';
  end if;
  if p_payment in ('transferencia', 'mixto') and (p_last4 is null or p_last4 !~ '^\d{4}$') then
    raise exception 'invalid: Faltan los últimos 4 números de la transferencia';
  end if;

  -- 3. Hora efectiva
  v_window := case when public.has_permission('sales.backdate') then interval '30 days' else interval '3 days' end;
  if p_device_created_at is null then
    v_t := v_now;
  elsif p_device_created_at between v_now - v_window and v_now + interval '5 minutes' then
    v_t := least(p_device_created_at, v_now);
  else
    v_t := v_now;
    v_flags := public.add_flag(v_flags, 'fecha_corregida');
  end if;
  if v_now - v_t > interval '2 minutes' then
    v_flags := public.add_flag(v_flags, 'diferida');
  end if;

  -- 4. Bloqueo ordenado (evita deadlocks entre cajas)
  perform 1 from public.products
  where id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(p_items) e)
  order by id
  for update;

  -- 5. Precio por ítem
  for v_item in
    select (e ->> 'product_id')::uuid as product_id,
           (e ->> 'quantity')::integer as quantity,
           (e ->> 'shown_price')::integer as shown_price
    from jsonb_array_elements(p_items) e
    order by 1
  loop
    if v_item.quantity is null or v_item.quantity < 1 or v_item.quantity > 100 then
      raise exception 'invalid: Cantidad inválida (1 a 100)';
    end if;
    if v_item.shown_price is null or v_item.shown_price < 0 then
      raise exception 'invalid: Precio inválido';
    end if;
    select * into v_prod from public.products where id = v_item.product_id;
    if not found then
      raise exception 'not_found: Producto inexistente';
    end if;
    if not v_prod.for_sale then
      raise exception 'invalid: % no se vende en caja', v_prod.name;
    end if;
    if not v_prod.active then
      v_flags := public.add_flag(v_flags, 'producto_inactivo');
    end if;

    select ph.price into v_p
    from public.price_history ph
    where ph.product_id = v_prod.id and ph.valid_from <= v_t
    order by ph.valid_from desc
    limit 1;
    if v_p is null then
      v_p := v_prod.price;
    end if;

    if v_item.shown_price = v_p then
      v_unit := v_p;
    elsif exists (
      select 1
      from (
        select ph.price, ph.valid_from, lead(ph.valid_from) over (order by ph.valid_from) as valid_to
        from public.price_history ph
        where ph.product_id = v_prod.id
      ) h
      where h.price = v_item.shown_price
        and h.valid_from <= v_t
        and coalesce(h.valid_to, 'infinity'::timestamptz) > v_t - interval '3 days'
    ) then
      v_unit := v_item.shown_price;
      v_flags := public.add_flag(v_flags, 'precio_desactualizado');
    else
      v_unit := v_p;
      v_flags := public.add_flag(v_flags, 'precio_distinto');
    end if;

    v_total := v_total + v_unit * v_item.quantity;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'quantity', v_item.quantity, 'unit_price', v_unit, 'shown_price', v_item.shown_price);
    if v_prod.stock - v_item.quantity < 0 then
      v_flags := public.add_flag(v_flags, 'stock_negativo');
    end if;
  end loop;

  -- 6. Pago (con el total del servidor)
  if p_payment = 'efectivo' then
    v_cash := v_total;
    v_transfer := 0;
  elsif p_payment = 'transferencia' then
    v_cash := 0;
    v_transfer := v_total;
  else
    if p_transfer_amount is null or p_transfer_amount < 1 or p_transfer_amount >= coalesce(p_client_total, v_total) then
      raise exception 'invalid: En pago mixto, lo transferido tiene que ser mayor a 0 y menor al total';
    end if;
    v_transfer := least(p_transfer_amount, v_total);
    v_cash := v_total - v_transfer;
    if p_client_total is distinct from v_total or p_transfer_amount > v_total then
      v_flags := public.add_flag(v_flags, 'pago_ajustado');
    end if;
  end if;

  -- 7. Escrituras
  insert into public.sales (id, total, payment_method, cash_amount, transfer_amount, transfer_last4, flags,
                            created_by, created_at, device_created_at, synced_at)
  values (p_sale_id, v_total, p_payment, v_cash, v_transfer, case when v_transfer > 0 then p_last4 end, v_flags,
          v_uid, v_t, p_device_created_at, v_now)
  returning * into v_sale;

  insert into public.sale_items (sale_id, product_id, quantity, unit_price, shown_price)
  select p_sale_id, l.product_id, l.quantity, l.unit_price, l.shown_price
  from jsonb_to_recordset(v_lines) as l (product_id uuid, quantity integer, unit_price integer, shown_price integer);

  insert into public.stock_movements (product_id, type, quantity, sale_id, created_by, created_at)
  select l.product_id, 'venta', -l.quantity, p_sale_id, v_uid, v_t
  from jsonb_to_recordset(v_lines) as l (product_id uuid, quantity integer);

  update public.products p
  set stock = p.stock - l.quantity, updated_at = v_now
  from jsonb_to_recordset(v_lines) as l (product_id uuid, quantity integer)
  where p.id = l.product_id;

  v_detail := jsonb_build_object(
    'total', v_total, 'payment_method', p_payment, 'cash_amount', v_cash, 'transfer_amount', v_transfer,
    'device_created_at', p_device_created_at);
  if 'pago_ajustado' = any (v_flags) or 'precio_distinto' = any (v_flags) then
    v_detail := v_detail || jsonb_build_object('declared', jsonb_build_object(
      'total', p_client_total, 'transfer', p_transfer_amount,
      'cash', case when p_client_total is not null and p_transfer_amount is not null then p_client_total - p_transfer_amount end));
  end if;
  perform public.audit('sale.register', p_sale_id::text, null, v_flags, v_detail);

  return public.sale_json(v_sale);
end $$;

-- Anulación. Con sales.void_any: cualquier venta de los últimos 30 días.
-- Con sales.void_own_same_day: venta propia, mismo día (San Juan) y dentro de void_own_window_minutes.
-- p_device_voided_at: hora en que se tocó "Anular" en el teléfono (anulaciones hechas sin señal).
create function public.void_sale(p_sale_id uuid, p_reason text, p_device_voided_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_s public.sales;
  v_now timestamptz := now();
  v_v timestamptz;
  v_win integer;
  v_mode text;
  v_flags text[] := '{}';
  v_reason text := nullif(btrim(p_reason), '');
begin
  if not (public.has_permission('sales.void_any') or public.has_permission('sales.void_own_same_day')) then
    raise exception 'forbidden: No tenés permiso para anular ventas';
  end if;
  if v_reason is null then
    raise exception 'invalid: El motivo es obligatorio';
  end if;
  select * into v_s from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'not_found: Venta inexistente';
  end if;
  if v_s.status = 'anulada' then
    return public.sale_json(v_s);
  end if;

  v_v := greatest(least(coalesce(p_device_voided_at, v_now), v_now), v_s.created_at);

  if public.has_permission('sales.void_own_same_day')
     and v_s.created_by = auth.uid()
     and v_v > v_now - interval '3 days'
     and public.sj_date(v_v) = public.sj_date(v_s.created_at) then
    v_win := coalesce(public.setting_int('void_own_window_minutes'), 60);
    if v_win = 0 or v_v - v_s.created_at <= make_interval(mins => v_win) then
      v_mode := 'own';
    end if;
  end if;
  if v_mode is null and public.has_permission('sales.void_any') and v_s.created_at > v_now - interval '30 days' then
    v_mode := 'any';
    v_v := v_now; -- un admin anula en el momento
  end if;
  if v_mode is null then
    raise exception 'out_of_window: Fuera de plazo para anular. Pedíselo a un admin';
  end if;
  if v_now - v_v > interval '2 minutes' then
    v_flags := public.add_flag(v_flags, 'diferida');
  end if;

  update public.sales
  set status = 'anulada', voided_by = auth.uid(), voided_at = v_v, void_reason = v_reason
  where id = p_sale_id
  returning * into v_s;

  perform 1 from public.products
  where id in (select si.product_id from public.sale_items si where si.sale_id = p_sale_id)
  order by id
  for update;

  insert into public.stock_movements (product_id, type, quantity, sale_id, note, created_by, created_at)
  select si.product_id, 'anulacion_venta', si.quantity, p_sale_id, v_reason, auth.uid(), v_v
  from public.sale_items si
  where si.sale_id = p_sale_id;

  update public.products p
  set stock = p.stock + si.quantity, updated_at = v_now
  from public.sale_items si
  where si.sale_id = p_sale_id and p.id = si.product_id;

  perform public.audit('sale.void', p_sale_id::text, v_reason, v_flags, jsonb_build_object(
    'mode', v_mode, 'sale_created_at', v_s.created_at, 'voided_at', v_v,
    'device_voided_at', p_device_voided_at, 'total', v_s.total, 'seller', v_s.created_by));

  return public.sale_json(v_s);
end $$;

-- ---------------------------------------------------------------- balance

create function public.last_sale_day() returns date
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_permission('balance.view');
  return (select public.sj_date(max(s.created_at)) from public.sales s where s.status = 'ok');
end $$;

create function public.balance_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  r jsonb;
begin
  perform public.require_permission('balance.view');
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid: Período inválido';
  end if;
  v_from := public.sj_start(p_from);
  v_to := public.sj_start(p_to + 1);

  with
  s as (
    select sa.*, pf.username as seller, pf.display_name as seller_name
    from public.sales sa join public.profiles pf on pf.id = sa.created_by
    where sa.created_at >= v_from and sa.created_at < v_to
  ),
  ok as (select * from s where status = 'ok'),
  m as (
    select mv.*, pr.name, pr.for_sale, pr.requires_note, pf.username
    from public.stock_movements mv
    join public.products pr on pr.id = mv.product_id
    join public.profiles pf on pf.id = mv.created_by
    where mv.created_at >= v_from and mv.created_at < v_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'generated_at', now(),
    'income', (
      select jsonb_build_object(
        'total', coalesce(sum(total), 0)::bigint,
        'count', count(*),
        'average', case when count(*) > 0 then round(avg(total))::bigint else 0 end)
      from ok),
    'by_method', (
      select jsonb_build_object(
        'cash', coalesce(sum(cash_amount), 0)::bigint,
        'transfer', coalesce(sum(transfer_amount), 0)::bigint,
        'count_efectivo', count(*) filter (where payment_method = 'efectivo'),
        'count_transferencia', count(*) filter (where payment_method = 'transferencia'),
        'count_mixto', count(*) filter (where payment_method = 'mixto'))
      from ok),
    'transfers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sale_id', id, 'at', created_at, 'amount', transfer_amount, 'last4', transfer_last4,
        'seller', seller, 'mixed', payment_method = 'mixto') order by created_at), '[]'::jsonb)
      from ok where transfer_amount > 0),
    'expenses', (
      select jsonb_build_object(
        'total', coalesce(sum(e.cost), 0)::bigint,
        'by_product', coalesce(jsonb_agg(jsonb_build_object(
          'product_id', e.product_id, 'name', e.name, 'quantity', e.qty, 'cost', e.cost) order by e.cost desc, e.name), '[]'::jsonb))
      from (
        select product_id, name, sum(quantity)::bigint as qty, sum(total_cost)::bigint as cost
        from m where type in ('entrada', 'anulacion_entrada')
        group by product_id, name
      ) e),
    'misc_details', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'at', created_at, 'name', name, 'cost', total_cost, 'note', note, 'user', username) order by created_at), '[]'::jsonb)
      from m where requires_note and type in ('entrada', 'anulacion_entrada')),
    'by_product', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', x.product_id, 'name', x.name, 'units', x.units, 'amount', x.amount) order by x.amount desc, x.name), '[]'::jsonb)
      from (
        select si.product_id, pr.name, sum(si.quantity)::bigint as units, sum(si.quantity * si.unit_price)::bigint as amount
        from ok join public.sale_items si on si.sale_id = ok.id join public.products pr on pr.id = si.product_id
        group by si.product_id, pr.name
      ) x),
    'supplies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', pr.id, 'name', pr.name,
        'bought', coalesce((select sum(quantity) from m where m.product_id = pr.id and m.type in ('entrada', 'anulacion_entrada')), 0),
        'consumed', coalesce((select -sum(quantity) from m where m.product_id = pr.id and m.type = 'consumo'), 0),
        'stock', pr.stock, 'min_stock', pr.min_stock) order by pr.sort_order, pr.name), '[]'::jsonb)
      from public.products pr where not pr.for_sale and not pr.requires_note and pr.active),
    'by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'amount', d.amount, 'count', d.n) order by d.day), '[]'::jsonb)
      from (select public.sj_date(created_at) as day, sum(total)::bigint as amount, count(*) as n from ok group by 1) d),
    'by_seller', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'username', x.seller, 'display_name', x.seller_name, 'count', x.n, 'amount', x.amount,
        'cash', x.cash, 'transfer', x.transfer) order by x.amount desc), '[]'::jsonb)
      from (
        select seller, seller_name, count(*) as n, sum(total)::bigint as amount,
               sum(cash_amount)::bigint as cash, sum(transfer_amount)::bigint as transfer
        from ok group by seller, seller_name
      ) x),
    'incidents', jsonb_build_object(
      'voids', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'sale_id', v.id, 'sale_at', v.created_at, 'voided_at', v.voided_at, 'total', v.total,
          'reason', v.void_reason, 'seller', ps.username, 'voided_by', pa.username,
          'by_other', v.voided_by <> v.created_by) order by v.voided_at), '[]'::jsonb)
        from public.sales v
        join public.profiles ps on ps.id = v.created_by
        join public.profiles pa on pa.id = v.voided_by
        where v.status = 'anulada' and v.voided_at >= v_from and v.voided_at < v_to),
      'adjustments', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'at', created_at, 'name', name, 'quantity', quantity, 'note', note, 'user', username) order by created_at), '[]'::jsonb)
        from m where type = 'ajuste'),
      'voided_entries', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'at', created_at, 'name', name, 'quantity', quantity, 'cost', total_cost, 'note', note, 'user', username) order by created_at), '[]'::jsonb)
        from m where type = 'anulacion_entrada'),
      'flagged_sales', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'sale_id', id, 'at', created_at, 'total', total, 'flags', to_jsonb(flags), 'seller', seller, 'status', status)
          order by created_at), '[]'::jsonb)
        from s where cardinality(flags) > 0)),
    'stock_alerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'product_id', id, 'name', name, 'stock', stock, 'min_stock', min_stock, 'for_sale', for_sale)
        order by stock, name), '[]'::jsonb)
      from public.products
      where active and not requires_note and (stock < 0 or (min_stock is not null and stock < min_stock)))
  ) into r;

  return r || jsonb_build_object(
    'result', (r -> 'income' ->> 'total')::bigint - (r -> 'expenses' ->> 'total')::bigint);
end $$;

-- ---------------------------------------------------------------- usuarios, permisos y ajustes
-- Reglas estructurales (no son flags):
--   rango owner > admin > venta; gestionar a alguien exige rango menor al propio (nadie gestiona a un owner);
--   asignar un rol exige rango <= al propio; nadie se gestiona a sí mismo; quitar owner solo por SQL manual.

create function public.can_manage_user(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('users.manage')
     and p_user_id is distinct from auth.uid()
     and exists (
       select 1 from public.profiles t
       where t.id = p_user_id and public.role_rank(t.role) < public.my_rank())
$$;

create function public.can_assign_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_permission('users.manage')
     and p_role in ('venta', 'admin', 'owner')
     and public.role_rank(p_role) <= public.my_rank()
$$;

-- La llama la Edge Function admin-users (con el JWT de quien crea) después de crear el usuario en Auth.
create function public.create_profile(p_user_id uuid, p_username text, p_display_name text, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_assign_role(p_role) then
    raise exception 'forbidden: No podés crear usuarios con ese rol';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'not_found: Usuario de Auth inexistente';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    raise exception 'conflict: El usuario ya tiene perfil';
  end if;
  begin
    insert into public.profiles (id, username, display_name, role)
    values (p_user_id, lower(btrim(p_username)), nullif(btrim(p_display_name), ''), p_role);
  exception when unique_violation then
    raise exception 'conflict: Ese nombre de usuario ya existe';
  end;
  perform public.audit('user.create', p_user_id::text, null, '{}', jsonb_build_object(
    'username', lower(btrim(p_username)), 'role', p_role));
end $$;

create function public.set_user_role(p_user_id uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not public.can_manage_user(p_user_id) or not public.can_assign_role(p_role) then
    raise exception 'forbidden: No podés cambiarle el rol a este usuario';
  end if;
  select role into v_old from public.profiles where id = p_user_id for update;
  if v_old = p_role then
    return;
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  perform public.audit('user.role', p_user_id::text, null, '{}', jsonb_build_object('before', v_old, 'after', p_role));
end $$;

create function public.set_user_active(p_user_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_active is null then
    raise exception 'invalid: Valor inválido';
  end if;
  if not public.can_manage_user(p_user_id) then
    raise exception 'forbidden: No podés activar ni desactivar a este usuario';
  end if;
  update public.profiles set active = p_active where id = p_user_id and active <> p_active;
  if found then
    perform public.audit('user.active', p_user_id::text, null, '{}', jsonb_build_object('active', p_active));
  end if;
end $$;

create function public.rename_user(p_user_id uuid, p_display_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if p_user_id is distinct from auth.uid() and not public.can_manage_user(p_user_id) then
    raise exception 'forbidden: No podés renombrar a este usuario';
  end if;
  if public.my_role() is null then
    raise exception 'forbidden: Usuario inactivo';
  end if;
  select display_name into v_old from public.profiles where id = p_user_id for update;
  update public.profiles set display_name = nullif(btrim(p_display_name), '') where id = p_user_id;
  perform public.audit('user.rename', p_user_id::text, null, '{}',
    jsonb_build_object('before', v_old, 'after', nullif(btrim(p_display_name), '')));
end $$;

-- La Edge Function la llama antes de resetear una clave (valida y deja registro).
create function public.log_password_reset(p_user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_manage_user(p_user_id) then
    raise exception 'forbidden: No podés resetear la clave de este usuario';
  end if;
  perform public.audit('user.password_reset', p_user_id::text, null, '{}', '{}');
end $$;

-- Solo el owner edita la matriz de permisos.
create function public.set_role_permission(p_role text, p_key text, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_changed boolean := false;
begin
  if public.my_role() is distinct from 'owner' then
    raise exception 'forbidden: Solo el owner edita los permisos';
  end if;
  if p_role not in ('venta', 'admin') then
    raise exception 'invalid: Rol inválido';
  end if;
  if not exists (select 1 from public.permissions where key = p_key) then
    raise exception 'invalid: Permiso inexistente';
  end if;
  if p_enabled then
    insert into public.role_permissions (role, permission) values (p_role, p_key) on conflict do nothing;
    v_changed := found;
  else
    delete from public.role_permissions where role = p_role and permission = p_key;
    v_changed := found;
  end if;
  if v_changed then
    perform public.audit('role_permission.set', p_role || ':' || p_key, null, '{}',
      jsonb_build_object('role', p_role, 'permission', p_key, 'enabled', p_enabled));
  end if;
end $$;

create function public.set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
begin
  perform public.require_permission('settings.manage');
  select value into v_old from public.settings where key = p_key for update;
  if not found then
    raise exception 'invalid: Ajuste inexistente';
  end if;
  if p_key = 'void_own_window_minutes' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^\d+$'
       or (p_value #>> '{}')::integer not between 0 and 1440 then
      raise exception 'invalid: Tiene que ser un número entero de minutos entre 0 y 1440';
    end if;
  end if;
  update public.settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  perform public.audit('setting.set', p_key, null, '{}', jsonb_build_object('before', v_old, 'after', p_value));
end $$;
