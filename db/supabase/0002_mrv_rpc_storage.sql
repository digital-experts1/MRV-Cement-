-- 0002_mrv_rpc_storage — Supervisor Directive 05 (Supabase)
-- Additive only. Write RPCs (SECURITY DEFINER, permission re-checked inside every call), read helpers
-- (SECURITY INVOKER, so RLS applies) and the private Storage bucket with ownership-scoped policies.

-- ───────────────────────── Onboarding ─────────────────────────
create function public.mrv_create_organization(p_name text, p_facility_code text, p_facility_name text, p_timezone text, p_synthetic boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_member uuid;
  v_facility uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;
  if (select count(*) from public.tenant where created_by = v_uid) >= 10 then
    raise exception 'organization limit reached' using errcode = '54000';
  end if;
  insert into public.tenant (name, synthetic, created_by) values (btrim(p_name), coalesce(p_synthetic, false), v_uid) returning id into v_tenant;
  insert into public.tenant_membership (tenant_id, user_id) values (v_tenant, v_uid) returning id into v_member;
  insert into public.facility (tenant_id, code, name, timezone)
    values (v_tenant, upper(btrim(p_facility_code)), btrim(p_facility_name), p_timezone) returning id into v_facility;
  insert into public.role_assignment (tenant_id, membership_id, role, granted_by) values
    (v_tenant, v_member, 'tenant_admin', v_uid),
    (v_tenant, v_member, 'facility_manager', v_uid),
    (v_tenant, v_member, 'mrv_analyst', v_uid);
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target)
    values (v_tenant, v_facility, v_uid, 'organization.create', v_tenant::text);
  return v_tenant;
end $$;

create function public.mrv_add_facility(p_tenant uuid, p_code text, p_name text, p_timezone text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_facility uuid;
begin
  if not mrv_auth.has_permission(p_tenant, null, 'members.manage') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'unknown timezone %', p_timezone using errcode = '22023';
  end if;
  insert into public.facility (tenant_id, code, name, timezone)
    values (p_tenant, upper(btrim(p_code)), btrim(p_name), p_timezone) returning id into v_facility;
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target)
    values (p_tenant, v_facility, auth.uid(), 'facility.create', v_facility::text);
  return v_facility;
end $$;

