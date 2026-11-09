-- Grants explícitos y RLS. No se depende de los defaults de Supabase.
-- Los clientes (rol authenticated) solo leen; toda escritura pasa por las RPC security definer.

-- ---------------------------------------------------------------- tablas

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on
  public.profiles, public.permissions, public.role_permissions, public.settings,
  public.products, public.price_history, public.sales, public.sale_items,
  public.stock_movements, public.audit_log
to authenticated;

-- Que las tablas que se agreguen en el futuro tampoco queden expuestas por defecto.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- (El EXECUTE a PUBLIC es un default global que no se puede quitar por schema: por eso cada
--  función nueva necesita su `revoke execute ... from public` explícito, como abajo.)

-- ---------------------------------------------------------------- funciones

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.ping() to anon, authenticated;

grant execute on function
  public.sj_date(timestamptz),
  public.sj_start(date),
  public.role_rank(text),
  public.my_role(),
  public.my_rank(),
  public.has_permission(text),
  public.my_permissions(),
  public.session_info(),
  public.setting_int(text),
  public.create_product(text, integer, boolean, boolean, integer, integer),
  public.update_product(uuid, text, boolean, boolean, integer, integer, boolean),
  public.set_price(uuid, integer),
  public.add_stock(uuid, uuid, integer, integer, text),
  public.consume_stock(uuid, uuid, integer, text),
  public.adjust_stock(uuid, uuid, integer, text),
  public.void_stock_entry(uuid, text),
  public.register_sale(uuid, jsonb, text, integer, text, timestamptz, integer),
  public.void_sale(uuid, text, timestamptz),
  public.last_sale_day(),
  public.balance_report(date, date),
  public.can_manage_user(uuid),
  public.can_assign_role(text),
  public.create_profile(uuid, text, text, text),
  public.set_user_role(uuid, text),
  public.set_user_active(uuid, boolean),
  public.rename_user(uuid, text),
  public.log_password_reset(uuid),
  public.set_role_permission(text, text, boolean),
  public.set_setting(text, jsonb)
to authenticated;
-- Internas, sin grant: audit, require_permission, add_flag, sale_json.

-- ---------------------------------------------------------------- RLS

alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.settings enable row level security;
alter table public.products enable row level security;
alter table public.price_history enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.audit_log enable row level security;

-- Catálogo y configuración: cualquier usuario activo.
create policy profiles_read on public.profiles for select to authenticated
  using (public.my_role() is not null);
create policy permissions_read on public.permissions for select to authenticated
  using (public.my_role() is not null);
create policy role_permissions_read on public.role_permissions for select to authenticated
  using (public.my_role() is not null);
create policy settings_read on public.settings for select to authenticated
  using (public.my_role() is not null);
create policy products_read on public.products for select to authenticated
  using (public.my_role() is not null);
create policy price_history_read on public.price_history for select to authenticated
  using (public.my_role() is not null);

-- Ventas: todo con history.view o balance.view; si no, solo las propias del día.
create policy sales_read on public.sales for select to authenticated
  using (
    public.has_permission('history.view')
    or public.has_permission('balance.view')
    or (created_by = auth.uid() and public.my_role() is not null
        and public.sj_date(created_at) = public.sj_date(now()))
  );
create policy sale_items_read on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy stock_movements_read on public.stock_movements for select to authenticated
  using (
    public.has_permission('history.view')
    or public.has_permission('balance.view')
    or (created_by = auth.uid() and public.my_role() is not null
        and public.sj_date(created_at) = public.sj_date(now()))
  );

create policy audit_log_read on public.audit_log for select to authenticated
  using (public.has_permission('history.view'));
