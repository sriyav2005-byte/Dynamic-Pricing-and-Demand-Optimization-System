-- ============================================================================
-- PriceIQ — inventory metrics
-- ============================================================================

-- Point in time that time-windowed analytics are anchored to. LIVE stores use
-- now(); SYNTHETIC (historical dataset) stores use their latest sale so that
-- "last 28 days" means the last 28 days of available data.
create or replace function app.store_reference_time(p_store_id uuid) returns timestamptz
language sql stable set search_path = '' as $$
  select case when s.data_mode = 'SYNTHETIC'
              then coalesce((select max(sa.sold_at) from public.sales sa where sa.store_id = s.id), now())
              else now() end
  from public.stores s where s.id = p_store_id
$$;
grant execute on function app.store_reference_time(uuid) to authenticated, service_role;

-- Per-product sales velocity over the 28 days before the reference time.
-- Days without sales count as zero demand. security_invoker ⇒ RLS applies.
create or replace view public.product_inventory_metrics with (security_invoker = true) as
select
  p.id                                                    as product_id,
  p.store_id,
  r.t                                                     as reference_time,
  coalesce(v.units, 0)::integer                           as units_28d,
  coalesce(v.units, 0) / 28.0                             as avg_daily_units,
  sqrt(greatest(coalesce(v.sumsq, 0) / 28.0 - power(coalesce(v.units, 0) / 28.0, 2), 0)) as std_daily_units,
  coalesce(v.days_with_sales, 0)::integer                 as days_with_sales_28d,
  ls.last_sold_at,
  coalesce(sup.lead_time_days, 3)                         as lead_time_days
from public.products p
cross join lateral (select app.store_reference_time(p.store_id) as t) r
left join lateral (
  select sum(x.q) as units, sum(x.q * x.q) as sumsq, count(*) as days_with_sales
  from (
    select date_trunc('day', sa.sold_at) as d, sum(sa.quantity)::numeric as q
    from public.sales sa
    where sa.product_id = p.id and sa.sold_at > r.t - interval '28 days' and sa.sold_at <= r.t
    group by 1
  ) x
) v on true
left join lateral (
  select max(sa.sold_at) as last_sold_at from public.sales sa where sa.product_id = p.id
) ls on true
left join public.suppliers sup on sup.id = p.supplier_id;

grant select on public.product_inventory_metrics to authenticated, service_role;
