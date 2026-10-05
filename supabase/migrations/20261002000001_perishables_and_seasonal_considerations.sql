-- ============================================================================
-- PriceIQ — perishable product attributes, seasonal considerations, 2025–27
--           regional festival calendar
-- ============================================================================

-- ── Perishable / sensitivity attributes on products ─────────────────────────
-- shelf_life_days        typical life of a fresh batch (expiry_date is the batch in stock)
-- *_sensitivity (0–1)    how strongly the product reacts to seasons / festivals / weather.
--                        They scale store- and category-wide seasonal considerations
--                        (below); NULL means "not assessed" (treated as fully affected).
-- days_to_expiry and wastage risk are derived at read time (expiry_date − today and
-- the inventory service's expiry-risk calculation) — they are never stored.
alter table public.products
  add column if not exists pack_size            text,
  add column if not exists shelf_life_days      integer,
  add column if not exists seasonal_sensitivity numeric(3,2),
  add column if not exists festival_sensitivity numeric(3,2),
  add column if not exists weather_sensitivity  numeric(3,2);

do $$ begin
  alter table public.products add constraint products_shelf_life_chk
    check (shelf_life_days is null or shelf_life_days between 1 and 3650);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.products add constraint products_sensitivity_chk check (
    (seasonal_sensitivity is null or seasonal_sensitivity between 0 and 1) and
    (festival_sensitivity is null or festival_sensitivity between 0 and 1) and
    (weather_sensitivity  is null or weather_sensitivity  between 0 and 1));
exception when duplicate_object then null; end $$;

-- ── Seasonal considerations ─────────────────────────────────────────────────
-- A planning assumption entered by store staff: "during <window>, demand for
-- <product | category | whole store> is expected to change by X% and supply is
-- <condition>". The AI service applies active considerations as an explicit,
-- labelled adjustment on top of the demand model when it evaluates prices —
-- the result still has to pass the Go pricing-constraint engine.
--
-- Scope: product_id set ⇒ that product; category_id set ⇒ that category;
--        both NULL ⇒ every product in the store.
create table if not exists public.seasonal_considerations (
  id                          uuid primary key default gen_random_uuid(),
  store_id                    uuid not null references public.stores(id) on delete cascade,
  name                        text not null check (length(trim(name)) between 1 and 120),
  kind                        text not null check (kind in ('SEASON', 'FESTIVAL', 'EVENT', 'WEATHER')),
  product_id                  uuid references public.products(id) on delete cascade,
  category_id                 uuid references public.categories(id) on delete cascade,
  start_date                  date not null,
  end_date                    date not null,
  expected_demand_change_pct  numeric(6,2) not null default 0 check (expected_demand_change_pct between -90 and 300),
  supply_condition            text not null default 'NORMAL' check (supply_condition in ('NORMAL', 'SURPLUS', 'LIMITED', 'SHORTAGE')),
  weather_sensitivity         text check (weather_sensitivity in ('LOW', 'MEDIUM', 'HIGH')),
  festival_sensitivity        text check (festival_sensitivity in ('LOW', 'MEDIUM', 'HIGH')),
  notes                       text check (notes is null or length(notes) <= 1000),
  is_active                   boolean not null default true,
  created_by                  uuid references public.profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (end_date >= start_date),
  check (end_date - start_date <= 366),
  check (product_id is null or category_id is null)
);
create index if not exists seasonal_considerations_store_idx on public.seasonal_considerations(store_id, start_date, end_date);
create index if not exists seasonal_considerations_product_idx on public.seasonal_considerations(product_id) where product_id is not null;

drop trigger if exists seasonal_considerations_touch on public.seasonal_considerations;
create trigger seasonal_considerations_touch before update on public.seasonal_considerations
  for each row execute function app.touch_updated_at();

-- A consideration's product must belong to its store (same guard as sales etc.).
drop trigger if exists seasonal_considerations_product_store on public.seasonal_considerations;
create trigger seasonal_considerations_product_store before insert or update on public.seasonal_considerations
  for each row when (new.product_id is not null) execute function app.check_product_store();

-- …and its category to the store's organization.
create or replace function app.check_consideration_category() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.categories c join public.stores s on s.organization_id = c.organization_id
                 where c.id = new.category_id and s.id = new.store_id) then
    raise exception 'category % does not belong to the organization of store %', new.category_id, new.store_id
      using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists seasonal_considerations_category_org on public.seasonal_considerations;
create trigger seasonal_considerations_category_org before insert or update on public.seasonal_considerations
  for each row when (new.category_id is not null) execute function app.check_consideration_category();

-- Changes are audited like every other pricing input.
drop trigger if exists seasonal_considerations_audit on public.seasonal_considerations;
create trigger seasonal_considerations_audit after insert or update or delete on public.seasonal_considerations
  for each row execute function app.audit_trigger();