-- ───────────────────────── Access introspection (caller's own access only) ─────────────────────────
create function public.mrv_my_permissions(p_tenant uuid)
returns table (facility_id uuid, permission text) language sql stable security definer set search_path = '' as $$
  select distinct f.id, rp.permission
  from public.facility f
  join public.tenant t on t.id = f.tenant_id and t.status = 'active'
  join public.tenant_membership m on m.tenant_id = f.tenant_id and m.user_id = auth.uid() and m.status = 'active'
  join public.role_assignment a on a.tenant_id = m.tenant_id and a.membership_id = m.id and a.revoked_at is null
    and (a.facility_id is null or a.facility_id = f.id)
  join public.role_permission rp on rp.role = a.role
  where f.tenant_id = p_tenant
  union
  select distinct null::uuid, rp.permission
  from public.tenant_membership m
  join public.tenant t on t.id = m.tenant_id and t.status = 'active'
  join public.role_assignment a on a.tenant_id = m.tenant_id and a.membership_id = m.id and a.revoked_at is null and a.facility_id is null
  join public.role_permission rp on rp.role = a.role
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
$$;

create function public.mrv_has_permission(p_tenant uuid, p_facility uuid, p_permission text)
returns boolean language sql stable security definer set search_path = '' as $$
  select mrv_auth.has_permission(p_tenant, p_facility, p_permission)
$$;

-- ───────────────────────── Imports ─────────────────────────
-- Records an import batch and its readings atomically. Re-imports never duplicate: a reading whose source record key
-- already has an identical current revision is counted as unchanged; a differing value creates a new revision and
-- supersedes the old one. Affected draft runs are marked stale; runs referenced by locked reports are untouched.
create function public.mrv_record_import(p_tenant uuid, p_facility uuid, p_batch jsonb, p_readings jsonb, p_documents jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_origin text := p_batch->>'origin';
  v_status text := p_batch->>'status';
  v_kind text;
  v_synthetic boolean;
  v_source uuid;
  v_batch uuid := coalesce(mrv_auth.try_uuid(p_batch->>'id'), gen_random_uuid());
  v_dup uuid;
  v_section text;
  r jsonb;
  d jsonb;
  v_cur_id uuid;
  v_cur_rev integer;
  v_cur_hash text;
  v_ins integer := 0;
  v_rev integer := 0;
  v_same integer := 0;
  v_min date;
  v_max date;
  v_cfg_changed boolean := false;
begin
  if not mrv_auth.has_permission(p_tenant, p_facility, 'upload.create') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if v_status not in ('accepted', 'rejected') then raise exception 'invalid batch status' using errcode = '22023'; end if;
  select t.synthetic into v_synthetic from public.tenant t where t.id = p_tenant;
  if v_origin = 'demo' and not v_synthetic then
    raise exception 'synthetic demo data may only be imported into a synthetic organization' using errcode = '22023';
  end if;
  for v_section in select distinct x->>'section' from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) x loop
    if not mrv_auth.has_permission(p_tenant, p_facility, mrv_auth.section_permission(v_section)) then
      raise exception 'permission denied for % readings', v_section using errcode = '42501';
    end if;
  end loop;

  v_kind := replace(v_origin, '-', '_');
  select s.id into v_source from public.data_source s
    where s.tenant_id = p_tenant and s.facility_id = p_facility and s.kind = v_kind and s.name = v_kind;
  if v_source is null then
    insert into public.data_source (tenant_id, facility_id, kind, name) values (p_tenant, p_facility, v_kind, v_kind) returning id into v_source;
  end if;

  if v_status = 'accepted' and p_batch->>'sha256' is not null then
    select b.id into v_dup from public.import_batch b
      where b.tenant_id = p_tenant and b.facility_id = p_facility and b.status = 'accepted' and b.sha256 = p_batch->>'sha256'
      order by b.received_at limit 1;
    if v_dup is not null then v_status := 'duplicate'; end if;
  end if;

  if v_status = 'accepted' then
    for r in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) loop
      select a.id, a.revision, a.content_hash into v_cur_id, v_cur_rev, v_cur_hash from public.activity_reading a
        where a.tenant_id = p_tenant and a.facility_id = p_facility and a.section = r->>'section' and a.record_key = r->>'record_key' and a.is_current
        for update;
      if v_cur_id is not null and v_cur_hash = r->>'content_hash' then
        v_same := v_same + 1;
      else
        if v_cur_id is not null then v_rev := v_rev + 1; else v_ins := v_ins + 1; end if;
        v_min := least(v_min, (r->>'interval_start')::date);
        v_max := greatest(v_max, (r->>'interval_end')::date);
      end if;
    end loop;
  end if;

  insert into public.import_batch (id, tenant_id, facility_id, source_id, origin, status, filename, sha256, size_bytes, duplicate_of,
    errors, assertions, declared_period_start, declared_period_end, synthetic, inserted_count, revised_count, unchanged_count, created_by)
  values (v_batch, p_tenant, p_facility, v_source, v_origin, v_status, p_batch->>'filename', p_batch->>'sha256',
    (p_batch->>'size_bytes')::bigint, v_dup, coalesce(p_batch->'errors', '[]'::jsonb), coalesce(p_batch->'assertions', '[]'::jsonb),
    (p_batch->>'declared_period_start')::date, (p_batch->>'declared_period_end')::date,
    coalesce(v_synthetic, false) or coalesce((p_batch->>'synthetic')::boolean, false), v_ins, v_rev, v_same, v_uid);

  if p_batch->>'storage_path' is not null then
    insert into public.source_file (tenant_id, facility_id, batch_id, storage_path, sha256, size_bytes, mime)
    values (p_tenant, p_facility, v_batch, p_batch->>'storage_path', p_batch->>'sha256', (p_batch->>'size_bytes')::bigint, p_batch->>'mime');
  end if;

  if v_status <> 'accepted' then
    insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
      values (p_tenant, p_facility, v_uid, 'import.' || v_status, v_batch::text, jsonb_build_object('duplicate_of', v_dup));
    return jsonb_build_object('batch_id', v_batch, 'status', v_status, 'duplicate_of', v_dup, 'inserted', 0, 'revised', 0, 'unchanged', 0);
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) loop
    select a.id, a.revision, a.content_hash into v_cur_id, v_cur_rev, v_cur_hash from public.activity_reading a
      where a.tenant_id = p_tenant and a.facility_id = p_facility and a.section = r->>'section' and a.record_key = r->>'record_key' and a.is_current;
    if v_cur_id is not null and v_cur_hash = r->>'content_hash' then
      continue;
    end if;
    if v_cur_id is not null then
      update public.activity_reading set is_current = false, superseded_at = now() where id = v_cur_id;
    end if;
    insert into public.activity_reading (tenant_id, facility_id, source_id, batch_id, section, series_key, record_key, observed_on,
      interval_start, interval_end, granularity, payload, content_hash, source_ref, revision, supersedes_id, synthetic, created_by)
    values (p_tenant, p_facility, v_source, v_batch, r->>'section', r->>'series_key', r->>'record_key', (r->>'observed_on')::date,
      (r->>'interval_start')::date, (r->>'interval_end')::date, r->>'granularity', r->'payload', r->>'content_hash',
      coalesce(r->'source_ref', '{}'::jsonb), coalesce(v_cur_rev, 0) + 1, v_cur_id, coalesce(v_synthetic, false) or coalesce((p_batch->>'synthetic')::boolean, false), v_uid);
  end loop;

  for d in select * from jsonb_array_elements(coalesce(p_documents, '[]'::jsonb)) loop
    if not exists (
      select 1 from (
        select c.content_hash from public.config_document c
        where c.tenant_id = p_tenant and c.facility_id = p_facility and c.kind = d->>'kind'
        order by c.created_at desc limit 1) latest
      where latest.content_hash = d->>'content_hash') then
      v_cfg_changed := true;
    end if;
    insert into public.config_document (tenant_id, facility_id, batch_id, kind, content, content_hash)
      values (p_tenant, p_facility, v_batch, d->>'kind', d->'content', d->>'content_hash');
  end loop;

  if v_min is not null or v_cfg_changed then
    insert into public.run_invalidation (tenant_id, facility_id, run_id, reason, batch_id)
    select cr.tenant_id, cr.facility_id, cr.id,
      case when v_min is not null and cr.range_start <= v_max and cr.range_end >= v_min
        then 'Readings added or revised for ' || v_min || ' – ' || v_max
        else 'Methodology, factor or setup inputs changed' end,
      v_batch
    from public.calculation_run cr
    where cr.tenant_id = p_tenant and cr.facility_id = p_facility
      and (v_cfg_changed or (v_min is not null and cr.range_start <= v_max and cr.range_end >= v_min))
      and not exists (select 1 from public.run_invalidation i where i.run_id = cr.id)
      and not exists (select 1 from public.report_snapshot s where s.run_id = cr.id and s.status = 'approved_locked');
  end if;

  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target, detail)
    values (p_tenant, p_facility, v_uid, 'import.accepted', v_batch::text,
      jsonb_build_object('inserted', v_ins, 'revised', v_rev, 'unchanged', v_same));
  return jsonb_build_object('batch_id', v_batch, 'status', v_status, 'inserted', v_ins, 'revised', v_rev, 'unchanged', v_same,
    'affected_start', v_min, 'affected_end', v_max, 'config_changed', v_cfg_changed);
