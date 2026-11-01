-- 0007_evidence_replacement_order — fix the replacement order inside mrv_store_evidence_document
--
-- Bug in 0006 (CONFIRMED live and reproduced on real PostgreSQL): the RPC retired the previous document
-- (update … superseded_by = <new id>) BEFORE inserting the new document row. The evidence_document_superseded_by_fkey
-- foreign key (not deferrable) therefore pointed at a row that did not exist yet, and every replacement failed with
-- 'Request violates a data constraint' (23503). First (non-replacing) uploads were never affected.
--
-- Fix (this migration): insert the NEW document first, then retire the old one in the same transaction. The
-- transaction is still atomic — if anything fails, nothing is stored or retired. Additive: replaces the function
-- only; no table, trigger, policy, grant or data is changed.

create or replace function public.mrv_store_evidence_document(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  b jsonb;
  v_id uuid;
  v_replaces uuid;
  v_old public.evidence_document;
  v_path text;
  v_prefix text;
begin
  v_key := mrv_private.verify_executor('evidence', p_tenant, p_facility, p_body, p_auth);
  if not mrv_auth.has_permission(p_tenant, p_facility, 'upload.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  b := p_body::jsonb;
  v_id := mrv_auth.try_uuid(b->>'id');
  if v_id is null then raise exception 'invalid evidence document body' using errcode = '22023'; end if;
  if length(btrim(coalesce(b->>'evidence_id', ''))) not between 1 and 120
     or coalesce(b->>'category', '') not in ('', 'production', 'rawMaterial', 'kilnFuel', 'electricity')
     or coalesce(b->>'mime', '') not in (
       'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'image/jpeg', 'image/png')
     or (b->>'size_bytes')::bigint not between 1 and 10485760
     or coalesce(b->>'sha256', '') !~ '^[0-9a-f]{64}$'
     or length(btrim(coalesce(b->>'filename', ''))) not between 1 and 120
     or coalesce(b->>'coverage_start', '') not similar to '(\d{4}-\d{2}-\d{2}|)'
     or coalesce(b->>'coverage_end', '') not similar to '(\d{4}-\d{2}-\d{2}|)'
     or (coalesce(b->>'coverage_start', '') = '' and coalesce(b->>'coverage_end', '') <> '')
     or (coalesce(b->>'coverage_end', '') = '' and coalesce(b->>'coverage_start', '') <> '')
     or (coalesce(b->>'coverage_start', '') <> '' and (b->>'coverage_end')::date < (b->>'coverage_start')::date) then
    raise exception 'invalid evidence document body' using errcode = '22023';
  end if;
  v_path := b->>'storage_path';
  v_prefix := p_tenant::text || '/' || p_facility::text || '/evidence/' || v_id::text || '/';
  if v_path is null or left(v_path, length(v_prefix)) <> v_prefix or v_path like '%..%' or length(v_path) - length(v_prefix) < 1 then
    raise exception 'storage path must stay inside the evidence document''s own folder' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_facility::text, 0));

  -- Replacement: lock and re-validate the current document of the SAME evidence reference.
  v_replaces := mrv_auth.try_uuid(b->>'replaces');
  if coalesce(b->>'replaces', '') <> '' and v_replaces is null then
    raise exception 'invalid evidence document body' using errcode = '22023';
  end if;
  if v_replaces is not null then
    select * into v_old from public.evidence_document x
      where x.tenant_id = p_tenant and x.facility_id = p_facility and x.id = v_replaces and x.is_current
      for update;
    if v_old.id is null then
      raise exception 'the document being replaced was not found or is no longer current' using errcode = '22023';
    end if;
    if v_old.evidence_id <> btrim(b->>'evidence_id') then
      raise exception 'a replacement must keep the same evidence reference' using errcode = '22023';
    end if;
  end if;

  insert into public.evidence_document (id, tenant_id, facility_id, evidence_id, category, coverage_start, coverage_end,
    filename, mime, size_bytes, sha256, storage_path, uploaded_by)
  values (v_id, p_tenant, p_facility, btrim(b->>'evidence_id'), nullif(btrim(b->>'category'), ''),
    nullif(b->>'coverage_start', '')::date, nullif(b->>'coverage_end', '')::date,
    btrim(b->>'filename'), b->>'mime', (b->>'size_bytes')::bigint, b->>'sha256', v_path, v_uid);

  -- Retire the previous document AFTER the new row exists, so superseded_by always references a present row.
  if v_replaces is not null then
    update public.evidence_document set is_current = false, superseded_by = v_id where id = v_old.id;
  end if;

  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'evidence.document', v_id::text,
      jsonb_build_object('evidence_id', btrim(b->>'evidence_id'), 'replaces', v_replaces, 'sha256', b->>'sha256'));
  return v_id;
end $$;

revoke all on function public.mrv_store_evidence_document(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.mrv_store_evidence_document(uuid, uuid, text, jsonb) to authenticated, service_role;

-- ───────────────────────── Orphaned evidence file cleanup ─────────────────────────
-- 0002 deliberately gives `mrv-private` no delete policy (uploads are immutable through the API). Evidence uploads
-- are the one flow that stores the file BEFORE the trusted-executor metadata write, so a rejected write leaves an
-- orphaned private file that the application server must be able to remove again.
--
-- The policy below is the NARROWEST possible delete right, all conditions required at once:
--   * mrv-private bucket, and only under an evidence/… folder of the caller's own facility (foldername checks);
--   * the caller holds upload.create in that facility (mrv_auth.has_permission — tenant/facility scoped);
--   * the caller is the file's own uploader (storage.objects.owner = auth.uid() — another user's pending upload,
--     even an authorized colleague's, can never be deleted);
--   * NO evidence_document row references the path (checked by the SECURITY DEFINER helper below, so row-level
--     visibility can never hide a registered file) — a stored document's file stays immutable.
--
-- Residual race, accepted and bounded: the uploader deleting their OWN in-flight file between their own upload and
-- their own metadata commit can only break their own in-flight RPC (self-inflicted; the RPC then reports the file as
-- missing). No cross-user path exists: another user's file is protected by the owner check, and any file that has
-- become metadata-referenced is protected by the existence check.

create or replace function mrv_private.evidence_file_registered(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.evidence_document d where d.storage_path = p_path);
$$;
revoke all on function mrv_private.evidence_file_registered(text) from public, anon;
grant execute on function mrv_private.evidence_file_registered(text) to authenticated, service_role;

create policy mrv_private_delete_evidence on storage.objects for delete to authenticated
  using (
    bucket_id = 'mrv-private'
    and array_length(storage.foldername(name), 1) >= 3
    and (storage.foldername(name))[3] = 'evidence'
    and owner = auth.uid()
    and mrv_auth.has_permission(mrv_auth.try_uuid((storage.foldername(name))[1]), mrv_auth.try_uuid((storage.foldername(name))[2]), 'upload.create')
    and not mrv_private.evidence_file_registered(name)
  );

-- ───────────────────────── Schema version marker ─────────────────────────
-- Single callable marker for "which migration batch is applied" (7 = 0007). The hosted suite uses it to skip
-- replacement attempts while 0007 is absent — a refused replacement uploads the file before the metadata write
-- fails, and without the delete policy above that leaks an orphaned private file.
create or replace function public.mrv_schema_version() returns int
language sql immutable as $$ select 7 $$;
revoke all on function public.mrv_schema_version() from public, anon;
grant execute on function public.mrv_schema_version() to authenticated, service_role;
