-- Esquema de la cantina del CADB.
-- Dinero en pesos enteros. Fechas en timestamptz; los reportes usan America/Argentina/San_Juan.
-- Toda escritura pasa por funciones RPC (ver 0002); los clientes solo tienen SELECT (ver 0003).

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  display_name text check (display_name is null or length(display_name) <= 60),
  role         text not null check (role in ('venta', 'admin', 'owner')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Lista fija de permisos (feature flags). La siembra 0004.
create table public.permissions (
  key         text primary key,
  description text not null
);

-- Flags por rol. El owner no tiene filas: tiene todo implícito.
create table public.role_permissions (
  role       text not null check (role in ('venta', 'admin')),
  permission text not null references public.permissions (key) on delete cascade,
  primary key (role, permission)
);

-- Ajustes con claves fijas (las siembra 0004).
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

create table public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique check (length(btrim(name)) between 1 and 60),
  price         integer not null default 0 check (price >= 0), -- cache del precio vigente (lo escribe set_price)
  stock         integer not null default 0,                    -- cache: lo modifican solo las funciones
  for_sale      boolean not null default true,                 -- false = no aparece en la caja (insumos, "Varios")
  requires_note boolean not null default false,                -- true en "Varios"
  min_stock     integer check (min_stock is null or min_stock >= 0),
  sort_order    integer not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.price_history (
  id         bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  price      integer not null check (price >= 0),
  valid_from timestamptz not null default now(),
  changed_by uuid references public.profiles (id) -- null = creado por la migración
);
create index price_history_product_idx on public.price_history (product_id, valid_from desc);

create table public.sales (
  id                uuid primary key, -- generado en el teléfono (idempotencia)
  total             integer not null check (total >= 0),
  payment_method    text not null check (payment_method in ('efectivo', 'transferencia', 'mixto')),
  cash_amount       integer not null check (cash_amount >= 0),
  transfer_amount   integer not null check (transfer_amount >= 0),
  transfer_last4    text check (transfer_last4 ~ '^\d{4}$'),
  status            text not null default 'ok' check (status in ('ok', 'anulada')),
  flags             text[] not null default '{}',
  created_by        uuid not null references public.profiles (id),
  created_at        timestamptz not null default now(), -- hora efectiva de la venta
  device_created_at timestamptz,                        -- hora informada por el teléfono
  synced_at         timestamptz not null default now(),
  voided_by         uuid references public.profiles (id),
  voided_at         timestamptz,
  void_reason       text,
  constraint sales_amounts_sum check (cash_amount + transfer_amount = total),
  constraint sales_method_amounts check (
    (payment_method = 'efectivo' and transfer_amount = 0)
    or (payment_method = 'transferencia' and cash_amount = 0)
    or payment_method = 'mixto'
  ),
  constraint sales_last4_when_transfer check ((transfer_amount > 0) = (transfer_last4 is not null)),
  constraint sales_void_fields check ((status = 'anulada') = (voided_at is not null))
);
create index sales_created_at_idx on public.sales (created_at);
create index sales_created_by_idx on public.sales (created_by, created_at);

create table public.sale_items (
  sale_id     uuid not null references public.sales (id) on delete cascade,
  product_id  uuid not null references public.products (id),
  quantity    integer not null check (quantity between 1 and 100),
  unit_price  integer not null check (unit_price >= 0), -- precio aceptado por el servidor
  shown_price integer not null check (shown_price >= 0), -- precio que mostró el teléfono
  primary key (sale_id, product_id)
);

create table public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id),
  type        text not null check (type in ('entrada', 'venta', 'consumo', 'ajuste', 'anulacion_venta', 'anulacion_entrada')),
  quantity    integer not null check (quantity <> 0), -- + entra / - sale
  total_cost  integer,                                -- obligatorio en entrada (>= 0); <= 0 en anulacion_entrada
  sale_id     uuid references public.sales (id),
  reverses_id uuid references public.stock_movements (id),
  note        text,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  constraint movements_cost check (
    (type = 'entrada' and total_cost is not null and total_cost >= 0)
    or (type = 'anulacion_entrada' and total_cost is not null and total_cost <= 0 and reverses_id is not null)
    or (type not in ('entrada', 'anulacion_entrada') and total_cost is null)
  )
);
create index stock_movements_product_idx on public.stock_movements (product_id);
create index stock_movements_created_at_idx on public.stock_movements (created_at);
create unique index stock_movements_one_reversal on public.stock_movements (reverses_id) where reverses_id is not null;

create table public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid not null references public.profiles (id),
  action    text not null,
  entity_id text,
  reason    text,
  flags     text[] not null default '{}',
  detail    jsonb not null default '{}'
);
create index audit_log_at_idx on public.audit_log (at desc);