end $$;

-- ───────────────────────── Calculation runs ─────────────────────────
create function public.mrv_record_run(p_tenant uuid, p_facility uuid, p_run jsonb, p_reading_ids uuid[], p_document_ids uuid[], p_qa jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_run uuid;
  v_synthetic boolean;
begin
  if not mrv_auth.has_permission(p_tenant, p_facility, 'calculation.run') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_reading_ids), 0) = 0 then raise exception 'a run needs at least one reading' using errcode = '22023'; end if;
  if (select count(*) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.id = any (p_reading_ids))
     <> cardinality(p_reading_ids) then
    raise exception 'run inputs must be readings of this facility' using errcode = '42501';
  end if;
  select t.synthetic or exists (select 1 from public.activity_reading a where a.id = any (p_reading_ids) and a.synthetic)
    into v_synthetic from public.tenant t where t.id = p_tenant;

  insert into public.calculation_run (tenant_id, facility_id, kind, range_start, range_end, range_label, timezone, reporting_profile,
    engine_version, methodology_version, input_snapshot, input_sha256, results, results_fingerprint, qa_overall, completeness_pct,
    coverage, synthetic, trigger_batch_id, created_by)
  values (p_tenant, p_facility, coalesce(p_run->>'kind', 'exploratory'), (p_run->>'range_start')::date, (p_run->>'range_end')::date,
    p_run->>'range_label', p_run->>'timezone', coalesce(p_run->>'reporting_profile', 'calendar'), p_run->>'engine_version',
    p_run->>'methodology_version', p_run->'input_snapshot', p_run->>'input_sha256', p_run->'results', p_run->>'results_fingerprint',
    p_run->>'qa_overall', (p_run->>'completeness_pct')::numeric, coalesce(p_run->'coverage', '{}'::jsonb), v_synthetic,
    mrv_auth.try_uuid(p_run->>'trigger_batch_id'), v_uid)
  returning id into v_run;

  insert into public.calculation_run_input (tenant_id, facility_id, run_id, reading_id)
    select p_tenant, p_facility, v_run, x from unnest(p_reading_ids) x;
  insert into public.calculation_run_config (tenant_id, facility_id, run_id, document_id)
    select p_tenant, p_facility, v_run, x from unnest(coalesce(p_document_ids, '{}'::uuid[])) x;
  insert into public.run_qa_result (tenant_id, facility_id, run_id, check_id, category, name, status, severity, result)
    select p_tenant, p_facility, v_run, q->>'check_id', q->>'category', q->>'name', q->>'status', q->>'severity', q->>'result'
    from jsonb_array_elements(coalesce(p_qa, '[]'::jsonb)) q;

  -- A concurrent import may have superseded an input while this run was computed: record it as stale immediately.
  if exists (select 1 from public.activity_reading a where a.id = any (p_reading_ids) and not a.is_current) then
    insert into public.run_invalidation (tenant_id, facility_id, run_id, reason)
      values (p_tenant, p_facility, v_run, 'An input reading was revised while the run was being calculated');
  end if;
  insert into public.audit_event (tenant_id, facility_id, actor_id, action, target)
    values (p_tenant, p_facility, v_uid, 'calculation.run', v_run::text);
  return v_run;
