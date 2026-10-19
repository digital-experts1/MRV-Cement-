-- 0001_mrv_persistence — Supervisor Directives 04/05 (Supabase PostgreSQL)
-- Additive only. Creates new objects; never drops, truncates or rewrites existing data.
-- Applied to the DEVELOPMENT project only. Do not apply to production without a reviewed release.
--
-- Access model (see docs/mrv/11-supabase-persistence.md):
--   * Identity = Supabase Auth (auth.uid()). Authorization = tenant membership + explicit role assignments.
--   * Every exposed table has RLS; `authenticated` gets SELECT only, filtered by facility permission.
--   * `anon` gets nothing. All writes go through SECURITY DEFINER RPCs that re-check permissions (0002).
--   * Readings, runs, QA results, config documents and import batches are append-only (triggers).

create schema if not exists mrv_auth;
revoke all on schema mrv_auth from public;
grant usage on schema mrv_auth to authenticated;

-- ───────────────────────── Tenancy ─────────────────────────
create table public.tenant (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  synthetic boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  fiscal_year_start_month integer not null default 1 check (fiscal_year_start_month between 1 and 12),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.tenant_membership (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);
create index tenant_membership_user on public.tenant_membership (user_id) where status = 'active';

create table public.facility (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenant (id),
  code text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  timezone text not null default 'UTC',
  reporting_boundary text not null default 'Facility operational boundary (gate-to-gate)',
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

-- Mirror of lib/tenancy/permissions.ts ROLE_PERMISSIONS (reference data, not tenant-owned).
create table public.role_permission (
  role text not null,
  permission text not null,
  primary key (role, permission)
);

create table public.role_assignment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  membership_id uuid not null,
  role text not null check (role in ('tenant_admin', 'facility_manager', 'contributor_production', 'contributor_utilities',
    'contributor_laboratory', 'mrv_analyst', 'reviewer', 'approver', 'auditor')),
  facility_id uuid, -- NULL = tenant-wide
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (tenant_id, membership_id) references public.tenant_membership (tenant_id, id),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id),
  check (role <> 'tenant_admin' or facility_id is null)
);
create index role_assignment_membership on public.role_assignment (tenant_id, membership_id) where revoked_at is null;

create table public.process_unit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  unit_type text not null check (unit_type in ('kiln', 'raw_mill', 'cement_mill', 'grinding_unit', 'dryer', 'power_plant', 'other')),
  name text not null,
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id)
);

-- ───────────────────────── Sources and imports ─────────────────────────
create table public.data_source (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  kind text not null check (kind in ('workbook', 'manual', 'data_package', 'demo', 'dcs', 'erp', 'lims')),
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, id),
  unique (tenant_id, facility_id, kind, name),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id)
);

create table public.import_batch (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  source_id uuid not null,
  origin text not null check (origin in ('workbook', 'manual', 'demo', 'data-package')),
  status text not null check (status in ('accepted', 'rejected', 'duplicate')),
  filename text,
  sha256 text,
  size_bytes bigint,
  duplicate_of uuid,
  errors jsonb not null default '[]',
  assertions jsonb not null default '[]',
  declared_period_start date,
  declared_period_end date,
  synthetic boolean not null default false,
  inserted_count integer not null default 0,
  revised_count integer not null default 0,
  unchanged_count integer not null default 0,
  received_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, source_id) references public.data_source (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, duplicate_of) references public.import_batch (tenant_id, facility_id, id)
);
create index import_batch_recent on public.import_batch (tenant_id, facility_id, received_at desc);
create index import_batch_sha on public.import_batch (tenant_id, facility_id, sha256) where status = 'accepted';

-- Original uploaded files live in the private Storage bucket `mrv-private` under <tenant>/<facility>/imports/<batch>/.
create table public.source_file (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  batch_id uuid not null,
  storage_bucket text not null default 'mrv-private',
  storage_path text not null unique,
  sha256 text not null,
  size_bytes bigint not null,
  mime text,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, batch_id) references public.import_batch (tenant_id, facility_id, id),
  check (split_part(storage_path, '/', 1) = tenant_id::text and split_part(storage_path, '/', 2) = facility_id::text)
);

-- Versioned methodology/factor/config inputs (setup, constants & EFs, fuel defaults, registers). One version per batch.
create table public.config_document (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  batch_id uuid not null,
  kind text not null check (kind in ('setup', 'setup_rows', 'constants', 'fuel_defaults', 'dcs_map', 'evidence_register', 'regulatory', 'readme')),
  content jsonb not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, batch_id) references public.import_batch (tenant_id, facility_id, id)
);
create index config_document_latest on public.config_document (tenant_id, facility_id, kind, created_at desc);

