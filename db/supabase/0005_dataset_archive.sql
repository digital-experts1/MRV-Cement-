-- 0005_dataset_archive — auditable per-facility dataset archive (synthetic/test data lifecycle)
--
-- Purpose: remove a facility's active dataset from day-to-day use (readings, calculation runs, import batches,
-- configuration documents) so a fresh dataset can be imported cleanly, WITHOUT deleting or rewriting any history.
-- Every table it touches stays append-only: nothing is updated, dropped or truncated. The archive is recorded as a
-- new append-only row in public.dataset_archive whose `cutoff` timestamp marks everything created before it as
-- ARCHIVED (explicitly labelled in history listings; excluded from active/latest loading, reuse and duplicate
-- detection). Activity readings are retired through the only transition the immutability trigger permits
-- (is_current true → false, superseded_at set) — no withdrawal replacements, because a current withdrawn revision
-- would make a re-import of the same file count as "unchanged" and silently refuse to restore it.
--
-- Guarantees after an archive:
--   * zero current readings → every new calculation for any range is empty until fresh data is imported;
--   * runs/batches/config documents created before the cutoff are excluded from latest-run selection, run reuse
--     (a fresh calculation never returns an archived run), config selection and whole-file duplicate detection —
--     so re-importing the SAME original workbook succeeds and stores its file again;
--   * a SECOND import of that same file still detects the duplicate (the new active batch) and does not double count;
--   * historical rows, source files in the private bucket, report snapshots and audit events are untouched and
--     remain readable through the authenticated history views (explicitly labelled "archived").
--
-- Authorization: the executor-signed RPC public.mrv_archive_dataset requires the new `dataset.archive` permission
-- (granted only to tenant_admin) plus the same HMAC executor signature as imports/runs/withdrawals, re-checks
-- permissions inside the database, and refuses when the facility has non-synthetic current readings or an
-- approved (locked) report. Nothing here disables RLS, triggers or append-only rules.

-- ───────────────────────── The archive record (append-only) ─────────────────────────
create table public.dataset_archive (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  reason text not null check (length(btrim(reason)) >= 3),
  cutoff timestamptz not null default now(),
  counts jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id)
);
create index dataset_archive_facility on public.dataset_archive (tenant_id, facility_id, cutoff desc);
create trigger dataset_archive_append_only before update or delete on public.dataset_archive
  for each row execute function mrv_auth.forbid_mutation();
alter table public.dataset_archive enable row level security;
revoke all on table public.dataset_archive from anon, authenticated;
grant select on table public.dataset_archive to authenticated;
grant select, insert, update, delete on table public.dataset_archive to service_role;
create policy dataset_archive_read on public.dataset_archive
  for select to authenticated using (mrv_auth.has_permission(tenant_id, facility_id, 'facility.read'));

-- New permission: only tenant administrators may archive a facility's dataset (mirror of lib/tenancy/permissions.ts).
insert into public.role_permission (role, permission) values ('tenant_admin', 'dataset.archive')
  on conflict do nothing;