end $$;

-- ───────────────────────── Workspace preferences ─────────────────────────
create function public.mrv_save_preference(p_tenant uuid, p_facility uuid, p_range jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not mrv_auth.has_permission(p_tenant, p_facility, 'facility.read') then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  insert into public.workspace_preference (user_id, tenant_id, facility_id, range, updated_at)
    values (auth.uid(), p_tenant, p_facility, p_range, now())
  on conflict (user_id) do update set tenant_id = excluded.tenant_id, facility_id = excluded.facility_id,
    range = excluded.range, updated_at = now();
end $$;

-- ───────────────────────── Read helpers (SECURITY INVOKER: RLS applies) ─────────────────────────
create function public.mrv_facility_summary(p_tenant uuid, p_facility uuid)
returns table (latest_observation date, latest_observed_on date, latest_import timestamptz, latest_calculation timestamptz, current_readings bigint)
language sql stable security invoker set search_path = '' as $$
  select
    (select max(a.interval_end) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and a.quality_state = 'accepted'),
    (select max(a.observed_on) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current and a.quality_state = 'accepted'),
    (select max(b.received_at) from public.import_batch b where b.tenant_id = p_tenant and b.facility_id = p_facility and b.status = 'accepted'),
    (select max(r.created_at) from public.calculation_run r where r.tenant_id = p_tenant and r.facility_id = p_facility),
    (select count(*) from public.activity_reading a where a.tenant_id = p_tenant and a.facility_id = p_facility and a.is_current)
$$;

create function public.mrv_current_config(p_tenant uuid, p_facility uuid)
returns table (id uuid, kind text, content jsonb, content_hash text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select distinct on (c.kind) c.id, c.kind, c.content, c.content_hash, c.created_at
  from public.config_document c
  where c.tenant_id = p_tenant and c.facility_id = p_facility
  order by c.kind, c.created_at desc, c.id
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'mrv_create_organization(text, text, text, text, boolean)',
    'mrv_add_facility(uuid, text, text, text)',
    'mrv_my_permissions(uuid)',
    'mrv_has_permission(uuid, uuid, text)',
    'mrv_record_import(uuid, uuid, jsonb, jsonb, jsonb)',
    'mrv_record_run(uuid, uuid, jsonb, uuid[], uuid[], jsonb)',
    'mrv_save_preference(uuid, uuid, jsonb)',
    'mrv_facility_summary(uuid, uuid)',
    'mrv_current_config(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ───────────────────────── Private Storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('mrv-private', 'mrv-private', false, 20971520)
on conflict (id) do nothing;

-- Object path: <tenant_id>/<facility_id>/<area>/<...>. Same ownership model as the tables. No update/delete policies:
-- original uploads are immutable through the API.
create policy mrv_private_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mrv-private'
    and mrv_auth.try_uuid((storage.foldername(name))[2]) is not null
    and mrv_auth.has_permission(mrv_auth.try_uuid((storage.foldername(name))[1]), mrv_auth.try_uuid((storage.foldername(name))[2]), 'upload.create'));

create policy mrv_private_select on storage.objects for select to authenticated
  using (
    bucket_id = 'mrv-private'
    and mrv_auth.try_uuid((storage.foldername(name))[2]) is not null
    and mrv_auth.has_permission(mrv_auth.try_uuid((storage.foldername(name))[1]), mrv_auth.try_uuid((storage.foldername(name))[2]), 'facility.read'));