-- ───────────────────────── Historical readings ─────────────────────────
-- One row per source record revision. Corrections insert a new revision; the previous one is kept (is_current=false).
create table public.activity_reading (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  source_id uuid not null,
  batch_id uuid not null,
  process_unit_id uuid,
  section text not null check (section in ('production', 'rawMaterial', 'kilnFuel', 'electricity', 'inventory')),
  series_key text not null,          -- section + identity fields (no date): used for granularity/double-count rules
  record_key text not null,          -- series + date + occurrence: stable source-record identity for re-import dedupe
  observed_on date not null,         -- observation date as recorded (date-only records stay dates)
  interval_start date not null,      -- covered interval (inclusive)
  interval_end date not null,
  granularity text not null check (granularity in ('day', 'month')),
  payload jsonb not null,            -- source row incl. `_source` provenance (file/sheet/row and original raw values)
  content_hash text not null,
  source_ref jsonb not null default '{}',
  revision integer not null check (revision >= 1),
  supersedes_id uuid,
  is_current boolean not null default true,
  superseded_at timestamptz,
  quality_state text not null default 'accepted' check (quality_state in ('accepted', 'rejected')),
  synthetic boolean not null default false,
  received_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id),
  unique (tenant_id, facility_id, id),
  unique (tenant_id, facility_id, section, record_key, revision),
  foreign key (tenant_id, facility_id, source_id) references public.data_source (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, batch_id) references public.import_batch (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, process_unit_id) references public.process_unit (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, supersedes_id) references public.activity_reading (tenant_id, facility_id, id),
  check (interval_end >= interval_start)
);
create unique index activity_reading_one_current on public.activity_reading (tenant_id, facility_id, section, record_key) where is_current;
create index activity_reading_range on public.activity_reading (tenant_id, facility_id, interval_end, interval_start) where is_current;
create index activity_reading_series on public.activity_reading (tenant_id, facility_id, section, series_key) where is_current;
create index activity_reading_batch on public.activity_reading (tenant_id, facility_id, batch_id);

-- ───────────────────────── Calculations ─────────────────────────
-- Immutable. input_snapshot holds the exact frozen MrvInput (rows with provenance, setup, constants/EFs, fuel defaults);
-- calculation_run_input / _config pin the exact reading revisions and config versions by id.
create table public.calculation_run (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  kind text not null default 'exploratory' check (kind in ('exploratory', 'formal')),
  range_start date not null,
  range_end date not null,
  range_label text not null,
  timezone text not null,
  reporting_profile text not null default 'calendar',
  engine_version text not null,
  methodology_version text not null,
  input_snapshot jsonb not null,
  input_sha256 text not null,
  results jsonb not null,
  results_fingerprint text not null,
  qa_overall text not null,
  completeness_pct numeric,
  coverage jsonb not null default '{}',
  synthetic boolean not null default false,
  trigger_batch_id uuid,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id),
  foreign key (tenant_id, facility_id, trigger_batch_id) references public.import_batch (tenant_id, facility_id, id),
  check (range_end >= range_start)
);
create index calculation_run_range on public.calculation_run (tenant_id, facility_id, range_start, range_end, created_at desc);

create table public.calculation_run_input (
  tenant_id uuid not null,
  facility_id uuid not null,
  run_id uuid not null,
  reading_id uuid not null,
  primary key (run_id, reading_id),
  foreign key (tenant_id, facility_id, run_id) references public.calculation_run (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, reading_id) references public.activity_reading (tenant_id, facility_id, id)
);
create index calculation_run_input_reading on public.calculation_run_input (reading_id);

create table public.calculation_run_config (
  tenant_id uuid not null,
  facility_id uuid not null,
  run_id uuid not null,
  document_id uuid not null,
  primary key (run_id, document_id),
  foreign key (tenant_id, facility_id, run_id) references public.calculation_run (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, document_id) references public.config_document (tenant_id, facility_id, id)
);

create table public.run_qa_result (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  run_id uuid not null,
  check_id text not null,
  category text,
  name text,
  status text not null check (status in ('PASS', 'WARNING', 'FAIL', 'NOT_EVALUATED')),
  severity text,
  result text,
  foreign key (tenant_id, facility_id, run_id) references public.calculation_run (tenant_id, facility_id, id)
);
create index run_qa_result_run on public.run_qa_result (run_id);

