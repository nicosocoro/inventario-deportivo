-- Datos de ejemplo para la DEMO al club. Solo en el proyecto de demo, nunca en producción.
-- 1) npm run create-demo-users   2) pegar este archivo en el SQL Editor de Supabase y ejecutarlo.
-- Usa las mismas RPC que la app (impersonando a los usuarios demo), así se respetan stock, pagos y auditoría.
-- Las ventas se generan "ahora" y después se mueven a los dos domingos anteriores.

do $$
declare
  v_admin uuid := (select id from public.profiles where username = 'demo-admin');
  v_sellers uuid[] := array(select id from public.profiles where username in ('demo-venta', 'demo-venta2') order by username);
  v_products uuid[];
  v_prices integer[];
  v_hielo uuid;
  v_carbon uuid;
  v_varios uuid := (select id from public.products where name = 'Varios');
  v_sunday date;
  v_week integer;
  v_i integer;
  v_n integer;
  v_items jsonb;
  v_total integer;
  v_k integer;
  v_idx integer;
  v_qty integer;
  v_pay text;
  v_transfer integer;
  v_sale uuid;
  v_at timestamptz;
  v_seller uuid;
  v_ids uuid[] := '{}';
  v_name text;
  v_price integer;
  v_cost integer;
begin
  if v_admin is null or cardinality(v_sellers) < 2 then
    raise exception 'Primero correr: npm run create-demo-users';
  end if;
  if exists (select 1 from public.products where name = 'Choripán') then
    raise exception 'La demo ya está cargada';
  end if;
  perform setseed(0.42);

  -- Productos (como demo-admin)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  for v_name, v_price, v_cost, v_i in
    select * from (values
      ('Choripán', 4000, 1800, 10), ('Hamburguesa', 5000, 2300, 11), ('Pancho', 3000, 1100, 12),
      ('Docena de empanadas', 12000, 6500, 13), ('Empanada', 1200, 550, 14), ('Papas fritas', 2500, 900, 15),
      ('Coca-Cola 500 ml', 2000, 1100, 20), ('Sprite 500 ml', 2000, 1100, 21), ('Agua 500 ml', 1500, 700, 22),
      ('Cerveza lata', 3000, 1600, 23), ('Fernet con coca', 4500, 2000, 24), ('Café', 1000, 300, 30),
      ('Alfajor', 1000, 500, 31), ('Turrón', 500, 200, 32), ('Chupetín', 300, 120, 33)
    ) as t (name, price, cost, ord)
  loop
    v_sale := public.create_product(v_name, v_price, true, false, 5, v_i);
    v_ids := v_ids || v_sale;
    perform public.add_stock(null, v_sale, 40, 40 * v_cost, 'Compra inicial (demo)');
  end loop;
  v_hielo := public.create_product('Hielo (bolsa)', 0, false, false, 3, 50);
  v_carbon := public.create_product('Carbón (bolsa 4 kg)', 0, false, false, 2, 51);
  perform public.add_stock(null, v_hielo, 10, 15000, null);
  perform public.add_stock(null, v_carbon, 6, 36000, null);
  perform public.add_stock(null, v_varios, 1, 4500, 'Detergente y trapos');
  update public.price_history set valid_from = now() - interval '40 days' where product_id = any (v_ids || v_hielo || v_carbon);
  update public.stock_movements set created_at = now() - interval '15 days' where type = 'entrada';

  select array_agg(id order by sort_order), array_agg(price order by sort_order)
  into v_products, v_prices
  from public.products where for_sale and active;

  -- Dos domingos de ventas
  for v_week in 1..2 loop
    v_sunday := public.sj_date(now()) - ((extract(isodow from public.sj_date(now()))::integer % 7) + 7 * (v_week - 1));
    if v_sunday >= public.sj_date(now()) then
      v_sunday := v_sunday - 7;
    end if;
    for v_i in 1..25 loop
      v_seller := v_sellers[1 + (v_i % 2)];
      perform set_config('request.jwt.claims', json_build_object('sub', v_seller, 'role', 'authenticated')::text, true);
      v_items := '[]';
      v_total := 0;
      v_n := 1 + floor(random() * 3)::integer;
      for v_k in 1..v_n loop
        v_idx := 1 + floor(random() * cardinality(v_products))::integer;
        if v_items @> jsonb_build_array(jsonb_build_object('product_id', v_products[v_idx])) then
          continue;
        end if;
        v_qty := 1 + floor(random() * 3)::integer;
        v_items := v_items || jsonb_build_object('product_id', v_products[v_idx], 'quantity', v_qty, 'shown_price', v_prices[v_idx]);
        v_total := v_total + v_qty * v_prices[v_idx];
      end loop;
      v_pay := case when random() < 0.6 then 'efectivo' when random() < 0.75 then 'transferencia' else 'mixto' end;
      v_transfer := case when v_pay = 'mixto' then greatest(100, (v_total / 2 / 100) * 100) end;
      if v_pay = 'mixto' and v_transfer >= v_total then
        v_pay := 'efectivo';
        v_transfer := null;
      end if;
      v_sale := gen_random_uuid();
      perform public.register_sale(v_sale, v_items, v_pay, v_transfer,
        case when v_pay <> 'efectivo' then lpad((floor(random() * 10000))::integer::text, 4, '0') end, null, v_total);
      if v_i = 7 then
        perform public.void_sale(v_sale, 'Cobré de más (demo)', null);
      end if;
      -- mover la venta (y su anulación) al domingo, entre 11:00 y 18:00 hora San Juan
      v_at := public.sj_start(v_sunday) + interval '11 hours' + (v_i * interval '16 minutes');
      update public.sales set created_at = v_at, device_created_at = v_at, synced_at = v_at,
        voided_at = case when voided_at is not null then v_at + interval '3 minutes' end
      where id = v_sale;
      update public.stock_movements
      set created_at = case when type = 'anulacion_venta' then v_at + interval '3 minutes' else v_at end
      where sale_id = v_sale;
      update public.audit_log
      set at = case when action = 'sale.void' then v_at + interval '3 minutes' else v_at end
      where entity_id = v_sale::text;
    end loop;
    perform public.consume_stock(null, v_hielo, 3, null);
    perform public.consume_stock(null, v_carbon, 2, null);
    update public.stock_movements set created_at = public.sj_start(v_sunday) + interval '10 hours' where type = 'consumo' and created_at > now() - interval '1 minute';
    update public.audit_log set at = public.sj_start(v_sunday) + interval '10 hours' where action = 'stock.consume' and at > now() - interval '1 minute';
  end loop;

  -- Un cambio de precio para ver el historial
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_price((select id from public.products where name = 'Café'), 1200);
  perform set_config('request.jwt.claims', '', true);
end $$;
