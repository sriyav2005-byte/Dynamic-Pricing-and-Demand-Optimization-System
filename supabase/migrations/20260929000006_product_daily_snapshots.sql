-- ============================================================================
-- Daily product-state snapshots (feature store for demand models)
-- ============================================================================
-- Sales rows record what sold; models also need the product's state on each
-- day (price, expiry, stock, seasonality). The API snapshots every active
-- product once per day; the demo seeder loads the dataset's daily states.

create table if not exists public.product_daily_snapshots (
  product_id      uuid not null references public.products(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  snapshot_date   date not null,
  price           numeric(12,2) not null check (price > 0),
  cost_price      numeric(12,2) not null check (cost_price >= 0),
  mrp             numeric(12,2) not null check (mrp > 0),
  stock           integer check (stock is null or stock >= 0),
  days_to_expiry  integer,
  season_factor   numeric(6,3),
  created_at      timestamptz not null default now(),
  primary key (product_id, snapshot_date)
);
create index if not exists product_daily_snapshots_store_idx on public.product_daily_snapshots(store_id, snapshot_date);

alter table public.product_daily_snapshots enable row level security;
grant select on public.product_daily_snapshots to authenticated;
grant all on public.product_daily_snapshots to service_role;
revoke all on public.product_daily_snapshots from anon;

drop policy if exists product_daily_snapshots_select on public.product_daily_snapshots;
create policy product_daily_snapshots_select on public.product_daily_snapshots for select to authenticated
  using (app.has_store_role(store_id, 'VIEWER'));

drop trigger if exists product_daily_snapshots_product_store on public.product_daily_snapshots;
create trigger product_daily_snapshots_product_store before insert or update on public.product_daily_snapshots
  for each row execute function app.check_product_store();

-- Snapshot every active product of every LIVE store for the given day.
create or replace function app.snapshot_products(p_date date default current_date) returns integer
language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.product_daily_snapshots (product_id, store_id, snapshot_date, price, cost_price, mrp, stock, days_to_expiry, season_factor)
    select p.id, p.store_id, p_date, p.selling_price, p.cost_price, p.mrp, p.stock,
           case when p.expiry_date is not null then p.expiry_date - p_date end, p.season_factor
    from public.products p join public.stores s on s.id = p.store_id
    where p.is_active and s.is_active and s.data_mode = 'LIVE'
    on conflict (product_id, snapshot_date) do update set
      price = excluded.price, cost_price = excluded.cost_price, mrp = excluded.mrp, stock = excluded.stock,
      days_to_expiry = excluded.days_to_expiry, season_factor = excluded.season_factor
    returning 1)
  select count(*)::integer from ins
$$;
revoke execute on function app.snapshot_products(date) from authenticated;