-- Staleness is recorded, never by rewriting the run.
create table public.run_invalidation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  run_id uuid not null,
  reason text not null,
  batch_id uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, facility_id, run_id) references public.calculation_run (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, batch_id) references public.import_batch (tenant_id, facility_id, id)
);
create index run_invalidation_run on public.run_invalidation (run_id);

create table public.report_snapshot (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  facility_id uuid not null,
  run_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'approved_locked')),
  content jsonb not null,
  content_sha256 text not null,
  created_by uuid not null references auth.users (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, facility_id, id),
  foreign key (tenant_id, facility_id, run_id) references public.calculation_run (tenant_id, facility_id, id),
  check (status <> 'approved_locked' or (approved_by is not null and approved_at is not null and approved_by <> created_by))
);

create table public.workspace_preference (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid,
  facility_id uuid,
  range jsonb,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, facility_id) references public.facility (tenant_id, id)
);

create table public.audit_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenant (id),
  facility_id uuid,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  target text,
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index audit_event_tenant on public.audit_event (tenant_id, at desc);

-- ───────────────────────── Authorization helpers (not exposed through the Data API) ─────────────────────────
create function mrv_auth.try_uuid(p text) returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p::uuid;
exception when others then
  return null;
end $$;

create function mrv_auth.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tenant_membership m join public.tenant t on t.id = m.tenant_id
    where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active' and t.status = 'active')
$$;