-- ───────────────────────── The audited archive operation (trusted executor) ─────────────────────────
-- Body: {"reason": "...", "expect": {"current_readings": n, "runs": n}} — "expect" is an optional safety rail that
-- refuses the archive when the live counts do not match (protects against archiving the wrong factory or a
-- concurrently imported dataset). Returns the recorded pre-cleanup counts.
create function public.mrv_archive_dataset(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_body jsonb;
  v_reason text;
  v_cutoff timestamptz := now();
  v_readings bigint;
  v_by_section jsonb;
  v_runs bigint;
  v_batches bigint;
  v_docs bigint;
  v_retired bigint;
  v_expect jsonb;
  v_counts jsonb;
begin
  if not mrv_auth.has_permission(p_tenant, p_facility, 'dataset.archive') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_key := mrv_private.verify_executor('archive', p_tenant, p_facility, p_body, p_auth);
  v_body := p_body::jsonb;
  if jsonb_typeof(v_body) <> 'object' or exists (select 1 from jsonb_object_keys(v_body) k
      where k not in ('reason', 'expect')) then
    raise exception 'invalid archive body' using errcode = '22023';
  end if;
  v_reason := btrim(coalesce(v_body->>'reason', ''));
  if length(v_reason) < 3 then raise exception 'an archive needs a reason' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_facility::text, 0));

  -- Safety guards: never archive real (non-synthetic) readings or a facility with an approved (locked) report.
  if exists (select 1 from public.activity_reading a
             where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and not a.synthetic) then
    raise exception 'refusing to archive: this facility has non-synthetic current readings' using errcode = '22023';
  end if;
  if exists (select 1 from public.report_snapshot s
             where s.tenant_id = p_tenant and s.facility_id = p_facility and s.status = 'approved_locked') then
    raise exception 'refusing to archive: an approved (locked) report exists for this facility' using errcode = '22023';
  end if;

  select count(*) into v_readings from public.activity_reading a
    where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current;
  select coalesce(jsonb_object_agg(section, n), '{}'::jsonb) into v_by_section
    from (select a.section, count(*) as n from public.activity_reading a
          where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current group by a.section) s;
  select count(*) into v_runs from public.calculation_run r
    where r.tenant_id = p_tenant and r.facility_id = p_facility;
  select count(*) into v_batches from public.import_batch b
    where b.tenant_id = p_tenant and b.facility_id = p_facility;
  select count(*) into v_docs from public.config_document c
    where c.tenant_id = p_tenant and c.facility_id = p_facility;

  v_expect := v_body->'expect';
  if jsonb_typeof(v_expect) = 'object' then
    if v_expect ? 'current_readings' and v_readings <> (v_expect->>'current_readings')::bigint then
      raise exception 'expected % current readings but found % — refusing to archive', v_expect->>'current_readings', v_readings
        using errcode = '22023';
    end if;
    if v_expect ? 'runs' and v_runs <> (v_expect->>'runs')::bigint then
      raise exception 'expected % calculation runs but found % — refusing to archive', v_expect->>'runs', v_runs
        using errcode = '22023';
    end if;
  end if;

  -- Retire every current reading (the one transition the immutability trigger permits). History stays readable;
  -- the rows keep their batches, provenance and revisions. No replacement revisions are created on purpose.
  update public.activity_reading set is_current = false, superseded_at = v_cutoff
    where tenant_id = p_tenant and facility_id = p_facility and is_current;
  get diagnostics v_retired := row_count;

  v_counts := jsonb_build_object(
    'reason', v_reason,
    'current_readings_before', v_readings,
    'current_readings_by_section', v_by_section,
    'readings_retired', v_retired,
    'runs_archived', v_runs,
    'import_batches_archived', v_batches,
    'config_documents_archived', v_docs);
  insert into public.dataset_archive (tenant_id, facility_id, reason, cutoff, counts, created_by)
    values (p_tenant, p_facility, v_reason, v_cutoff, v_counts, v_uid);
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'dataset.archive', p_facility::text, v_counts);
  return v_counts || jsonb_build_object('cutoff', v_cutoff);
end $$;

