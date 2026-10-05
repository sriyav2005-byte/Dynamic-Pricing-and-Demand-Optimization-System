-- ============================================================================
-- PriceIQ — RBAC helpers, Row Level Security, grants and integrity triggers
-- ============================================================================
-- Roles (ascending): VIEWER < ANALYST < STORE_MANAGER < ADMIN < SUPER_ADMIN
--
--   VIEWER         read store data
--   ANALYST        + generate recommendations / simulations, acknowledge alerts
--   STORE_MANAGER  + edit products, inventory, sales, approve & apply prices
--   ADMIN          + store settings, pricing mode, memberships, stores (org-wide)
--   SUPER_ADMIN    platform operator (profiles.is_super_admin), sees everything
--
-- A membership with store_id NULL grants its role on every store of the org.
-- All helper functions are SECURITY DEFINER with an empty search_path so they
-- can read memberships without recursing into RLS.
-- ============================================================================

-- ── Role helpers ────────────────────────────────────────────────────────────

create or replace function app.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = auth.uid()), false)
$$;

-- Highest role the current user holds on a store (directly or org-wide).
create or replace function app.store_role(p_store_id uuid) returns public.app_role
language sql stable security definer set search_path = '' as $$
  select max(m.role)
  from public.memberships m
  join public.stores s on s.organization_id = m.organization_id
  where s.id = p_store_id
    and m.user_id = auth.uid()
    and (m.store_id is null or m.store_id = s.id)
$$;