-- RLS: everyone in the store can read; store managers and above can write.
alter table public.seasonal_considerations enable row level security;
grant select, insert, update, delete on public.seasonal_considerations to authenticated;
grant all on public.seasonal_considerations to service_role;
revoke all on public.seasonal_considerations from anon;

drop policy if exists seasonal_considerations_select on public.seasonal_considerations;
create policy seasonal_considerations_select on public.seasonal_considerations for select to authenticated
  using (app.has_store_role(store_id, 'VIEWER'));
drop policy if exists seasonal_considerations_insert on public.seasonal_considerations;
create policy seasonal_considerations_insert on public.seasonal_considerations for insert to authenticated
  with check (app.has_store_role(store_id, 'STORE_MANAGER'));
drop policy if exists seasonal_considerations_update on public.seasonal_considerations;
create policy seasonal_considerations_update on public.seasonal_considerations for update to authenticated
  using (app.has_store_role(store_id, 'STORE_MANAGER')) with check (app.has_store_role(store_id, 'STORE_MANAGER'));
drop policy if exists seasonal_considerations_delete on public.seasonal_considerations;
create policy seasonal_considerations_delete on public.seasonal_considerations for delete to authenticated
  using (app.has_store_role(store_id, 'STORE_MANAGER'));

-- ── Regional festivals not covered by the first calendar ────────────────────
-- Lunar/solar-calendar dates: 2025 dates are as observed; future dates are
-- flagged approximate and should be confirmed against the official holiday list.
insert into public.seasonal_events (organization_id, name, event_type, start_date, end_date, is_date_approximate, notes)
values
  (null, 'Pongal',           'FESTIVAL', '2025-01-13', '2025-01-16', false, 'Thai Pongal on 14 Jan 2025 (Makar Sankranti)'),
  (null, 'Eid al-Adha',      'FESTIVAL', '2025-06-05', '2025-06-07', false, 'Bakrid on 7 Jun 2025'),
  (null, 'Ganesh Chaturthi', 'FESTIVAL', '2025-08-25', '2025-08-27', false, 'Ganesh Chaturthi on 27 Aug 2025'),
  (null, 'Onam',             'FESTIVAL', '2025-09-03', '2025-09-05', false, 'Thiruvonam on 5 Sep 2025'),
  (null, 'Navratri',         'FESTIVAL', '2025-09-22', '2025-10-01', false, 'Sharad Navratri'),
  (null, 'Dussehra',         'FESTIVAL', '2025-10-02', '2025-10-02', false, 'Vijayadashami on 2 Oct 2025'),
  (null, 'Pongal',           'FESTIVAL', '2026-01-13', '2026-01-16', false, 'Thai Pongal on 14 Jan 2026 (Makar Sankranti)'),
  (null, 'Eid al-Adha',      'FESTIVAL', '2026-05-26', '2026-05-28', true,  'Depends on moon sighting (~27/28 May 2026)'),
  (null, 'Onam',             'FESTIVAL', '2026-08-24', '2026-08-26', true,  'Thiruvonam expected 26 Aug 2026'),
  (null, 'Ganesh Chaturthi', 'FESTIVAL', '2026-09-12', '2026-09-14', true,  'Ganesh Chaturthi expected 14 Sep 2026'),
  (null, 'Navratri',         'FESTIVAL', '2026-10-11', '2026-10-19', true,  'Sharad Navratri expected 11–19 Oct 2026'),
  (null, 'Dussehra',         'FESTIVAL', '2026-10-20', '2026-10-20', true,  'Vijayadashami expected 20 Oct 2026'),
  (null, 'Pongal',           'FESTIVAL', '2027-01-13', '2027-01-16', true,  'Thai Pongal expected 14/15 Jan 2027'),
  (null, 'Eid al-Adha',      'FESTIVAL', '2027-05-15', '2027-05-17', true,  'Depends on moon sighting (~17 May 2027)'),
  (null, 'Ganesh Chaturthi', 'FESTIVAL', '2027-09-02', '2027-09-04', true,  'Ganesh Chaturthi expected 4 Sep 2027'),
  (null, 'Onam',             'FESTIVAL', '2027-09-10', '2027-09-12', true,  'Thiruvonam expected 12 Sep 2027'),
  (null, 'Navratri',         'FESTIVAL', '2027-09-30', '2027-10-08', true,  'Sharad Navratri expected 30 Sep–8 Oct 2027'),
  (null, 'Dussehra',         'FESTIVAL', '2027-10-09', '2027-10-09', true,  'Vijayadashami expected 9 Oct 2027')
on conflict do nothing;
