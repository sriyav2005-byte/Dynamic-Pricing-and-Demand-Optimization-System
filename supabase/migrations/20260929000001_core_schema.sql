-- ============================================================================
-- PriceIQ — core relational schema
-- ============================================================================
-- Target: Supabase PostgreSQL (15+). Also runs on plain PostgreSQL 15+ once
-- supabase/local/00_auth_shim.sql has been applied (provides auth.users,
-- auth.uid() and the anon/authenticated/service_role roles).
--
-- Conventions
--   * uuid primary keys (gen_random_uuid)
--   * money stored as numeric(12,2)
--   * every business row is scoped to a store (store_id) or organization
--   * created_at / updated_at timestamps on mutable tables
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;

-- ── Enumerations ────────────────────────────────────────────────────────────
-- app_role is declared in ascending privilege order so that the native enum
-- comparison operators (>=, max()) express "at least this role".
do $$ begin
  create type public.app_role as enum ('VIEWER', 'ANALYST', 'STORE_MANAGER', 'ADMIN', 'SUPER_ADMIN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pricing_mode as enum ('MANUAL', 'SEMI_AUTOMATIC', 'AUTOMATIC');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.data_status as enum ('LIVE', 'CACHED', 'ESTIMATED', 'UNAVAILABLE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.alert_severity as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.recommendation_status as enum
    ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'EXPIRED', 'SUPERSEDED');
exception when duplicate_object then null; end $$;

-- ── Generic updated_at trigger ──────────────────────────────────────────────
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ============================================================================
-- Tenancy: organizations → stores, users → memberships
-- ============================================================================

create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.stores (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  code             text not null,
  city             text,
  state            text,
  pincode          text check (pincode is null or pincode ~ '^[0-9]{6}$'),
  latitude         double precision check (latitude is null or latitude between -90 and 90),
  longitude        double precision check (longitude is null or longitude between -180 and 180),
  timezone         text not null default 'Asia/Kolkata',
  -- SYNTHETIC ⇒ store holds the historical training dataset; time-windowed
  -- analytics are anchored to its latest sale instead of today.
  data_mode        text not null default 'LIVE' check (data_mode in ('LIVE', 'SYNTHETIC')),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists stores_org_idx on public.stores(organization_id);

-- One profile per Supabase Auth user.
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  email           text,
  full_name       text,
  phone           text,
  is_super_admin  boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- store_id NULL ⇒ the role applies to every store in the organization.
create table if not exists public.memberships (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  store_id         uuid references public.stores(id) on delete cascade,
  role             public.app_role not null default 'VIEWER',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique nulls not distinct (user_id, organization_id, store_id)
);
create index if not exists memberships_user_idx on public.memberships(user_id);
create index if not exists memberships_org_idx on public.memberships(organization_id);
create index if not exists memberships_store_idx on public.memberships(store_id);

-- Per-store pricing configuration and business rules.
create table if not exists public.store_settings (
  store_id                   uuid primary key references public.stores(id) on delete cascade,
  pricing_mode               public.pricing_mode not null default 'MANUAL',
  min_margin_pct             numeric(6,4) not null default 0.10 check (min_margin_pct between 0 and 5),
  max_price_change_pct       numeric(6,4) not null default 0.10 check (max_price_change_pct between 0 and 1),
  approval_threshold_pct     numeric(6,4) not null default 0.05 check (approval_threshold_pct between 0 and 1),
  expiry_markdown_days       integer not null default 7 check (expiry_markdown_days between 0 and 365),
  max_expiry_markdown_pct    numeric(6,4) not null default 0.40 check (max_expiry_markdown_pct between 0 and 1),
  allow_below_cost_clearance boolean not null default false,
  low_stock_cover_days       integer not null default 3 check (low_stock_cover_days >= 0),
  overstock_cover_days       integer not null default 60 check (overstock_cover_days > 0),
  dead_stock_days            integer not null default 30 check (dead_stock_days > 0),
  competitor_undercut_pct    numeric(6,4) not null default 0.05 check (competitor_undercut_pct between 0 and 1),
  rules                      jsonb not null default '{}'::jsonb,
  updated_by                 uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- ============================================================================
-- Catalogue
-- ============================================================================

create table if not exists public.categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  parent_id        uuid references public.categories(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique nulls not distinct (organization_id, name, parent_id)
);
create index if not exists categories_org_idx on public.categories(organization_id);

create table if not exists public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  contact_email    text,
  phone            text,
  lead_time_days   integer not null default 3 check (lead_time_days between 0 and 365),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id) on delete cascade,
  legacy_product_id  integer,             -- id in the original synthetic training dataset
  sku                text not null check (length(trim(sku)) > 0),
  barcode            text,
  name               text not null check (length(trim(name)) > 0),
  brand              text,
  category_id        uuid references public.categories(id) on delete set null,
  subcategory        text,
  supplier_id        uuid references public.suppliers(id) on delete set null,
  image_url          text,
  cost_price         numeric(12,2) not null check (cost_price >= 0),
  selling_price      numeric(12,2) not null check (selling_price > 0),
  mrp                numeric(12,2) not null check (mrp > 0),
  stock              integer not null default 0 check (stock >= 0),
  reorder_level      integer not null default 0 check (reorder_level >= 0),
  safety_stock       integer not null default 0 check (safety_stock >= 0),
  expiry_date        date,
  batch_number       text,
  season_factor      numeric(6,3) not null default 1.0 check (season_factor > 0),
  is_perishable      boolean not null default false,
  is_active          boolean not null default true,
  is_synthetic       boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint products_price_le_mrp check (selling_price <= mrp),
  constraint products_cost_le_mrp  check (cost_price <= mrp),
  unique (store_id, sku)
);
create unique index if not exists products_store_barcode_uq on public.products(store_id, barcode) where barcode is not null;
create index if not exists products_store_idx on public.products(store_id);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_expiry_idx on public.products(store_id, expiry_date) where expiry_date is not null;
create index if not exists products_name_idx on public.products using btree (store_id, lower(name));
create index if not exists products_legacy_idx on public.products(legacy_product_id) where legacy_product_id is not null;

