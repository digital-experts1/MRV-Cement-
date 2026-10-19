-- 0003_mrv_trusted_execution — Supervisor Directive 06
-- STATUS: NOT APPLIED to any remote Supabase project. Project vbxvhbnhstdfbkgjuzgs is classified by its owner as
-- "production or unsure"; apply only after explicit environment classification and review.
-- Executed locally against real PostgreSQL (PGlite) by tests/mrv/dbHarness.ts together with 0001/0002.
--
-- Additive / non-destructive: new schema, tables, columns and functions; two CHECK constraints are widened; the two
-- Directive 05 write RPCs that trusted caller-supplied values are retired (body raises, EXECUTE revoked). No data is
-- deleted or rewritten.
--
-- Trust model:
--  * The browser never computes or submits authoritative values. The application server parses/validates sources and
--    runs the calculation engine, then signs the exact request body with an executor key (HMAC-SHA256). The key lives in
--    the server environment and in mrv_private (no Data API exposure, no grants). Only its holder can finalize runs or
--    record imports; a signed request is bound to purpose, user, tenant, facility, time (±5 min) and is single-use.
--  * The RPCs still run as the signed-in user (auth.uid()) and re-check permissions; they also independently verify that
--    the run's frozen input equals the pinned, current reading revisions and effective configuration versions.

create schema if not exists mrv_private;
revoke all on schema mrv_private from public;

