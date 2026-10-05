-- Audit logs are historical records: they must survive (and must not block)
-- deletion of the stores/organizations they describe. With foreign keys, the
-- audit rows written while an organization delete cascades would violate the
-- constraint and abort the delete.
alter table public.audit_logs drop constraint if exists audit_logs_organization_id_fkey;
alter table public.audit_logs drop constraint if exists audit_logs_store_id_fkey;
