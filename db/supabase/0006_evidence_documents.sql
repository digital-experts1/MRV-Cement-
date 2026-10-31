-- 0006_evidence_documents — evidence document uploads in the private bucket, linked to the Evidence Register
--
-- Purpose: store uploaded evidence FILES (PDF, XLSX/XLSM, CSV, JPG, PNG) as privately scoped, versioned documents
-- associated with an Evidence Register reference (config_document kind 'evidence_register'), an optional input
-- category and an optional date coverage. The register itself keeps its existing persistence (saved through the
-- normal import flow as an evidence_register configuration document); this migration only adds the document table.
--
-- Guarantees:
--   * every row is tenant/facility scoped with the same composite ownership as the other tables (RLS: facility.read);
--   * the file bytes live only in the private bucket `mrv-private` under <tenant>/<facility>/evidence/<document id>/
--     and are never exposed publicly — preview/download uses short-lived signed URLs created server-side;
--   * writes happen only through the trusted-executor RPC mrv_store_evidence_document (HMAC signature bound to
--     purpose 'evidence', actor, tenant, facility, body; permission 'upload.create' re-checked inside);
--   * replacement keeps history: the previous document row is retired (is_current=false, superseded_by set) and the
--     replacement is a new row — nothing is updated or deleted except that single transition;
--   * additive only: no existing table, policy, trigger or data is modified.
--
-- The storage policies for `mrv-private` (0002) already cover these paths: inserts require upload.create, selects
-- require facility.read, both scoped by the first two path folders — no new Storage policies are required.

-- ───────────────────────── The document table (scoped, versioned) ─────────────────────────
create table public.evidence_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  evidence_id text not null check (length(btrim(evidence_id)) between 1 and 120),
  category text check (category is null or category in ('production', 'rawMaterial', 'kilnFuel', 'electricity')),
  coverage_start date,
  coverage_end date,
  filename text not null check (length(btrim(filename)) between 1 and 120),
  mime text not null check (mime in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique
    check (split_part(storage_path, '/', 1) = tenant_id::text and split_part(storage_path, '/', 2) = facility_id::text
      and storage_path not like '%..%'),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  is_current boolean not null default true,
  superseded_by uuid,
  check (coverage_end is null or coverage_start is null or coverage_end >= coverage_start),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id)
);
alter table public.evidence_document
  add constraint evidence_document_superseded_by_fkey foreign key (superseded_by) references public.evidence_document (id);
create index evidence_document_facility on public.evidence_document (tenant_id, facility_id, evidence_id, created_at desc);
create index evidence_document_current on public.evidence_document (tenant_id, facility_id, is_current) where is_current;

-- Rows are immutable; the ONLY permitted update is the retirement transition of a replacement.
create function mrv_auth.evidence_document_supersede_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'delete'
     or not (old.is_current and not new.is_current)
     or (to_jsonb(new) - 'is_current' - 'superseded_by') is distinct from (to_jsonb(old) - 'is_current' - 'superseded_by') then
    raise exception 'evidence documents are immutable; a replacement stores a new document and retires the old one' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger evidence_document_supersede_only before update or delete on public.evidence_document
  for each row execute function mrv_auth.evidence_document_supersede_only();

alter table public.evidence_document enable row level security;
revoke all on table public.evidence_document from anon, authenticated;
grant select on table public.evidence_document to authenticated;
grant select, insert, update, delete on table public.evidence_document to service_role;
create policy evidence_document_read on public.evidence_document
  for select to authenticated using (mrv_auth.has_permission(tenant_id, facility_id, 'facility.read'));

-- ───────────────────────── The audited store operation (trusted executor) ─────────────────────────
-- Body (lib/mrv/evidenceFiles.ts evidenceDocumentBody):
--   {"id","evidence_id","category","coverage_start","coverage_end","filename","mime","size_bytes","sha256",
--    "storage_path","replaces"} — every field is re-validated here, independent of the application server.
create function public.mrv_store_evidence_document(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
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

  -- Replacement: retire the current document of the SAME evidence reference (kept as history).
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
    update public.evidence_document set is_current = false, superseded_by = v_id where id = v_old.id;
  end if;

  insert into public.evidence_document (id, tenant_id, facility_id, evidence_id, category, coverage_start, coverage_end,
    filename, mime, size_bytes, sha256, storage_path, uploaded_by)
  values (v_id, p_tenant, p_facility, btrim(b->>'evidence_id'), nullif(btrim(b->>'category'), ''),
    nullif(b->>'coverage_start', '')::date, nullif(b->>'coverage_end', '')::date,
    btrim(b->>'filename'), b->>'mime', (b->>'size_bytes')::bigint, b->>'sha256', v_path, v_uid);

  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'evidence.document', v_id::text,
      jsonb_build_object('evidence_id', btrim(b->>'evidence_id'), 'replaces', v_replaces, 'sha256', b->>'sha256'));
  return v_id;
end $$;

revoke all on function public.mrv_store_evidence_document(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.mrv_store_evidence_document(uuid, uuid, text, jsonb) to authenticated, service_role;
