-- 0007_evidence_replacement_order — fix the replacement order inside mrv_store_evidence_document
--
-- Bug in 0006 (CONFIRMED live and reproduced on real PostgreSQL): the RPC retired the previous document
-- (update … superseded_by = <new id>) BEFORE inserting the new document row. The evidence_document_superseded_by_fkey
-- foreign key (not deferrable) therefore pointed at a row that did not exist yet, and every replacement failed with
-- 'Request violates a data constraint' (23503). First (non-replacing) uploads were never affected.
--
-- Fix (this migration): insert the NEW document first, then retire the old one in the same transaction. The
-- transaction is still atomic — if anything fails, nothing is stored or retired.
--
-- Second fix (upload-registration vs. deletion race, see the cleanup section below): before inserting metadata the
-- RPC now locks the uploaded file's storage.objects row (FOR SHARE) and refuses if it is gone or belongs to another
-- user. Additive: no existing table, trigger, grant or data is changed; one function is replaced, one helper, one
-- Storage DELETE policy and one version marker are added.

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
  v_obj uuid;
  v_obj_owner text;
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

  -- Pin the uploaded file (upload-registration vs. deletion race). The FOR SHARE row lock conflicts with every
  -- DELETE of that storage.objects row:
  --   * deletion first: a delete in progress holds the row lock, so this waits; when the delete commits, READ
  --     COMMITTED re-checks the row, finds it gone, and the registration is refused — no metadata can reference a
  --     deleted file;
  --   * registration first: once this lock is held, any delete must wait for this transaction; after the commit the
  --     delete policy's helper (mrv_private.evidence_file_deletable) sees the committed metadata and refuses.
  -- This body runs as the function OWNER (SECURITY DEFINER; RLS-exempt owner role with UPDATE on storage.objects,
  -- which FOR SHARE requires) — not with the caller's grants.
  select o.id, coalesce(o.owner_id, o.owner::text) into v_obj, v_obj_owner
    from storage.objects o
    where o.bucket_id = 'mrv-private' and o.name = v_path
    for share;
  if v_obj is null then
    raise exception 'the uploaded file was not found; nothing was stored' using errcode = '22023';
  end if;
  if v_obj_owner is distinct from v_uid::text then
    raise exception 'the uploaded file belongs to another user' using errcode = '42501';
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
--   * mrv-private bucket, and only under an evidence/… folder (foldername checks);
--   * the caller holds upload.create in that facility (mrv_auth.has_permission — tenant/facility scoped);
--   * the caller is the file's own uploader (storage.objects.owner = auth.uid() — another user's pending upload,
--     even an authorized colleague's, can never be deleted);
--   * the file is NOT referenced by evidence metadata, decided by mrv_private.evidence_file_deletable AFTER it has
--     locked the object row (see below) — a stored document's file stays immutable.
--
-- Privilege model (two separate mechanisms — do not conflate them):
--   * An RLS policy expression is evaluated with the privileges of the QUERYING role (here `authenticated`, carrying
--     the user's JWT claims). Every function the expression calls must therefore be EXECUTE-able by that role, and
--     auth.uid() is the caller. That is why the helper below is granted EXECUTE to `authenticated` — and to nobody
--     else (service_role bypasses RLS and never evaluates this policy).
--   * Schema USAGE is checked when a name is RESOLVED. The policy is parsed once, by the migration owner, and stored
--     by object OID, so evaluating it needs no USAGE on mrv_private. `authenticated` keeps having NO USAGE on
--     mrv_private, so it cannot call the helper by name (verified: 42501 permission denied for schema mrv_private).
--   * The helper is SECURITY DEFINER: its BODY runs with its OWNER's privileges (RLS-exempt owner role), so the
--     metadata lookup cannot be hidden by the caller's row visibility and the row lock does not need the caller to
--     hold UPDATE on storage.objects. That is a property of the function, not of the policy.
--
-- Concurrency: the single serialization point is the storage.objects row lock.
--   * The registration RPC share-locks the row before inserting metadata (see above).
--   * The helper takes FOR UPDATE on the same row BEFORE looking for metadata. If a registration holds the share
--     lock, the helper waits; because the helper is VOLATILE PL/pgSQL, its next statement takes a fresh READ
--     COMMITTED snapshot and sees the committed metadata → deletion refused (0 rows, file retained).
--   * A plain STABLE check (the pre-fix version) used the DELETE statement's snapshot, could not see an in-flight
--     registration, and was never re-evaluated after the lock wait: both transactions committed and the metadata
--     referenced a deleted file. Reproduced in tests/mrv/concurrencyHarness.ts.
--   * Under REPEATABLE READ / SERIALIZABLE the fresh-snapshot argument does not hold, so the helper fails closed
--     (refuses) unless the deleting transaction is READ COMMITTED (the Storage API's default).
--   * Both the direct-DELETE flow (policy evaluated during the scan) and the newer Storage API flow (superuser row
--     lock first, then a caller-role DELETE probe) take this row lock before the metadata check, so there is one lock
--     resource and no lock-order inversion.
-- Assumes bucket versioning stays DISABLED for mrv-private (verified); a versioned delete writes markers instead.

create or replace function mrv_private.evidence_file_deletable(p_bucket text, p_name text) returns boolean
language plpgsql volatile security definer set search_path = '' cost 10000 as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    return false;
  end if;
  perform 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_name for update;
  if not found then
    return false;
  end if;
  -- New statement → new snapshot (READ COMMITTED, VOLATILE): sees a registration that committed while we waited.
  return not exists (select 1 from public.evidence_document d where d.storage_path = p_name);
end $$;
revoke all on function mrv_private.evidence_file_deletable(text, text) from public, anon, service_role;
grant execute on function mrv_private.evidence_file_deletable(text, text) to authenticated;

create policy mrv_private_delete_evidence on storage.objects for delete to authenticated
  using (
    bucket_id = 'mrv-private'
    and array_length(storage.foldername(name), 1) >= 3
    and (storage.foldername(name))[3] = 'evidence'
    and owner = auth.uid()
    and mrv_auth.has_permission(mrv_auth.try_uuid((storage.foldername(name))[1]), mrv_auth.try_uuid((storage.foldername(name))[2]), 'upload.create')
    and mrv_private.evidence_file_deletable(bucket_id, name)
  );

-- ───────────────────────── Schema version marker ─────────────────────────
-- Single callable marker for "which migration batch is applied" (7 = 0007). The hosted suite uses it to skip
-- replacement attempts while 0007 is absent — a refused replacement uploads the file before the metadata write
-- fails, and without the delete policy above that leaks an orphaned private file.
create or replace function public.mrv_schema_version() returns int
language sql immutable as $$ select 7 $$;
revoke all on function public.mrv_schema_version() from public, anon;
grant execute on function public.mrv_schema_version() to authenticated, service_role;