-- ============================================================================
-- Sales & inventory
-- ============================================================================

create table if not exists public.sales (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id) on delete cascade,
  product_id         uuid not null references public.products(id) on delete cascade,
  quantity           integer not null check (quantity > 0),
  unit_price         numeric(12,2) not null check (unit_price >= 0),
  unit_cost          numeric(12,2) not null check (unit_cost >= 0),
  revenue            numeric(14,2) generated always as (quantity * unit_price) stored,
  profit             numeric(14,2) generated always as (quantity * (unit_price - unit_cost)) stored,
  recommendation_id  uuid,
  source             text not null default 'MANUAL' check (source in ('POS', 'MANUAL', 'IMPORT', 'SYNTHETIC')),
  sold_at            timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists sales_store_time_idx on public.sales(store_id, sold_at desc);
create index if not exists sales_product_time_idx on public.sales(product_id, sold_at desc);

create table if not exists public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete cascade,
  change        integer not null check (change <> 0),
  reason        text not null check (reason in ('SALE', 'RESTOCK', 'ADJUSTMENT', 'WASTE', 'RETURN', 'IMPORT')),
  stock_after   integer not null check (stock_after >= 0),
  reference_id  uuid,
  note          text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists inventory_movements_product_idx on public.inventory_movements(product_id, created_at desc);
create index if not exists inventory_movements_store_idx on public.inventory_movements(store_id, created_at desc);

-- ============================================================================
-- Pricing
-- ============================================================================

create table if not exists public.model_versions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  version        text not null,
  algorithm      text not null,
  training_data  text not null default 'SYNTHETIC' check (training_data in ('SYNTHETIC', 'REAL', 'MIXED')),
  metrics        jsonb not null default '{}'::jsonb,
  features       jsonb not null default '[]'::jsonb,
  artifact_path  text,
  is_active      boolean not null default false,
  notes          text,
  trained_at     timestamptz not null default now(),
  unique (name, version)
);