-- Live check on every call (no cached claims): active membership + unrevoked role assignment granting the permission.
-- p_facility NULL evaluates tenant-level permissions (tenant-wide assignments only).
create function mrv_auth.has_permission(p_tenant uuid, p_facility uuid, p_permission text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_tenant is not null and auth.uid() is not null
    and (p_facility is null or exists (select 1 from public.facility f where f.id = p_facility and f.tenant_id = p_tenant))
    and exists (
      select 1
      from public.tenant_membership m
      join public.tenant t on t.id = m.tenant_id and t.status = 'active'
      join public.role_assignment a on a.tenant_id = m.tenant_id and a.membership_id = m.id and a.revoked_at is null
      join public.role_permission rp on rp.role = a.role and rp.permission = p_permission
      where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.status = 'active'
        and (a.facility_id is null or (p_facility is not null and a.facility_id = p_facility)))
$$;

create function mrv_auth.owns_membership(p_tenant uuid, p_membership uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenant_membership m where m.tenant_id = p_tenant and m.id = p_membership and m.user_id = auth.uid())
$$;

create function mrv_auth.section_permission(p_section text) returns text language sql immutable set search_path = '' as $$
  select case p_section
    when 'production' then 'activity.write.production'
    when 'inventory' then 'activity.write.production'
    when 'electricity' then 'activity.write.utilities'
    when 'kilnFuel' then 'activity.write.utilities'
    when 'rawMaterial' then 'activity.write.laboratory'
    else 'no.such.permission' end
$$;

revoke all on all functions in schema mrv_auth from public;
grant execute on all functions in schema mrv_auth to authenticated;

-- ───────────────────────── Immutability ─────────────────────────
create function mrv_auth.forbid_mutation() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

create function mrv_auth.reading_supersede_only() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'activity readings cannot be deleted' using errcode = '42501';
  end if;
  if not (old.is_current and not new.is_current)
     or (to_jsonb(new) - 'is_current' - 'superseded_at') is distinct from (to_jsonb(old) - 'is_current' - 'superseded_at') then
    raise exception 'activity readings are immutable; corrections create a new revision' using errcode = '42501';
  end if;
  return new;
end $$;

create function mrv_auth.protect_report_snapshot() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'approved_locked' then
    raise exception 'approved report snapshot % is locked', old.id using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.content is distinct from old.content or new.run_id <> old.run_id or new.tenant_id <> old.tenant_id or new.facility_id <> old.facility_id then
    raise exception 'report snapshot content and ownership cannot change' using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['import_batch', 'source_file', 'config_document', 'calculation_run', 'calculation_run_input',
    'calculation_run_config', 'run_qa_result', 'run_invalidation', 'audit_event'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function mrv_auth.forbid_mutation()', t || '_append_only', t);
  end loop;
end $$;
create trigger activity_reading_supersede_only before update or delete on public.activity_reading
  for each row execute function mrv_auth.reading_supersede_only();
create trigger report_snapshot_lock before update or delete on public.report_snapshot
  for each row execute function mrv_auth.protect_report_snapshot();

-- ───────────────────────── Row-level security + Data API grants ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['tenant', 'tenant_membership', 'facility', 'role_permission', 'role_assignment', 'process_unit',
    'data_source', 'import_batch', 'source_file', 'config_document', 'activity_reading', 'calculation_run',
    'calculation_run_input', 'calculation_run_config', 'run_qa_result', 'run_invalidation', 'report_snapshot',
    'workspace_preference', 'audit_event'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
  foreach t in array array['process_unit', 'data_source', 'import_batch', 'source_file', 'config_document', 'activity_reading',
    'calculation_run', 'calculation_run_input', 'calculation_run_config', 'run_qa_result', 'run_invalidation', 'report_snapshot'] loop
    execute format('create policy %I on public.%I for select to authenticated using (mrv_auth.has_permission(tenant_id, facility_id, %L))',
      t || '_read', t, 'facility.read');
  end loop;
end $$;

create policy tenant_read on public.tenant for select to authenticated using (mrv_auth.is_member(id));
create policy facility_read on public.facility for select to authenticated using (mrv_auth.has_permission(tenant_id, id, 'facility.read'));
create policy membership_read on public.tenant_membership for select to authenticated
  using (user_id = auth.uid() or mrv_auth.has_permission(tenant_id, null, 'members.manage'));
create policy role_assignment_read on public.role_assignment for select to authenticated
  using (mrv_auth.owns_membership(tenant_id, membership_id) or mrv_auth.has_permission(tenant_id, null, 'members.manage'));
create policy role_permission_read on public.role_permission for select to authenticated using (true);
create policy workspace_preference_read on public.workspace_preference for select to authenticated using (user_id = auth.uid());
create policy audit_event_read on public.audit_event for select to authenticated using (mrv_auth.has_permission(tenant_id, null, 'audit.read'));

-- ───────────────────────── Role → permission reference data (mirror of lib/tenancy/permissions.ts) ─────────────────────────
insert into public.role_permission (role, permission) values
  ('tenant_admin', 'facility.read'), ('tenant_admin', 'period.manage'), ('tenant_admin', 'members.manage'),
  ('tenant_admin', 'audit.read'), ('tenant_admin', 'report.read'), ('tenant_admin', 'evidence.read'),
  ('facility_manager', 'facility.read'), ('facility_manager', 'period.manage'), ('facility_manager', 'upload.create'),
  ('facility_manager', 'activity.write.production'), ('facility_manager', 'activity.write.utilities'),
  ('facility_manager', 'activity.write.laboratory'), ('facility_manager', 'mapping.manage'), ('facility_manager', 'calculation.run'),
  ('facility_manager', 'evidence.read'), ('facility_manager', 'evidence.write'), ('facility_manager', 'report.read'),
  ('facility_manager', 'report.export'), ('facility_manager', 'report.submit'), ('facility_manager', 'ai.assess'),
  ('facility_manager', 'scenario.manage'),
  ('contributor_production', 'facility.read'), ('contributor_production', 'upload.create'), ('contributor_production', 'evidence.read'),
  ('contributor_production', 'evidence.write'), ('contributor_production', 'activity.write.production'),
  ('contributor_utilities', 'facility.read'), ('contributor_utilities', 'upload.create'), ('contributor_utilities', 'evidence.read'),
  ('contributor_utilities', 'evidence.write'), ('contributor_utilities', 'activity.write.utilities'),
  ('contributor_laboratory', 'facility.read'), ('contributor_laboratory', 'upload.create'), ('contributor_laboratory', 'evidence.read'),
  ('contributor_laboratory', 'evidence.write'), ('contributor_laboratory', 'activity.write.laboratory'),
  ('mrv_analyst', 'facility.read'), ('mrv_analyst', 'mapping.manage'), ('mrv_analyst', 'factor_override.manage'),
  ('mrv_analyst', 'calculation.run'), ('mrv_analyst', 'qa.manage'), ('mrv_analyst', 'evidence.read'), ('mrv_analyst', 'evidence.write'),
  ('mrv_analyst', 'report.read'), ('mrv_analyst', 'report.export'), ('mrv_analyst', 'report.submit'), ('mrv_analyst', 'ai.assess'),
  ('mrv_analyst', 'scenario.manage'),
  ('reviewer', 'facility.read'), ('reviewer', 'evidence.read'), ('reviewer', 'report.read'), ('reviewer', 'report.export'),
  ('reviewer', 'report.review'), ('reviewer', 'qa.manage'), ('reviewer', 'ai.assess'),
  ('approver', 'facility.read'), ('approver', 'evidence.read'), ('approver', 'report.read'), ('approver', 'report.export'),
  ('approver', 'report.approve'),
  ('auditor', 'facility.read'), ('auditor', 'evidence.read'), ('auditor', 'report.read'), ('auditor', 'report.export'),
  ('auditor', 'audit.read')
on conflict do nothing;