do $$
declare f text;
begin
  foreach f in array array['mrv_archive_dataset(uuid, uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ───────────────────────── Active-dataset filters in existing read helpers ─────────────────────────
create or replace function public.mrv_facility_summary(p_tenant uuid, p_facility uuid)
returns table (latest_observation date, latest_observed_on date, latest_import timestamptz, latest_calculation timestamptz, current_readings bigint)
language sql stable security invoker set search_path = '' as $$
  select
    (select max(a.interval_end) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and a.quality_state = 'accepted'),
    (select max(a.observed_on) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and a.quality_state = 'accepted'),
    (select max(b.received_at) from public.import_batch b
       where b.tenant_id = p_tenant and b.facility_id = p_facility and b.status = 'accepted'
         and b.received_at > coalesce((select max(x.cutoff) from public.dataset_archive x
           where x.tenant_id = p_tenant and x.facility_id = p_facility), '-infinity'::timestamptz)),
    (select max(r.created_at) from public.calculation_run r
       where r.tenant_id = p_tenant and r.facility_id = p_facility
         and r.created_at > coalesce((select max(x.cutoff) from public.dataset_archive x
           where x.tenant_id = p_tenant and x.facility_id = p_facility), '-infinity'::timestamptz)),
    (select count(*) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current)
$$;

create or replace function public.mrv_current_config(p_tenant uuid, p_facility uuid)
returns table (id uuid, kind text, content jsonb, content_hash text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select distinct on (c.kind) c.id, c.kind, c.content, c.content_hash, c.created_at
  from public.config_document c
  where c.tenant_id = p_tenant and c.facility_id = p_facility
    and c.created_at > coalesce((select max(x.cutoff) from public.dataset_archive x
      where x.tenant_id = p_tenant and x.facility_id = p_facility), '-infinity'::timestamptz)
  order by c.kind, c.created_at desc, c.id
$$;

-- ───────────────────────── mrv_import_v2: archived batches/config are not duplicates ─────────────────────────
create or replace function public.mrv_import_v2(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_body jsonb;
  b jsonb;
  v_readings jsonb;
  v_docs jsonb;
  v_origin text;
  v_status text;
  v_kind text;
  v_synthetic boolean;
  v_source uuid;
  v_batch uuid;
  v_dup uuid;
  v_section text;
  r jsonb;
  d jsonb;
  v_cur_id uuid;
  v_cur_rev integer;
  v_max_rev integer;
  v_cur_content jsonb;
  v_cur_start date;
  v_cur_end date;
  v_ins integer := 0;
  v_rev integer := 0;
  v_same integer := 0;
  v_min date;
  v_max date;
  v_eff_from date;
  v_eff_to date;
  v_cfg_changed boolean := false;
  v_dup_status text;
begin
  if not mrv_auth.has_permission(p_tenant, p_facility, 'upload.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_key := mrv_private.verify_executor('import', p_tenant, p_facility, p_body, p_auth);
  v_body := p_body::jsonb;
  b := v_body->'batch';
  v_readings := coalesce(v_body->'readings', '[]'::jsonb);
  v_docs := coalesce(v_body->'documents', '[]'::jsonb);
  v_origin := b->>'origin';
  v_status := b->>'status';
  v_batch := mrv_auth.try_uuid(b->>'id');
  if v_batch is null or v_status not in ('accepted', 'rejected') or jsonb_typeof(v_readings) <> 'array' or jsonb_typeof(v_docs) <> 'array'
     or jsonb_typeof(coalesce(b->'errors', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid import body' using errcode = '22023';
  end if;
  -- All-or-nothing: an accepted batch carries no validation errors; a rejected batch stores no readings or configuration.
  if (v_status = 'accepted' and jsonb_array_length(coalesce(b->'errors', '[]'::jsonb)) > 0)
     or (v_status = 'rejected' and (jsonb_array_length(v_readings) > 0 or jsonb_array_length(v_docs) > 0)) then
    raise exception 'an import is accepted whole or rejected whole (no partial acceptance)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_facility::text, 0));

  -- Idempotent retry: the batch id is the idempotency key. A retried request (new nonce, same batch) returns the stored outcome.
  select x.status into v_dup_status from public.import_batch x where x.id = v_batch and x.tenant_id = p_tenant and x.facility_id = p_facility;
  if v_dup_status is not null then
    return jsonb_build_object('batch_id', v_batch, 'status', v_dup_status, 'idempotent_replay', true, 'inserted', 0, 'revised', 0, 'unchanged', 0);
  end if;

  select t.synthetic into v_synthetic from public.tenant t where t.id = p_tenant;
  if v_origin = 'demo' and not v_synthetic then
    raise exception 'synthetic demo data may only be imported into a synthetic organization' using errcode = '22023';
  end if;
  for v_section in select distinct x->>'section' from jsonb_array_elements(v_readings) x loop
    if not mrv_auth.has_permission(p_tenant, p_facility, mrv_auth.section_permission(v_section)) then
      raise exception 'permission denied for % readings', v_section using errcode = '42501';
    end if;
  end loop;

  -- Independent validation of every reading's explicit interval metadata.
  if exists (
    select 1 from jsonb_array_elements(v_readings) x
    where x->>'mapping_version' is null or coalesce(x->>'interval_basis', '') = '' or coalesce(x->>'source_identity', '') = ''
      or x->>'measurement_type' is distinct from 'interval_total'
      or jsonb_typeof(x->'payload') is distinct from 'object'
      or (x->>'interval_end')::date < (x->>'interval_start')::date
      or x->>'granularity' is distinct from mrv_private.granularity_of((x->>'interval_start')::date, (x->>'interval_end')::date)
      or coalesce(x->>'record_key', '') = '' or coalesce(x->>'series_key', '') = '') then
    raise exception 'every reading needs an explicit interval, measurement type, granularity and mapping version' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_readings) with ordinality x(a, i)
    join jsonb_array_elements(v_readings) with ordinality y(b, j) on x.i < y.j
      and x.a->>'section' = y.b->>'section' and x.a->>'series_key' = y.b->>'series_key'
      and (x.a->>'interval_start')::date <= (y.b->>'interval_end')::date and (y.b->>'interval_start')::date <= (x.a->>'interval_end')::date) then
    raise exception 'two readings of the same series overlap in this import (would double count)' using errcode = '22023';
  end if;

  v_kind := replace(v_origin, '-', '_');
  select s.id into v_source from public.data_source s
    where s.tenant_id = p_tenant and s.facility_id = p_facility and s.kind = v_kind and s.name = v_kind;
  if v_source is null then
    insert into public.data_source (tenant_id, facility_id, kind, name) values (p_tenant, p_facility, v_kind, v_kind) returning id into v_source;
  end if;

  if v_status = 'accepted' and b->>'sha256' is not null then
    -- Only batches that are still ACTIVE count for duplicate detection: an archived dataset must not make a
    -- fresh import of the same original file look like a duplicate.
    select x.id into v_dup from public.import_batch x
      where x.tenant_id = p_tenant and x.facility_id = p_facility and x.status = 'accepted' and x.sha256 = b->>'sha256'
        and x.received_at > coalesce((select max(ar.cutoff) from public.dataset_archive ar
          where ar.tenant_id = p_tenant and ar.facility_id = p_facility), '-infinity'::timestamptz)
      order by x.received_at limit 1;
    -- A previously seen file is a duplicate only if it would change nothing now: re-applying an earlier file after a
    -- correction is a revision (duplicate_of still records the earlier batch).
    if v_dup is not null
       and not exists (
         select 1 from jsonb_array_elements(v_readings) nr
         where not exists (select 1 from public.activity_reading a
           where a.tenant_id = p_tenant and a.facility_id = p_facility and a.section = nr->>'section' and a.record_key = nr->>'record_key'
             and a.is_current and (a.payload - '_source') = (nr->'payload') - '_source'))
       and not exists (
         select 1 from jsonb_array_elements(v_docs) nd
         where mrv_private.strip_source((select c.content from public.config_document c
                where c.tenant_id = p_tenant and c.facility_id = p_facility and c.kind = nd->>'kind'
                  and c.effective_from = (b->>'effective_from')::date and c.effective_to = (b->>'effective_to')::date
                  and c.created_at > coalesce((select max(ar.cutoff) from public.dataset_archive ar
                    where ar.tenant_id = p_tenant and ar.facility_id = p_facility), '-infinity'::timestamptz)
                order by c.created_at desc, c.id desc limit 1)) is distinct from mrv_private.strip_source(nd->'content')) then
      v_status := 'duplicate';
    end if;
  end if;

  insert into public.import_batch (id, tenant_id, facility_id, source_id, origin, status, filename, sha256, size_bytes, duplicate_of,
    errors, assertions, declared_period_start, declared_period_end, synthetic, created_by, mapping, executor_key_id)
  values (v_batch, p_tenant, p_facility, v_source, v_origin, v_status, b->>'filename', b->>'sha256', (b->>'size_bytes')::bigint, v_dup,
    coalesce(b->'errors', '[]'::jsonb), coalesce(b->'assertions', '[]'::jsonb), (b->>'declared_period_start')::date,
    (b->>'declared_period_end')::date, coalesce(v_synthetic, false) or coalesce((b->>'synthetic')::boolean, false), v_uid, b->'mapping', v_key);

  if b->>'storage_path' is not null then
    insert into public.source_file (tenant_id, facility_id, batch_id, storage_path, sha256, size_bytes, mime)
    values (p_tenant, p_facility, v_batch, b->>'storage_path', b->>'sha256', (b->>'size_bytes')::bigint, b->>'mime');
  end if;

  if v_status <> 'accepted' then
    insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
      values (p_tenant, p_facility, v_uid, 'import.' || v_status, v_batch::text, jsonb_build_object('duplicate_of', v_dup));
    return jsonb_build_object('batch_id', v_batch, 'status', v_status, 'duplicate_of', v_dup, 'inserted', 0, 'revised', 0, 'unchanged', 0);
  end if;

  for r in select * from jsonb_array_elements(v_readings) loop
    v_cur_id := null;
    select a.id, a.revision, a.payload - '_source', a.interval_start, a.interval_end into v_cur_id, v_cur_rev, v_cur_content, v_cur_start, v_cur_end
      from public.activity_reading a
      where a.tenant_id = p_tenant and a.facility_id = p_facility and a.section = r->>'section' and a.record_key = r->>'record_key' and a.is_current;
    if v_cur_id is null and r->>'legacy_key' is not null then
      -- Auditable correction of a reading stored under the retired date-based inference: supersede it (kept as history).
      select a.id, a.revision, null, a.interval_start, a.interval_end into v_cur_id, v_cur_rev, v_cur_content, v_cur_start, v_cur_end
        from public.activity_reading a
        where a.tenant_id = p_tenant and a.facility_id = p_facility and a.section = r->>'section' and a.record_key = r->>'legacy_key'
          and a.is_current and a.mapping_version is null;
    end if;
    if v_cur_id is not null and v_cur_content = (r->'payload') - '_source' then
      v_same := v_same + 1;
      continue;
    end if;
    -- Continue the revision sequence from the highest stored revision for this record key. After a dataset archive
    -- (no current row) a fresh import of the same records must not collide with the retired rows' unique
    -- (tenant, facility, section, record_key, revision) key — history keeps its revisions, the fresh dataset continues after them.
    select max(a.revision) into v_max_rev from public.activity_reading a
      where a.tenant_id = p_tenant and a.facility_id = p_facility and a.section = r->>'section' and a.record_key = r->>'record_key';
    if v_cur_id is not null then
      v_rev := v_rev + 1;
      update public.activity_reading set is_current = false, superseded_at = now() where id = v_cur_id;
      v_min := least(v_min, v_cur_start);
      v_max := greatest(v_max, v_cur_end);
    else
      v_ins := v_ins + 1;
    end if;
    v_min := least(v_min, (r->>'interval_start')::date);
    v_max := greatest(v_max, (r->>'interval_end')::date);
    insert into public.activity_reading (tenant_id, facility_id, source_id, batch_id, section, series_key, record_key, observed_on,
      interval_start, interval_end, granularity, payload, content_hash, source_ref, revision, supersedes_id, synthetic, created_by,
      measurement_type, interval_basis, mapping_version, source_identity, legacy_key)
    values (p_tenant, p_facility, v_source, v_batch, r->>'section', r->>'series_key', r->>'record_key', (r->>'observed_on')::date,
      (r->>'interval_start')::date, (r->>'interval_end')::date, r->>'granularity', r->'payload',
      encode(sha256(convert_to(((r->'payload') - '_source')::text, 'UTF8')), 'hex'),
      coalesce(r->'source_ref', '{}'::jsonb), greatest(coalesce(v_cur_rev, 0), coalesce(v_max_rev, 0)) + 1, v_cur_id,
      coalesce(v_synthetic, false) or coalesce((b->>'synthetic')::boolean, false), v_uid,
      r->>'measurement_type', r->>'interval_basis', r->>'mapping_version', r->>'source_identity', r->>'legacy_key');
  end loop;

  v_eff_from := (b->>'effective_from')::date;
  v_eff_to := (b->>'effective_to')::date;
  if jsonb_array_length(v_docs) > 0 and (v_eff_from is null or v_eff_to is null or v_eff_to < v_eff_from) then
    raise exception 'configuration documents need an explicit effective period' using errcode = '22023';
  end if;
  for d in select * from jsonb_array_elements(v_docs) loop
    -- Compared with the CURRENT (newest, still-active) version for this period, ignoring per-upload provenance
    -- (_source): unchanged content is not stored again (its runs stay valid); any difference — including reverting
    -- a factor A → B → A — is a new version and marks overlapping runs stale. Versions from before a dataset
    -- archive do not suppress a fresh import of identical configuration.
    if mrv_private.strip_source((select c.content from public.config_document c
        where c.tenant_id = p_tenant and c.facility_id = p_facility and c.kind = d->>'kind'
          and c.effective_from = v_eff_from and c.effective_to = v_eff_to
          and c.created_at > coalesce((select max(ar.cutoff) from public.dataset_archive ar
            where ar.tenant_id = p_tenant and ar.facility_id = p_facility), '-infinity'::timestamptz)
        order by c.created_at desc, c.id desc limit 1)) is distinct from mrv_private.strip_source(d->'content') then
      v_cfg_changed := true;
      insert into public.config_document (tenant_id, facility_id, batch_id, kind, content, content_hash, effective_from, effective_to, effective_basis)
      values (p_tenant, p_facility, v_batch, d->>'kind', d->'content', encode(sha256(convert_to((d->'content')::text, 'UTF8')), 'hex'),
        v_eff_from, v_eff_to, b->>'effective_basis');
    end if;
  end loop;

  if v_min is not null then
    perform mrv_private.invalidate_range(p_tenant, p_facility, v_min, v_max, 'Readings added or revised for ' || v_min || ' – ' || v_max, v_batch);
  end if;
  if v_cfg_changed then
    perform mrv_private.invalidate_range(p_tenant, p_facility, v_eff_from, v_eff_to, 'Methodology, factor or setup inputs changed for ' || v_eff_from || ' – ' || v_eff_to, v_batch);
  end if;

  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'import.accepted', v_batch::text,
      jsonb_build_object('inserted', v_ins, 'revised', v_rev, 'unchanged', v_same, 'mapping', b->'mapping'));
  return jsonb_build_object('batch_id', v_batch, 'status', v_status, 'inserted', v_ins, 'revised', v_rev, 'unchanged', v_same,
    'affected_start', v_min, 'affected_end', v_max, 'config_changed', v_cfg_changed);
end $$;

-- ───────────────────────── mrv_finalize_run: never reuse or shadow an archived run ─────────────────────────
create or replace function public.mrv_finalize_run(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_body jsonb;
  v_meta jsonb;
  v_input jsonb;
  v_results jsonb;
  v_start date;
  v_end date;
  v_ids uuid[];
  v_considered uuid[];
  v_docs uuid[];
  v_synthetic boolean;
  v_qa text;
  v_run uuid;
  v_pair text[];
  v_doc record;
begin
  if not mrv_auth.has_permission(p_tenant, p_facility, 'calculation.run') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  v_key := mrv_private.verify_executor('run', p_tenant, p_facility, p_body, p_auth);
  v_body := p_body::jsonb;
  v_meta := v_body->'run';
  v_input := v_body->'input_snapshot';
  v_results := v_body->'results';
  v_start := (v_meta->>'range_start')::date;
  v_end := (v_meta->>'range_end')::date;
  v_ids := array(select x::uuid from jsonb_array_elements_text(v_body->'reading_ids') x);
  v_considered := array(select x::uuid from jsonb_array_elements_text(v_body->'considered_ids') x);
  v_docs := array(select x::uuid from jsonb_array_elements_text(v_body->'document_ids') x);
  if v_end < v_start or cardinality(v_ids) = 0 or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or jsonb_typeof(v_input) <> 'object' or jsonb_typeof(v_results) <> 'object' then
    raise exception 'invalid run body' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_facility::text, 0));

  -- 1. Pinned readings are current, accepted, explicitly mapped interval totals of this facility, inside the range.
  if (select count(*) from public.activity_reading a
      where a.tenant_id = p_tenant and a.facility_id = p_facility and a.id = any (v_ids) and a.is_current and a.quality_state = 'accepted'
        and a.mapping_version is not null and a.measurement_type = 'interval_total' and a.interval_start >= v_start and a.interval_end <= v_end
        and a.id = any (v_considered)) <> cardinality(v_ids) then
    raise exception 'run inputs are not current accepted readings of this facility inside the range' using errcode = 'MRV09';
  end if;
  -- 2. The considered set is exactly the current readings overlapping the range (no concurrent change was missed).
  if exists (select 1 from public.activity_reading a
             where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current
               and a.interval_start <= v_end and a.interval_end >= v_start and not (a.id = any (v_considered)))
     or (select count(*) from public.activity_reading a
         where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and a.id = any (v_considered)
           and a.interval_start <= v_end and a.interval_end >= v_start) <> cardinality(v_considered) then
    raise exception 'readings changed while the calculation ran; recalculate' using errcode = 'MRV09';
  end if;
  -- 3. The frozen input rows are exactly the pinned reading revisions.
  foreach v_pair slice 1 in array array[array['production', 'production'], array['rawMaterial', 'rawMaterial'], array['kilnFuel', 'kilnFuel'],
    array['electricity', 'electricity'], array['inventory', 'inventory']] loop
    if coalesce((select jsonb_agg(x order by x::text) from jsonb_array_elements(coalesce(v_input->v_pair[1], '[]'::jsonb)) x), '[]'::jsonb)
       <> coalesce((select jsonb_agg(a.payload order by a.payload::text) from public.activity_reading a where a.id = any (v_ids) and a.section = v_pair[2]), '[]'::jsonb) then
      raise exception 'input snapshot does not match the pinned % readings', v_pair[2] using errcode = '22023';
    end if;
  end loop;
  -- 4. Configuration: one effective version per kind for the whole range, the newest such version, and equal to the input.
  if (select count(*) from public.config_document c where c.tenant_id = p_tenant and c.facility_id = p_facility and c.id = any (v_docs)
        and c.effective_from <= v_start and c.effective_to >= v_end) <> cardinality(v_docs)
     or (select count(distinct c.kind) from public.config_document c where c.id = any (v_docs)) <> cardinality(v_docs)
     or not exists (select 1 from public.config_document c where c.id = any (v_docs) and c.kind = 'setup')
     or not exists (select 1 from public.config_document c where c.id = any (v_docs) and c.kind = 'constants') then
    raise exception 'run configuration is not a single effective version per kind for this range' using errcode = '22023';
  end if;
  if exists (select 1 from public.config_document c join public.config_document n
               on n.tenant_id = c.tenant_id and n.facility_id = c.facility_id and n.kind = c.kind and n.created_at > c.created_at
              and n.effective_from <= v_start and n.effective_to >= v_end
              and not exists (select 1 from public.dataset_archive an
                              where an.tenant_id = n.tenant_id and an.facility_id = n.facility_id and an.cutoff >= n.created_at)
             where c.id = any (v_docs)) then
    raise exception 'configuration changed while the calculation ran; recalculate' using errcode = 'MRV09';
  end if;
  for v_doc in
    select k.kind, k.field, c.content from (values ('setup_rows', 'setupRows'), ('constants', 'constants'), ('fuel_defaults', 'fuelDefaults'),
      ('dcs_map', 'dcsMap'), ('evidence_register', 'evidence'), ('regulatory', 'regulatory'), ('readme', 'readme')) k(kind, field)
    left join public.config_document c on c.id = any (v_docs) and c.kind = k.kind
  loop
    if coalesce(v_input->v_doc.field, '[]'::jsonb) <> coalesce(v_doc.content, '[]'::jsonb) then
      raise exception 'input snapshot does not match configuration %', v_doc.kind using errcode = '22023';
    end if;
  end loop;
  if (coalesce(v_input->'setup', '{}'::jsonb) - 'Period start' - 'Period end' - 'Reporting quarter')
     <> ((select c.content from public.config_document c where c.id = any (v_docs) and c.kind = 'setup') - 'Period start' - 'Period end' - 'Reporting quarter') then
    raise exception 'input snapshot does not match configuration setup' using errcode = '22023';
  end if;

  select t.synthetic or exists (select 1 from public.activity_reading a where a.id = any (v_ids) and a.synthetic)
    into v_synthetic from public.tenant t where t.id = p_tenant;
  if coalesce((v_input->'meta'->>'synthetic')::boolean, false) <> v_synthetic then
    raise exception 'synthetic labelling of the input does not match its sources' using errcode = '22023';
  end if;
  -- Idempotent retry — only AFTER every integrity check above passed: an identical, still-valid run (same dependency hash,
  -- engine and input hash; results are a deterministic function of these apart from their generation timestamp) is returned
  -- instead of duplicated. Runs from before a dataset archive are never reused.
  select cr.id into v_run from public.calculation_run cr
    where cr.tenant_id = p_tenant and cr.facility_id = p_facility and v_meta->>'dependency_sha256' is not null
      and cr.dependency_sha256 = v_meta->>'dependency_sha256' and cr.engine_version = v_meta->>'engine_version'
      and cr.input_sha256 = v_meta->>'input_sha256'
      and not exists (select 1 from public.run_invalidation i where i.run_id = cr.id)
      and not exists (select 1 from public.dataset_archive ar
                      where ar.tenant_id = cr.tenant_id and ar.facility_id = cr.facility_id and ar.cutoff >= cr.created_at)
    order by cr.created_at desc limit 1;
  if v_run is not null then return v_run; end if;

  -- Derived from the engine results, never accepted as separate caller-supplied values.
  select e->>'Value' into v_qa from jsonb_array_elements(v_results->'calcRows') e where e->>'Metric' = 'QA/QC Overall Status' limit 1;
  if v_qa is null or v_qa not in ('PASS', 'WARNING', 'FAIL', 'INCOMPLETE') then
    raise exception 'results lack a QA/QC overall status' using errcode = '22023';
  end if;

  insert into public.calculation_run (tenant_id, facility_id, kind, range_start, range_end, range_label, timezone, reporting_profile,
    engine_version, methodology_version, input_snapshot, input_sha256, results, results_fingerprint, qa_overall, completeness_pct,
    coverage, synthetic, trigger_batch_id, created_by, results_sha256, dependency_sha256, selection_policy, executor_key_id)
  values (p_tenant, p_facility, 'exploratory', v_start, v_end, v_meta->>'range_label', v_meta->>'timezone', 'calendar',
    v_meta->>'engine_version', v_meta->>'methodology_version', v_input, v_meta->>'input_sha256', v_results, v_meta->>'results_fingerprint', v_qa,
    (v_results->'completeness'->>'pct')::numeric, coalesce(v_body->'coverage', '{}'::jsonb), v_synthetic, mrv_auth.try_uuid(v_meta->>'trigger_batch_id'),
    v_uid, v_meta->>'results_sha256', v_meta->>'dependency_sha256', v_meta->>'selection_policy', v_key)
  returning id into v_run;

  insert into public.calculation_run_input (tenant_id, facility_id, run_id, reading_id)
    select p_tenant, p_facility, v_run, x from unnest(v_ids) x;
  insert into public.calculation_run_config (tenant_id, facility_id, run_id, document_id)
    select p_tenant, p_facility, v_run, x from unnest(v_docs) x;
  insert into public.run_qa_result (tenant_id, facility_id, run_id, check_id, category, name, status, severity, result)
    select p_tenant, p_facility, v_run, coalesce(q->>'Check ID', ''), q->>'Category', q->>'Check Name',
      case when q->>'Status' in ('PASS', 'WARNING', 'FAIL', 'NOT_EVALUATED') then q->>'Status' else 'NOT_EVALUATED' end, q->>'Severity', q->>'Result'
    from jsonb_array_elements(coalesce(v_results->'qaqc', '[]'::jsonb)) q;
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'calculation.finalize', v_run::text, jsonb_build_object('executor_key', v_key, 'engine', v_meta->>'engine_version'));
  return v_run;
end $$;
