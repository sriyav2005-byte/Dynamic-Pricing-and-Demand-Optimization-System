-- ============================================================================
-- PriceIQ — RAG knowledge base + global reference data
-- ============================================================================

-- ── Knowledge base for the Retail Copilot (RAG) ─────────────────────────────
-- Embeddings are always stored as real[] (portable). When the pgvector
-- extension is available (it is on Supabase) an additional vector(512)
-- column with an HNSW index is used for similarity search.

create table if not exists public.knowledge_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete cascade,  -- null ⇒ global
  title            text not null,
  doc_type         text not null check (doc_type in
                     ('PRICING_POLICY', 'INVENTORY_RULE', 'BUSINESS_RULE', 'PRODUCT_DOC', 'OPERATIONS')),
  source           text,
  content          text not null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists knowledge_documents_org_idx on public.knowledge_documents(organization_id);

create table if not exists public.knowledge_chunks (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.knowledge_documents(id) on delete cascade,
  organization_id  uuid references public.organizations(id) on delete cascade,
  chunk_index      integer not null,
  content          text not null,
  embedding        real[] not null,
  embedding_model  text not null,
  created_at       timestamptz not null default now(),
  unique (document_id, chunk_index)
);
create index if not exists knowledge_chunks_org_idx on public.knowledge_chunks(organization_id);

do $$
begin
  begin
    create extension if not exists vector;
  exception when others then
    raise notice 'pgvector not available (%); RAG will use array similarity in the AI service', sqlerrm;
  end;
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute 'alter table public.knowledge_chunks add column if not exists embedding_vec vector(512)';
    execute 'create index if not exists knowledge_chunks_vec_idx on public.knowledge_chunks
             using hnsw (embedding_vec vector_cosine_ops)';
  end if;
end $$;

drop trigger if exists knowledge_documents_touch on public.knowledge_documents;
create trigger knowledge_documents_touch before update on public.knowledge_documents
  for each row execute function app.touch_updated_at();

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
grant select, insert, update, delete on public.knowledge_documents to authenticated;
grant select on public.knowledge_chunks to authenticated;
grant all on public.knowledge_documents, public.knowledge_chunks to service_role;
revoke all on public.knowledge_documents, public.knowledge_chunks from anon;

drop policy if exists knowledge_documents_select on public.knowledge_documents;
create policy knowledge_documents_select on public.knowledge_documents for select to authenticated
  using (organization_id is null or app.is_org_member(organization_id));
drop policy if exists knowledge_documents_write on public.knowledge_documents;
create policy knowledge_documents_write on public.knowledge_documents for all to authenticated
  using (organization_id is not null and app.has_org_role(organization_id, 'ADMIN'))
  with check (organization_id is not null and app.has_org_role(organization_id, 'ADMIN'));
drop policy if exists knowledge_chunks_select on public.knowledge_chunks;
create policy knowledge_chunks_select on public.knowledge_chunks for select to authenticated
  using (organization_id is null or app.is_org_member(organization_id));

-- ── Competitor platforms ────────────────────────────────────────────────────
insert into public.competitors (key, name, website, color) values
  ('blinkit',   'Blinkit',          'https://blinkit.com',            '#F7CB45'),
  ('zepto',     'Zepto',            'https://www.zeptonow.com',       '#7B2FF7'),
  ('instamart', 'Swiggy Instamart', 'https://www.swiggy.com/instamart', '#FC8019'),
  ('bigbasket', 'BigBasket',        'https://www.bigbasket.com',      '#84C225')
on conflict (key) do update set name = excluded.name, website = excluded.website, color = excluded.color;