create table mrv_private.executor_key (
  key_id text primary key check (key_id ~ '^[a-z0-9_-]{1,40}$'),
  secret bytea not null check (octet_length(secret) >= 30),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

-- Replay protection: every signed request carries a random nonce that is consumed exactly once.
create table mrv_private.executor_nonce (
  nonce uuid primary key,
  purpose text not null,
  actor uuid not null,
  used_at timestamptz not null default now()
);

-- Provision one key at migration time (≈244 random bits from two v4 UUIDs). The owner copies it into the server
-- environment (MRV_EXECUTOR_KEY_ID / MRV_EXECUTOR_KEY) with:
--   select key_id, encode(secret, 'hex') from mrv_private.executor_key where active;
insert into mrv_private.executor_key (key_id, secret)
select 'exec-1', decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex')
where not exists (select 1 from mrv_private.executor_key);

create function mrv_private.hmac_sha256(p_key bytea, p_msg bytea) returns bytea
language plpgsql immutable strict set search_path = '' as $$
declare
  k bytea := p_key;
  ipad bytea;
  opad bytea;
  i integer;
begin
  if octet_length(k) > 64 then k := pg_catalog.sha256(k); end if;
  k := k || pg_catalog.decode(pg_catalog.repeat('00', 64 - octet_length(k)), 'hex');
  ipad := k;
  opad := k;
  for i in 0..63 loop
    ipad := pg_catalog.set_byte(ipad, i, pg_catalog.get_byte(k, i) # 54);
    opad := pg_catalog.set_byte(opad, i, pg_catalog.get_byte(k, i) # 92);
  end loop;
  return pg_catalog.sha256(opad || pg_catalog.sha256(ipad || p_msg));
end $$;

-- Verifies a trusted-executor signature (protocol v2, lib/mrv/executorSign.ts) and consumes its nonce. Returns the key id.
-- Binds: operation, key, actor (= auth.uid() of the calling JWT), tenant, facility, issued_at, nonce, sha256(complete body).
-- Valid for 120 s after issued_at and at most 30 s in the future. Authorization (has_permission) is checked separately by the
-- calling RPC at execution time, so a signature never outlives a revoked role.
create function mrv_private.verify_executor(p_purpose text, p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key_id text;
  v_secret bytea;
  v_issued bigint;
  v_nonce uuid;
  v_expected text;
  v_now bigint := extract(epoch from now())::bigint;
begin
  if v_uid is null or p_auth is null or p_body is null or jsonb_typeof(p_auth) <> 'object' then
    raise exception 'trusted executor authorization required' using errcode = '42501';
  end if;
  select k.key_id, k.secret into v_key_id, v_secret from mrv_private.executor_key k where k.key_id = p_auth->>'key_id' and k.active;
  if v_key_id is null then raise exception 'trusted executor authorization required' using errcode = '42501'; end if;
  if coalesce(p_auth->>'issued_at', '') !~ '^[0-9]{9,11}$' then raise exception 'invalid executor authorization' using errcode = '42501'; end if;
  v_issued := (p_auth->>'issued_at')::bigint;
  if v_issued > v_now + 30 then raise exception 'executor authorization issued in the future' using errcode = '42501'; end if;
  if v_now - v_issued > 120 then raise exception 'executor authorization expired' using errcode = '42501'; end if;
  if coalesce(p_auth->>'nonce', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid executor authorization' using errcode = '42501';
  end if;
  v_nonce := (p_auth->>'nonce')::uuid;
  v_expected := encode(mrv_private.hmac_sha256(v_secret, convert_to(concat_ws('|', 'trace-mrv-exec/v2', p_purpose, v_key_id, v_uid::text,
    p_tenant::text, p_facility::text, v_issued::text, v_nonce::text, encode(sha256(convert_to(p_body, 'UTF8')), 'hex')), 'UTF8')), 'hex');
  if v_expected is distinct from lower(coalesce(p_auth->>'signature', '')) then
    raise exception 'executor signature does not match the request' using errcode = '42501';
  end if;
  begin
    insert into mrv_private.executor_nonce (nonce, purpose, actor) values (v_nonce, p_purpose, v_uid);
  exception when unique_violation then
    raise exception 'executor authorization already used' using errcode = '42501';
  end;
  return v_key_id;
end $$;

create function mrv_private.granularity_of(s date, e date) returns text language sql immutable set search_path = '' as $$
  select case
    when s = e then 'day'
    when extract(day from s) = 1 and e = (date_trunc('month', e) + interval '1 month - 1 day')::date then
      case
        when date_trunc('month', s) = date_trunc('month', e) then 'month'
        when extract(year from s) = extract(year from e) and extract(month from s)::int % 3 = 1
          and extract(month from e) = extract(month from s) + 2 then 'quarter'
        when extract(year from s) = extract(year from e) and extract(month from s) = 1 and extract(month from e) = 12 then 'year'
        else 'custom' end
    else 'custom' end
$$;

-- ───────────────────────── Explicit interval metadata on readings ─────────────────────────
alter table public.activity_reading
  add column measurement_type text check (measurement_type in ('interval_total', 'cumulative_meter', 'sample')),
  add column interval_basis text,
  add column mapping_version text,
  add column source_identity text,
  add column legacy_key text;
alter table public.activity_reading alter column observed_on drop not null;
alter table public.activity_reading drop constraint activity_reading_granularity_check;
alter table public.activity_reading add constraint activity_reading_granularity_check
  check (granularity in ('day', 'month', 'quarter', 'year', 'custom', 'instant'));
alter table public.activity_reading drop constraint activity_reading_quality_state_check;
alter table public.activity_reading add constraint activity_reading_quality_state_check
  check (quality_state in ('accepted', 'rejected', 'withdrawn'));
alter table public.activity_reading add constraint activity_reading_mapping_complete
  check (mapping_version is null or (measurement_type is not null and interval_basis is not null and source_identity is not null));
comment on column public.activity_reading.mapping_version is
  'NULL = stored by Directive 05 date-based inference (last day of month => monthly). Such rows are excluded from new calculations until re-imported with an explicit mapping.';

alter table public.import_batch add column mapping jsonb, add column executor_key_id text;

alter table public.config_document
  add column effective_from date,
  add column effective_to date,
  add column effective_basis text,
  add constraint config_document_effective_range check (effective_to is null or effective_from is null or effective_to >= effective_from);
create index config_document_effective on public.config_document (tenant_id, facility_id, kind, effective_from, effective_to);

alter table public.calculation_run
  add column results_sha256 text,
  add column dependency_sha256 text,
  add column selection_policy text,
  add column executor_key_id text;
create index calculation_run_dependency on public.calculation_run (tenant_id, facility_id, dependency_sha256);

-- Later corrections against an approved (locked) report: recorded here; the report itself is never rewritten.
create table public.report_impact (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  report_id uuid not null,
  run_id uuid not null,
  batch_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, facility_id, report_id) references public.report_snapshot (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, run_id) references public.calculation_run (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, batch_id) references public.import_batch (tenant_id, facility_id, id)
);
create index report_impact_report on public.report_impact (report_id);
create trigger report_impact_append_only before update or delete on public.report_impact for each row execute function mrv_auth.forbid_mutation();
alter table public.report_impact enable row level security;
revoke all on table public.report_impact from anon, authenticated;
grant select on table public.report_impact to authenticated;
grant select, insert, update, delete on table public.report_impact to service_role;
create policy report_impact_read on public.report_impact for select to authenticated using (mrv_auth.has_permission(tenant_id, facility_id, 'facility.read'));

-- Marks every run overlapping [p_start, p_end] stale and records an impact on each approved report built on such a run.
create function mrv_private.invalidate_range(p_tenant uuid, p_facility uuid, p_start date, p_end date, p_reason text, p_batch uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.run_invalidation (tenant_id, facility_id, run_id, reason, batch_id)
  select cr.tenant_id, cr.facility_id, cr.id, p_reason, p_batch
  from public.calculation_run cr
  where cr.tenant_id = p_tenant and cr.facility_id = p_facility and cr.range_start <= p_end and cr.range_end >= p_start
    and not exists (select 1 from public.run_invalidation i where i.run_id = cr.id);
  insert into public.report_impact (tenant_id, facility_id, report_id, run_id, batch_id, reason)
  select s.tenant_id, s.facility_id, s.id, s.run_id, p_batch, p_reason
  from public.report_snapshot s join public.calculation_run cr on cr.id = s.run_id
  where s.tenant_id = p_tenant and s.facility_id = p_facility and s.status = 'approved_locked'
    and cr.range_start <= p_end and cr.range_end >= p_start;
end $$;

-- ───────────────────────── Retire the Directive 05 write RPCs that trusted caller-supplied values ─────────────────────────
create or replace function public.mrv_record_run(p_tenant uuid, p_facility uuid, p_run jsonb, p_reading_ids uuid[], p_document_ids uuid[], p_qa jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'mrv_record_run is retired: calculation runs are finalized only by the trusted executor (mrv_finalize_run)' using errcode = '42501';
end $$;
create or replace function public.mrv_record_import(p_tenant uuid, p_facility uuid, p_batch jsonb, p_readings jsonb, p_documents jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'mrv_record_import is retired: imports are recorded only by the trusted executor (mrv_import_v2)' using errcode = '42501';
end $$;
revoke execute on function public.mrv_record_run(uuid, uuid, jsonb, uuid[], uuid[], jsonb) from public, anon, authenticated;
revoke execute on function public.mrv_record_import(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;

-- ───────────────────────── Imports (trusted executor) ─────────────────────────
-- Body: {"batch": {...}, "readings": [...], "documents": [...]} as produced by lib/mrv/executorPayload.ts.
create function public.mrv_import_v2(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
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
  if v_batch is null or v_status not in ('accepted', 'rejected') or jsonb_typeof(v_readings) <> 'array' or jsonb_typeof(v_docs) <> 'array' then
    raise exception 'invalid import body' using errcode = '22023';
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
    select x.id into v_dup from public.import_batch x
      where x.tenant_id = p_tenant and x.facility_id = p_facility and x.status = 'accepted' and x.sha256 = b->>'sha256'
      order by x.received_at limit 1;
    if v_dup is not null then v_status := 'duplicate'; end if;
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
      coalesce(r->'source_ref', '{}'::jsonb), coalesce(v_cur_rev, 0) + 1, v_cur_id,
      coalesce(v_synthetic, false) or coalesce((b->>'synthetic')::boolean, false), v_uid,
      r->>'measurement_type', r->>'interval_basis', r->>'mapping_version', r->>'source_identity', r->>'legacy_key');
  end loop;

  v_eff_from := (b->>'effective_from')::date;
  v_eff_to := (b->>'effective_to')::date;
  if jsonb_array_length(v_docs) > 0 and (v_eff_from is null or v_eff_to is null or v_eff_to < v_eff_from) then
    raise exception 'configuration documents need an explicit effective period' using errcode = '22023';
  end if;
  for d in select * from jsonb_array_elements(v_docs) loop
    if not exists (
      select 1 from public.config_document c
      where c.tenant_id = p_tenant and c.facility_id = p_facility and c.kind = d->>'kind'
        and c.effective_from = v_eff_from and c.effective_to = v_eff_to and c.content = d->'content') then
      v_cfg_changed := true;
    end if;
    insert into public.config_document (tenant_id, facility_id, batch_id, kind, content, content_hash, effective_from, effective_to, effective_basis)
      values (p_tenant, p_facility, v_batch, d->>'kind', d->'content', encode(sha256(convert_to((d->'content')::text, 'UTF8')), 'hex'),
        v_eff_from, v_eff_to, b->>'effective_basis');
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

-- ───────────────────────── Withdrawal (new revision, history kept) ─────────────────────────
create function public.mrv_withdraw_reading(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_body jsonb;
  a public.activity_reading;
  v_batch uuid := gen_random_uuid();
  v_source uuid;
  v_new uuid;
begin
  v_key := mrv_private.verify_executor('withdraw', p_tenant, p_facility, p_body, p_auth);
  v_body := p_body::jsonb;
  if length(btrim(coalesce(v_body->>'reason', ''))) < 3 then raise exception 'a withdrawal needs a reason' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_facility::text, 0));
  select * into a from public.activity_reading x
    where x.tenant_id = p_tenant and x.facility_id = p_facility and x.id = mrv_auth.try_uuid(v_body->>'reading_id') and x.is_current
    for update;
  if a.id is null then raise exception 'reading not found or not current' using errcode = '22023'; end if;
  if not mrv_auth.has_permission(p_tenant, p_facility, mrv_auth.section_permission(a.section)) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  select s.id into v_source from public.data_source s where s.tenant_id = p_tenant and s.facility_id = p_facility and s.kind = 'manual' and s.name = 'manual';
  if v_source is null then
    insert into public.data_source (tenant_id, facility_id, kind, name) values (p_tenant, p_facility, 'manual', 'manual') returning id into v_source;
  end if;
  insert into public.import_batch (id, tenant_id, facility_id, source_id, origin, status, filename, synthetic, created_by, revised_count, executor_key_id)
    values (v_batch, p_tenant, p_facility, v_source, 'manual', 'accepted', 'Withdrawal: ' || left(btrim(v_body->>'reason'), 100), a.synthetic, v_uid, 1, v_key);
  update public.activity_reading set is_current = false, superseded_at = now() where id = a.id;
  insert into public.activity_reading (tenant_id, facility_id, source_id, batch_id, process_unit_id, section, series_key, record_key, observed_on,
    interval_start, interval_end, granularity, payload, content_hash, source_ref, revision, supersedes_id, quality_state, synthetic, created_by,
    measurement_type, interval_basis, mapping_version, source_identity, legacy_key)
  values (a.tenant_id, a.facility_id, v_source, v_batch, a.process_unit_id, a.section, a.series_key, a.record_key, a.observed_on,
    a.interval_start, a.interval_end, a.granularity, a.payload, a.content_hash,
    a.source_ref || jsonb_build_object('withdrawal_reason', btrim(v_body->>'reason')), a.revision + 1, a.id, 'withdrawn', a.synthetic, v_uid,
    a.measurement_type, a.interval_basis, a.mapping_version, a.source_identity, a.legacy_key)
  returning id into v_new;
  perform mrv_private.invalidate_range(p_tenant, p_facility, a.interval_start, a.interval_end,
    'Reading withdrawn for ' || a.interval_start || ' – ' || a.interval_end, v_batch);
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'reading.withdraw', a.id::text, jsonb_build_object('reason', v_body->>'reason', 'new_revision', v_new));
  return v_new;
end $$;

-- ───────────────────────── Calculation runs (trusted executor) ─────────────────────────
-- Body: {"run": {...}, "input_snapshot": {...}, "results": {...}, "coverage": {...}, "reading_ids": [...],
--        "considered_ids": [...], "document_ids": [...]} as produced by lib/mrv/executorPayload.ts.
create function public.mrv_finalize_run(p_tenant uuid, p_facility uuid, p_body text, p_auth jsonb)
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
    raise exception 'run inputs are not current accepted readings of this facility inside the range' using errcode = '40001';
  end if;
  -- 2. The considered set is exactly the current readings overlapping the range (no concurrent change was missed).
  if exists (select 1 from public.activity_reading a
             where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current
               and a.interval_start <= v_end and a.interval_end >= v_start and not (a.id = any (v_considered)))
     or (select count(*) from public.activity_reading a
         where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and a.id = any (v_considered)
           and a.interval_start <= v_end and a.interval_end >= v_start) <> cardinality(v_considered) then
    raise exception 'readings changed while the calculation ran; recalculate' using errcode = '40001';
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
             where c.id = any (v_docs)) then
    raise exception 'configuration changed while the calculation ran; recalculate' using errcode = '40001';
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
  -- instead of duplicated.
  select cr.id into v_run from public.calculation_run cr
    where cr.tenant_id = p_tenant and cr.facility_id = p_facility and v_meta->>'dependency_sha256' is not null
      and cr.dependency_sha256 = v_meta->>'dependency_sha256' and cr.engine_version = v_meta->>'engine_version'
      and cr.input_sha256 = v_meta->>'input_sha256'
      and not exists (select 1 from public.run_invalidation i where i.run_id = cr.id)
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

revoke all on all functions in schema mrv_private from public;
do $$
declare f text;
begin
  foreach f in array array[
    'mrv_import_v2(uuid, uuid, text, jsonb)',
    'mrv_withdraw_reading(uuid, uuid, text, jsonb)',
    'mrv_finalize_run(uuid, uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