create or replace function app.has_store_role(p_store_id uuid, p_min public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or coalesce(app.store_role(p_store_id) >= p_min, false)
$$;

-- Role held org-wide (store_id IS NULL) in an organization.
create or replace function app.has_org_role(p_org_id uuid, p_min public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or coalesce((
    select max(m.role) >= p_min
    from public.memberships m
    where m.organization_id = p_org_id and m.user_id = auth.uid() and m.store_id is null
  ), false)
$$;

-- Highest role in any scope (org-wide or any single store) of an organization.
create or replace function app.has_any_role_in_org(p_org_id uuid, p_min public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_super_admin() or coalesce((
    select max(m.role) >= p_min
    from public.memberships m
    where m.organization_id = p_org_id and m.user_id = auth.uid()
  ), false)
$$;

create or replace function app.is_org_member(p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_any_role_in_org(p_org_id, 'VIEWER')
$$;

-- True when the target user shares at least one organization with the caller.
create or replace function app.shares_org_with(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships a
    join public.memberships b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and b.user_id = p_user_id
  )
$$;

create or replace function app.store_in_org(p_store_id uuid, p_org_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_store_id is null
      or exists (select 1 from public.stores s where s.id = p_store_id and s.organization_id = p_org_id)
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

grant usage on schema public to authenticated, service_role;
grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
revoke all on all tables in schema public from anon;

-- Append-only / trigger-maintained tables: no direct writes by end users.
revoke insert, update, delete on public.audit_logs          from authenticated;
revoke insert, update, delete on public.pricing_history     from authenticated;
revoke insert, update, delete on public.inventory_movements from authenticated;
revoke insert, update, delete on public.model_versions      from authenticated;
revoke insert, update, delete on public.competitors         from authenticated;
revoke insert, update, delete on public.bandit_states       from authenticated;
revoke insert, update, delete on public.price_elasticities  from authenticated;
revoke insert, update, delete on public.product_relationships from authenticated;
revoke insert, update, delete on public.demand_forecasts    from authenticated;
revoke insert, delete         on public.organizations       from authenticated;

-- Users may edit only harmless profile columns (never is_super_admin).
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- Sales are immutable once recorded (corrections are new rows / returns).
revoke update on public.sales from authenticated;

-- Let the connecting role impersonate end users with SET LOCAL ROLE, which
-- is how the Go API makes RLS apply to its queries.
do $$ begin
  if not pg_has_role(current_user, 'authenticated', 'member') then
    execute format('grant authenticated to %I', current_user);
  end if;
exception when others then
  raise notice 'could not grant authenticated to %: %', current_user, sqlerrm;
end $$;

-- ── Enable RLS everywhere ───────────────────────────────────────────────────

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'stores', 'profiles', 'memberships', 'store_settings', 'categories', 'suppliers',
    'products', 'sales', 'inventory_movements', 'model_versions', 'pricing_recommendations',
    'pricing_history', 'bandit_states', 'price_elasticities', 'product_relationships',
    'demand_forecasts', 'competitors', 'competitor_products', 'competitor_prices',
    'competitor_price_history', 'seasonal_events', 'alerts', 'notifications',
    'ai_conversations', 'ai_messages', 'audit_logs']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Helper to (re)create a policy idempotently.
create or replace function app._policy(p_table text, p_name text, p_cmd text, p_using text, p_check text default null)
returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', p_name, p_table);
  if p_cmd = 'INSERT' then
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
                   p_name, p_table, coalesce(p_check, p_using));
  elsif p_cmd = 'UPDATE' then
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
                   p_name, p_table, p_using, coalesce(p_check, p_using));
  else
    execute format('create policy %I on public.%I for %s to authenticated using (%s)',
                   p_name, p_table, p_cmd, p_using);
  end if;
end $$;

-- organizations
select app._policy('organizations', 'org_select', 'SELECT', 'app.is_org_member(id)');
select app._policy('organizations', 'org_update', 'UPDATE', 'app.has_org_role(id, ''ADMIN'')');

-- stores
select app._policy('stores', 'stores_select', 'SELECT', 'app.has_store_role(id, ''VIEWER'')');
select app._policy('stores', 'stores_insert', 'INSERT', 'app.has_org_role(organization_id, ''ADMIN'')');
select app._policy('stores', 'stores_update', 'UPDATE', 'app.has_org_role(organization_id, ''ADMIN'')');
select app._policy('stores', 'stores_delete', 'DELETE', 'app.has_org_role(organization_id, ''ADMIN'')');

-- profiles
select app._policy('profiles', 'profiles_select', 'SELECT',
  'id = auth.uid() or app.shares_org_with(id) or app.is_super_admin()');
select app._policy('profiles', 'profiles_update', 'UPDATE', 'id = auth.uid()');

-- memberships: org admins manage; nobody can grant SUPER_ADMIN through RLS.
select app._policy('memberships', 'memberships_select', 'SELECT',
  'user_id = auth.uid() or app.has_org_role(organization_id, ''ADMIN'')');
select app._policy('memberships', 'memberships_insert', 'INSERT',
  'app.has_org_role(organization_id, ''ADMIN'') and role < ''SUPER_ADMIN'' and app.store_in_org(store_id, organization_id)');
select app._policy('memberships', 'memberships_update', 'UPDATE',
  'app.has_org_role(organization_id, ''ADMIN'')',
  'app.has_org_role(organization_id, ''ADMIN'') and role < ''SUPER_ADMIN'' and app.store_in_org(store_id, organization_id)');
select app._policy('memberships', 'memberships_delete', 'DELETE', 'app.has_org_role(organization_id, ''ADMIN'')');

-- store_settings
select app._policy('store_settings', 'store_settings_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('store_settings', 'store_settings_insert', 'INSERT', 'app.has_store_role(store_id, ''ADMIN'')');
select app._policy('store_settings', 'store_settings_update', 'UPDATE', 'app.has_store_role(store_id, ''ADMIN'')');

-- categories / suppliers (organization scoped)
select app._policy('categories', 'categories_select', 'SELECT', 'app.is_org_member(organization_id)');
select app._policy('categories', 'categories_insert', 'INSERT', 'app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');
select app._policy('categories', 'categories_update', 'UPDATE', 'app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');
select app._policy('categories', 'categories_delete', 'DELETE', 'app.has_org_role(organization_id, ''ADMIN'')');
select app._policy('suppliers', 'suppliers_select', 'SELECT', 'app.is_org_member(organization_id)');
select app._policy('suppliers', 'suppliers_insert', 'INSERT', 'app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');
select app._policy('suppliers', 'suppliers_update', 'UPDATE', 'app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');
select app._policy('suppliers', 'suppliers_delete', 'DELETE', 'app.has_org_role(organization_id, ''ADMIN'')');

-- products
select app._policy('products', 'products_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('products', 'products_insert', 'INSERT', 'app.has_store_role(store_id, ''STORE_MANAGER'')');
select app._policy('products', 'products_update', 'UPDATE', 'app.has_store_role(store_id, ''STORE_MANAGER'')');
select app._policy('products', 'products_delete', 'DELETE', 'app.has_store_role(store_id, ''STORE_MANAGER'')');

-- sales (product must belong to the same store)
select app._policy('sales', 'sales_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('sales', 'sales_insert', 'INSERT',
  'app.has_store_role(store_id, ''STORE_MANAGER'') and exists (select 1 from public.products p where p.id = product_id and p.store_id = sales.store_id)');
select app._policy('sales', 'sales_delete', 'DELETE', 'app.has_store_role(store_id, ''ADMIN'')');

-- read-only (for end users) store-scoped tables
select app._policy('inventory_movements',   'inventory_movements_select',   'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('pricing_history',       'pricing_history_select',       'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('bandit_states',         'bandit_states_select',         'SELECT', 'app.has_store_role(store_id, ''ANALYST'')');
select app._policy('price_elasticities',    'price_elasticities_select',    'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('product_relationships', 'product_relationships_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('demand_forecasts',      'demand_forecasts_select',      'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');

-- pricing recommendations
select app._policy('pricing_recommendations', 'pricing_recs_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('pricing_recommendations', 'pricing_recs_insert', 'INSERT',
  'app.has_store_role(store_id, ''ANALYST'') and exists (select 1 from public.products p where p.id = product_id and p.store_id = pricing_recommendations.store_id)');
select app._policy('pricing_recommendations', 'pricing_recs_update', 'UPDATE', 'app.has_store_role(store_id, ''STORE_MANAGER'')');

-- global reference tables
select app._policy('competitors',    'competitors_select',    'SELECT', 'true');
select app._policy('model_versions', 'model_versions_select', 'SELECT', 'true');

-- competitor mappings & observations
select app._policy('competitor_products', 'competitor_products_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('competitor_products', 'competitor_products_insert', 'INSERT',
  'app.has_store_role(store_id, ''STORE_MANAGER'') and exists (select 1 from public.products p where p.id = product_id and p.store_id = competitor_products.store_id)');
select app._policy('competitor_products', 'competitor_products_update', 'UPDATE', 'app.has_store_role(store_id, ''STORE_MANAGER'')');
select app._policy('competitor_products', 'competitor_products_delete', 'DELETE', 'app.has_store_role(store_id, ''STORE_MANAGER'')');
-- End users may only record MANUAL observations; scraped data is written by the service.
select app._policy('competitor_prices', 'competitor_prices_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('competitor_prices', 'competitor_prices_insert', 'INSERT',
  'app.has_store_role(store_id, ''STORE_MANAGER'') and source = ''MANUAL''');
select app._policy('competitor_prices', 'competitor_prices_update', 'UPDATE',
  'app.has_store_role(store_id, ''STORE_MANAGER'')', 'app.has_store_role(store_id, ''STORE_MANAGER'') and source = ''MANUAL''');
select app._policy('competitor_price_history', 'competitor_price_history_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('competitor_price_history', 'competitor_price_history_insert', 'INSERT',
  'app.has_store_role(store_id, ''STORE_MANAGER'') and source = ''MANUAL''');
revoke update, delete on public.competitor_price_history from authenticated;

-- seasonal events
select app._policy('seasonal_events', 'seasonal_events_select', 'SELECT',
  'organization_id is null or app.is_org_member(organization_id)');
select app._policy('seasonal_events', 'seasonal_events_insert', 'INSERT',
  'organization_id is not null and app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');
select app._policy('seasonal_events', 'seasonal_events_update', 'UPDATE',
  'organization_id is not null and app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');
select app._policy('seasonal_events', 'seasonal_events_delete', 'DELETE',
  'organization_id is not null and app.has_any_role_in_org(organization_id, ''STORE_MANAGER'')');

-- alerts (created by the service; users acknowledge/resolve)
select app._policy('alerts', 'alerts_select', 'SELECT', 'app.has_store_role(store_id, ''VIEWER'')');
select app._policy('alerts', 'alerts_update', 'UPDATE', 'app.has_store_role(store_id, ''ANALYST'')');
revoke insert, delete on public.alerts from authenticated;

-- notifications: strictly personal
select app._policy('notifications', 'notifications_select', 'SELECT', 'user_id = auth.uid()');
select app._policy('notifications', 'notifications_update', 'UPDATE', 'user_id = auth.uid()');
select app._policy('notifications', 'notifications_delete', 'DELETE', 'user_id = auth.uid()');
revoke insert on public.notifications from authenticated;

-- AI conversations: personal and store-bound
select app._policy('ai_conversations', 'ai_conversations_select', 'SELECT', 'user_id = auth.uid()');
select app._policy('ai_conversations', 'ai_conversations_insert', 'INSERT',
  'user_id = auth.uid() and app.has_store_role(store_id, ''VIEWER'')');
select app._policy('ai_conversations', 'ai_conversations_update', 'UPDATE', 'user_id = auth.uid()');
select app._policy('ai_conversations', 'ai_conversations_delete', 'DELETE', 'user_id = auth.uid()');
select app._policy('ai_messages', 'ai_messages_select', 'SELECT',
  'exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())');
select app._policy('ai_messages', 'ai_messages_insert', 'INSERT',
  'exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())');
revoke update on public.ai_messages from authenticated;

-- audit logs: managers see their store, org admins see org-level entries
select app._policy('audit_logs', 'audit_logs_select', 'SELECT',
  '(store_id is not null and app.has_store_role(store_id, ''STORE_MANAGER''))
   or (organization_id is not null and app.has_org_role(organization_id, ''ADMIN''))');

drop function app._policy(text, text, text, text, text);

-- ============================================================================
-- Integrity triggers
-- ============================================================================

-- ── Audit log ───────────────────────────────────────────────────────────────
-- Records who changed what. Only changed keys are stored for UPDATEs.
-- The API sets `app.audit_reason` (transaction-local) to attach a reason.
create or replace function app.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_store uuid;
  v_org uuid;
  v_entity text;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(key, value) into v_new
      from jsonb_each(to_jsonb(new)) where key <> 'updated_at' and v_old -> key is distinct from value;
    if v_new is null then return new; end if;   -- nothing meaningful changed
    select jsonb_object_agg(key, v_old -> key) into v_old from jsonb_object_keys(v_new) key;
  end if;

  v_entity := coalesce(to_jsonb(coalesce(new, old)) ->> 'id', to_jsonb(coalesce(new, old)) ->> 'store_id');
  v_store  := case when tg_table_name = 'stores' then (to_jsonb(coalesce(new, old)) ->> 'id')::uuid
                   else nullif(to_jsonb(coalesce(new, old)) ->> 'store_id', '')::uuid end;
  v_org    := nullif(to_jsonb(coalesce(new, old)) ->> 'organization_id', '')::uuid;
  if v_org is null and v_store is not null then
    select s.organization_id into v_org from public.stores s where s.id = v_store;
  end if;

  insert into public.audit_logs (organization_id, store_id, user_id, action, entity_type, entity_id,
                                 old_value, new_value, reason)
  values (v_org, v_store, auth.uid(), lower(tg_op), tg_table_name, v_entity,
          v_old, v_new, nullif(current_setting('app.audit_reason', true), ''));
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['products', 'memberships', 'store_settings', 'pricing_recommendations',
                           'stores', 'profiles', 'organizations', 'suppliers', 'categories']
  loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I
                    for each row execute function app.audit_trigger()', t, t);
  end loop;
end $$;

-- ── Price history ───────────────────────────────────────────────────────────
-- Every change of products.selling_price is recorded, whatever the code path.
-- The API sets app.price_source / app.recommendation_id / app.audit_reason.
create or replace function app.price_history_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.selling_price is distinct from old.selling_price then
    insert into public.pricing_history (store_id, product_id, old_price, new_price, source,
                                        recommendation_id, changed_by, reason)
    values (new.store_id, new.id,
            case when tg_op = 'UPDATE' then old.selling_price end,
            new.selling_price,
            coalesce(nullif(current_setting('app.price_source', true), ''),
                     case when tg_op = 'INSERT' then 'IMPORT' else 'MANUAL' end),
            nullif(current_setting('app.recommendation_id', true), '')::uuid,
            auth.uid(),
            nullif(current_setting('app.audit_reason', true), ''));
  end if;
  return new;
end $$;

drop trigger if exists products_price_history on public.products;
create trigger products_price_history after insert or update of selling_price on public.products
  for each row execute function app.price_history_trigger();

-- ── Inventory movements ─────────────────────────────────────────────────────
-- Every change of products.stock produces a movement row.
-- The API sets app.stock_reason ('SALE', 'RESTOCK', ...) and app.stock_ref.
create or replace function app.stock_movement_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_change integer;
begin
  v_change := new.stock - case when tg_op = 'UPDATE' then old.stock else 0 end;
  if v_change <> 0 then
    insert into public.inventory_movements (store_id, product_id, change, reason, stock_after,
                                            reference_id, note, created_by)
    values (new.store_id, new.id, v_change,
            coalesce(nullif(current_setting('app.stock_reason', true), ''),
                     case when tg_op = 'INSERT' then 'IMPORT' else 'ADJUSTMENT' end),
            new.stock,
            nullif(current_setting('app.stock_ref', true), '')::uuid,
            nullif(current_setting('app.audit_reason', true), ''),
            auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists products_stock_movement on public.products;
create trigger products_stock_movement after insert or update of stock on public.products
  for each row execute function app.stock_movement_trigger();

-- ── Cross-store integrity for store-scoped children ─────────────────────────
-- Guards against rows whose store_id disagrees with their product's store.
create or replace function app.check_product_store() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.products p where p.id = new.product_id and p.store_id = new.store_id) then
    raise exception 'product % does not belong to store %', new.product_id, new.store_id
      using errcode = '23514';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales', 'pricing_recommendations', 'competitor_products', 'alerts',
                           'demand_forecasts', 'bandit_states', 'price_elasticities']
  loop
    execute format('drop trigger if exists %I_product_store on public.%I', t, t);
    execute format('create trigger %I_product_store before insert or update on public.%I
                    for each row when (new.product_id is not null)
                    execute function app.check_product_store()', t, t);
  end loop;
end $$;

-- ── New Supabase Auth user → profile (+ optional organization/store) ───────
-- If the sign-up metadata carries a store_name, a new organization, store,
-- default settings and an ADMIN membership are created for the user.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_org uuid;
  v_store uuid;
  v_store_name text := nullif(trim(v_meta ->> 'store_name'), '');
  v_slug text;
begin
  insert into public.profiles (id, email, full_name, phone)
  values (new.id, new.email, nullif(trim(v_meta ->> 'full_name'), ''), nullif(trim(v_meta ->> 'phone'), ''))
  on conflict (id) do nothing;

  if v_store_name is not null then
    v_slug := trim(both '-' from regexp_replace(lower(v_store_name), '[^a-z0-9]+', '-', 'g'))
              || '-' || substr(replace(new.id::text, '-', ''), 1, 6);
    insert into public.organizations (name, slug) values (v_store_name, v_slug) returning id into v_org;
    insert into public.stores (organization_id, name, code, city, state, pincode)
    values (v_org, v_store_name, 'MAIN',
            nullif(trim(v_meta ->> 'city'), ''), nullif(trim(v_meta ->> 'state'), ''),
            case when coalesce(v_meta ->> 'pincode', '') ~ '^[0-9]{6}$' then v_meta ->> 'pincode' end)
    returning id into v_store;   -- default store_settings row comes from stores_default_settings
    insert into public.memberships (user_id, organization_id, store_id, role)
    values (new.id, v_org, null, 'ADMIN');
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Keep profiles.email in sync with auth.users.
create or replace function app.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function app.handle_user_email_change();

-- Every store gets default settings.
create or replace function app.handle_new_store() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.store_settings (store_id) values (new.id) on conflict (store_id) do nothing;
  return new;
end $$;

drop trigger if exists stores_default_settings on public.stores;
create trigger stores_default_settings after insert on public.stores
  for each row execute function app.handle_new_store();
