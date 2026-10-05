-- SKUs are identifiers people type in different cases ("abc-1" vs "ABC-1");
-- enforce uniqueness per store case-insensitively.
-- Fails (intentionally) if a store already holds case-only duplicates; resolve them first.
alter table public.products drop constraint if exists products_store_id_sku_key;
create unique index if not exists products_store_sku_ci_uq on public.products (store_id, lower(sku));