create table if not exists public.pricing_recommendations (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references public.stores(id) on delete cascade,
  product_id           uuid not null references public.products(id) on delete cascade,
  current_price        numeric(12,2) not null check (current_price > 0),
  recommended_price    numeric(12,2) not null check (recommended_price > 0),
  model_price          numeric(12,2),         -- price proposed by the policy before constraints
  expected_demand      double precision,
  expected_revenue     numeric(14,2),
  expected_profit      numeric(14,2),
  expected_margin_pct  double precision,
  confidence           double precision check (confidence is null or confidence between 0 and 1),
  policy               text not null,
  model_version_id     uuid references public.model_versions(id) on delete set null,
  constraints_applied  jsonb not null default '[]'::jsonb,
  explanation          jsonb not null default '{}'::jsonb,
  context              jsonb not null default '{}'::jsonb,
  status               public.recommendation_status not null default 'PENDING',
  requires_approval    boolean not null default false,
  created_by           uuid references public.profiles(id) on delete set null,
  reviewed_by          uuid references public.profiles(id) on delete set null,
  reviewed_at          timestamptz,
  review_note          text,
  applied_by           uuid references public.profiles(id) on delete set null,
  applied_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists pricing_recs_store_status_idx on public.pricing_recommendations(store_id, status, created_at desc);
create index if not exists pricing_recs_product_idx on public.pricing_recommendations(product_id, created_at desc);

alter table public.sales
  drop constraint if exists sales_recommendation_fk,
  add constraint sales_recommendation_fk foreign key (recommendation_id)
    references public.pricing_recommendations(id) on delete set null;

create table if not exists public.pricing_history (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores(id) on delete cascade,
  product_id         uuid not null references public.products(id) on delete cascade,
  old_price          numeric(12,2),
  new_price          numeric(12,2) not null,
  source             text not null default 'MANUAL' check (source in ('MANUAL', 'RECOMMENDATION', 'AUTOMATIC', 'IMPORT', 'SYSTEM')),
  recommendation_id  uuid references public.pricing_recommendations(id) on delete set null,
  changed_by         uuid references public.profiles(id) on delete set null,
  reason             text,
  created_at         timestamptz not null default now()
);
create index if not exists pricing_history_product_idx on public.pricing_history(product_id, created_at desc);
create index if not exists pricing_history_store_idx on public.pricing_history(store_id, created_at desc);

create table if not exists public.bandit_states (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  policy      text not null,
  state       jsonb not null default '{}'::jsonb,
  n_updates   integer not null default 0,
  updated_at  timestamptz not null default now(),
  unique (product_id, policy)
);

create table if not exists public.price_elasticities (
  product_id   uuid primary key references public.products(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  status       text not null check (status in ('ESTIMATED', 'INSUFFICIENT_DATA', 'NOT_SIGNIFICANT')),
  elasticity   double precision,
  std_error    double precision,
  ci_low       double precision,
  ci_high      double precision,
  p_value      double precision,
  r_squared    double precision,
  n_obs        integer not null default 0,
  price_cv     double precision,           -- coefficient of variation of observed prices
  method       text not null,
  computed_at  timestamptz not null default now()
);
create index if not exists price_elasticities_store_idx on public.price_elasticities(store_id);

create table if not exists public.product_relationships (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references public.stores(id) on delete cascade,
  product_id          uuid not null references public.products(id) on delete cascade,
  related_product_id  uuid not null references public.products(id) on delete cascade,
  relationship        text not null check (relationship in ('SUBSTITUTE', 'COMPLEMENT')),
  cross_elasticity    double precision not null,
  std_error           double precision,
  p_value             double precision not null,
  n_obs               integer not null,
  method              text not null,
  computed_at         timestamptz not null default now(),
  check (product_id <> related_product_id),
  unique (product_id, related_product_id)
);
create index if not exists product_relationships_store_idx on public.product_relationships(store_id);

create table if not exists public.demand_forecasts (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete cascade,
  model_version_id  uuid references public.model_versions(id) on delete set null,
  horizon_days      integer not null check (horizon_days in (7, 14, 30)),
  forecast_date     date not null,
  predicted         double precision not null check (predicted >= 0),
  lower_bound       double precision not null check (lower_bound >= 0),
  upper_bound       double precision not null,
  generated_at      timestamptz not null default now(),
  check (upper_bound >= lower_bound)
);
create index if not exists demand_forecasts_product_idx on public.demand_forecasts(product_id, generated_at desc);

-- ============================================================================
-- Competitor intelligence
-- ============================================================================

-- Global list of competitor platforms (not tenant data).
create table if not exists public.competitors (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_]+$'),
  name        text not null,
  website     text,
  color       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- A store product matched to a listing on a competitor platform.
create table if not exists public.competitor_products (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.stores(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete cascade,
  competitor_id     uuid not null references public.competitors(id) on delete cascade,
  external_id       text,
  external_name     text,
  url               text,
  pack_size         text,
  match_confidence  double precision check (match_confidence is null or match_confidence between 0 and 1),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (product_id, competitor_id)
);
create index if not exists competitor_products_store_idx on public.competitor_products(store_id);

-- Latest observation per competitor product (upserted).
create table if not exists public.competitor_prices (
  competitor_product_id  uuid primary key references public.competitor_products(id) on delete cascade,
  store_id               uuid not null references public.stores(id) on delete cascade,
  price                  numeric(12,2) check (price is null or price > 0),
  mrp                    numeric(12,2) check (mrp is null or mrp > 0),
  discount_pct           double precision,
  in_stock               boolean,
  data_status            public.data_status not null,
  source                 text not null check (source in ('SCRAPE', 'API', 'MANUAL', 'ESTIMATE')),
  observed_at            timestamptz not null default now(),
  error                  text
);
create index if not exists competitor_prices_store_idx on public.competitor_prices(store_id);

-- Append-only history of every observation.
create table if not exists public.competitor_price_history (
  id                     uuid primary key default gen_random_uuid(),
  competitor_product_id  uuid not null references public.competitor_products(id) on delete cascade,
  store_id               uuid not null references public.stores(id) on delete cascade,
  price                  numeric(12,2) not null check (price > 0),
  mrp                    numeric(12,2),
  discount_pct           double precision,
  in_stock               boolean,
  source                 text not null check (source in ('SCRAPE', 'API', 'MANUAL', 'ESTIMATE')),
  observed_at            timestamptz not null default now()
);
create index if not exists competitor_price_history_idx on public.competitor_price_history(competitor_product_id, observed_at desc);
create index if not exists competitor_price_history_store_idx on public.competitor_price_history(store_id, observed_at desc);

-- ============================================================================
-- Seasonal events
-- ============================================================================

create table if not exists public.seasonal_events (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid references public.organizations(id) on delete cascade,  -- null ⇒ global
  name                 text not null,
  event_type           text not null check (event_type in ('FESTIVAL', 'NATIONAL_HOLIDAY', 'SEASON', 'CUSTOM')),
  start_date           date not null,
  end_date             date not null,
  region               text not null default 'IN',
  is_date_approximate  boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  check (end_date >= start_date),
  unique nulls not distinct (organization_id, name, start_date)
);
create index if not exists seasonal_events_dates_idx on public.seasonal_events(start_date, end_date);

-- ============================================================================
-- Alerts & notifications
-- ============================================================================

create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete cascade,
  product_id   uuid references public.products(id) on delete cascade,
  alert_type   text not null check (alert_type in (
                 'LOW_STOCK', 'PREDICTED_STOCKOUT', 'OVERSTOCK', 'DEAD_STOCK', 'EXPIRY',
                 'COMPETITOR_UNDERCUT', 'COMPETITOR_PRICE_CHANGE', 'DEMAND_SPIKE', 'DEMAND_DROP',
                 'PRICING_OPPORTUNITY', 'ANOMALY')),
  severity     public.alert_severity not null,
  title        text not null,
  message      text not null,
  metadata     jsonb not null default '{}'::jsonb,
  dedupe_key   text not null,
  status       text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create unique index if not exists alerts_open_dedupe_uq on public.alerts(store_id, dedupe_key) where status <> 'RESOLVED';
create index if not exists alerts_store_idx on public.alerts(store_id, status, severity, created_at desc);

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  store_id    uuid references public.stores(id) on delete cascade,
  alert_id    uuid references public.alerts(id) on delete cascade,
  title       text not null,
  body        text not null,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now(),
  unique (user_id, alert_id)
);
create index if not exists notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

-- ============================================================================
-- AI copilot
-- ============================================================================

create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations(user_id, updated_at desc);

create table if not exists public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  tool_calls       jsonb not null default '[]'::jsonb,
  sources          jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages(conversation_id, created_at);

-- ============================================================================
-- Audit log
-- ============================================================================

create table if not exists public.audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid references public.organizations(id) on delete cascade,
  store_id         uuid references public.stores(id) on delete cascade,
  user_id          uuid,   -- null ⇒ system action; no FK so logs survive user deletion
  action           text not null,
  entity_type      text not null,
  entity_id        text,
  old_value        jsonb,
  new_value        jsonb,
  reason           text,
  created_at       timestamptz not null default now()
);
create index if not exists audit_logs_store_idx on public.audit_logs(store_id, created_at desc);
create index if not exists audit_logs_org_idx on public.audit_logs(organization_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

-- ============================================================================
-- updated_at triggers
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['organizations', 'stores', 'profiles', 'memberships', 'store_settings',
                           'suppliers', 'products', 'pricing_recommendations', 'competitor_products',
                           'alerts', 'ai_conversations']
  loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I
                    for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;
