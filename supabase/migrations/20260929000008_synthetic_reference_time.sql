-- SYNTHETIC (historical dataset) stores stay anchored to their last *synthetic*
-- sale. Sales recorded live in a demo store (closed-loop feedback demos) still
-- update stock and the bandit, but must not move the analysis window to today —
-- that would empty every 28-day window and flag everything as dead stock.
create or replace function app.store_reference_time(p_store_id uuid) returns timestamptz
language sql stable set search_path = '' as $$
  select case when s.data_mode = 'SYNTHETIC'
              then coalesce((select max(sa.sold_at) from public.sales sa where sa.store_id = s.id and sa.source = 'SYNTHETIC'),
                            (select max(sa.sold_at) from public.sales sa where sa.store_id = s.id),
                            now())
              else now() end
  from public.stores s where s.id = p_store_id
$$;