-- ── Seasonal events (India) ─────────────────────────────────────────────────
-- Windows include the main pre-festival shopping days. Lunar-calendar
-- festival dates for future years are flagged is_date_approximate and should
-- be confirmed against the official government holiday list.
insert into public.seasonal_events (organization_id, name, event_type, start_date, end_date, is_date_approximate, notes)
values
  -- 2023 (covers the synthetic training history)
  (null, 'New Year',          'FESTIVAL',         '2022-12-30', '2023-01-01', false, null),
  (null, 'Republic Day',      'NATIONAL_HOLIDAY', '2023-01-26', '2023-01-26', false, null),
  (null, 'Holi',              'FESTIVAL',         '2023-03-06', '2023-03-08', false, 'Holi on 8 Mar 2023'),
  (null, 'Eid al-Fitr',       'FESTIVAL',         '2023-04-20', '2023-04-22', false, 'Eid on 22 Apr 2023'),
  (null, 'Independence Day',  'NATIONAL_HOLIDAY', '2023-08-15', '2023-08-15', false, null),
  (null, 'Raksha Bandhan',    'FESTIVAL',         '2023-08-27', '2023-08-30', false, 'Raksha Bandhan on 30 Aug 2023'),
  (null, 'Diwali',            'FESTIVAL',         '2023-11-08', '2023-11-13', false, 'Diwali on 12 Nov 2023; window starts at Dhanteras week'),
  (null, 'Christmas',         'FESTIVAL',         '2023-12-22', '2023-12-25', false, null),
  -- 2024
  (null, 'New Year',          'FESTIVAL',         '2023-12-30', '2024-01-01', false, null),
  (null, 'Republic Day',      'NATIONAL_HOLIDAY', '2024-01-26', '2024-01-26', false, null),
  (null, 'Holi',              'FESTIVAL',         '2024-03-23', '2024-03-25', false, 'Holi on 25 Mar 2024'),
  (null, 'Eid al-Fitr',       'FESTIVAL',         '2024-04-09', '2024-04-11', false, 'Eid on 11 Apr 2024'),
  (null, 'Independence Day',  'NATIONAL_HOLIDAY', '2024-08-15', '2024-08-15', false, null),
  (null, 'Raksha Bandhan',    'FESTIVAL',         '2024-08-16', '2024-08-19', false, 'Raksha Bandhan on 19 Aug 2024'),
  (null, 'Diwali',            'FESTIVAL',         '2024-10-28', '2024-11-02', false, 'Diwali on 31 Oct/1 Nov 2024'),
  (null, 'Christmas',         'FESTIVAL',         '2024-12-22', '2024-12-25', false, null),
  -- 2025
  (null, 'New Year',          'FESTIVAL',         '2024-12-30', '2025-01-01', false, null),
  (null, 'Republic Day',      'NATIONAL_HOLIDAY', '2025-01-26', '2025-01-26', false, null),
  (null, 'Holi',              'FESTIVAL',         '2025-03-12', '2025-03-14', false, 'Holi on 14 Mar 2025'),
  (null, 'Eid al-Fitr',       'FESTIVAL',         '2025-03-29', '2025-03-31', false, 'Eid on 31 Mar 2025'),
  (null, 'Raksha Bandhan',    'FESTIVAL',         '2025-08-06', '2025-08-09', false, 'Raksha Bandhan on 9 Aug 2025'),
  (null, 'Independence Day',  'NATIONAL_HOLIDAY', '2025-08-15', '2025-08-15', false, null),
  (null, 'Diwali',            'FESTIVAL',         '2025-10-16', '2025-10-21', false, 'Diwali on 20/21 Oct 2025'),
  (null, 'Christmas',         'FESTIVAL',         '2025-12-22', '2025-12-25', false, null),
  -- 2026
  (null, 'New Year',          'FESTIVAL',         '2025-12-30', '2026-01-01', false, null),
  (null, 'Republic Day',      'NATIONAL_HOLIDAY', '2026-01-26', '2026-01-26', false, null),
  (null, 'Holi',              'FESTIVAL',         '2026-03-02', '2026-03-04', true,  'Holi expected 4 Mar 2026'),
  (null, 'Eid al-Fitr',       'FESTIVAL',         '2026-03-18', '2026-03-21', true,  'Depends on moon sighting (~20/21 Mar 2026)'),
  (null, 'Independence Day',  'NATIONAL_HOLIDAY', '2026-08-15', '2026-08-15', false, null),
  (null, 'Raksha Bandhan',    'FESTIVAL',         '2026-08-25', '2026-08-28', true,  'Raksha Bandhan expected 28 Aug 2026'),
  (null, 'Diwali',            'FESTIVAL',         '2026-11-04', '2026-11-09', true,  'Diwali expected 8 Nov 2026'),
  (null, 'Christmas',         'FESTIVAL',         '2026-12-22', '2026-12-25', false, null),
  -- 2027
  (null, 'New Year',          'FESTIVAL',         '2026-12-30', '2027-01-01', false, null),
  (null, 'Republic Day',      'NATIONAL_HOLIDAY', '2027-01-26', '2027-01-26', false, null),
  (null, 'Eid al-Fitr',       'FESTIVAL',         '2027-03-08', '2027-03-11', true,  'Depends on moon sighting (~10 Mar 2027)'),
  (null, 'Holi',              'FESTIVAL',         '2027-03-20', '2027-03-22', true,  'Holi expected 22 Mar 2027'),
  (null, 'Independence Day',  'NATIONAL_HOLIDAY', '2027-08-15', '2027-08-15', false, null),
  (null, 'Raksha Bandhan',    'FESTIVAL',         '2027-08-14', '2027-08-17', true,  'Raksha Bandhan expected 17 Aug 2027'),
  (null, 'Diwali',            'FESTIVAL',         '2027-10-25', '2027-10-30', true,  'Diwali expected 29 Oct 2027'),
  (null, 'Christmas',         'FESTIVAL',         '2027-12-22', '2027-12-25', false, null)
on conflict do nothing;

-- Climatic seasons (IMD convention) for 2023–2027.
insert into public.seasonal_events (organization_id, name, event_type, start_date, end_date, notes)
select null, s.name, 'SEASON', make_date(y, s.start_month, 1),
       (make_date(y, s.start_month, 1) + make_interval(months => s.months) - interval '1 day')::date,
       'IMD seasonal convention'
from generate_series(2022, 2027) y
cross join (values
  ('Summer',       3, 3),
  ('Monsoon',      6, 4),
  ('Post-monsoon', 10, 2),
  ('Winter',       12, 3)
) as s(name, start_month, months)
on conflict do nothing;
