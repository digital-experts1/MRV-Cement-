-- 0001_tenant_foundation — Supervisor Directive 03
-- Additive only: creates new objects; never drops or rewrites existing data.
-- Isolation layers: (1) server-side authorization, (2) tenant-consistent composite FKs, (3) row-level security
-- evaluated for the non-bypassing application role `trace_app`, with transaction-local context (set_config(..., true)).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'trace_app') THEN
    CREATE ROLE trace_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS ref;

-- ───────────────────────── Identity ─────────────────────────
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Opaque session tokens; only the SHA-256 hash is stored. Not readable by trace_app.
CREATE TABLE auth_session (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- ───────────────────────── Business hierarchy ─────────────────────────
CREATE TABLE tenant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL REFERENCES app_user (id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  granted_by uuid REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, user_id)
);

CREATE TABLE facility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  code text NOT NULL,
  name text NOT NULL,
  country text,
  timezone text NOT NULL DEFAULT 'UTC',
  reporting_boundary text NOT NULL DEFAULT 'Facility operational boundary (gate-to-gate)',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

-- Membership alone grants nothing: every permission comes from an explicit, scoped role assignment.
CREATE TABLE facility_role_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN (
    'tenant_admin', 'facility_manager', 'contributor_production', 'contributor_utilities',
    'contributor_laboratory', 'mrv_analyst', 'reviewer', 'approver', 'auditor')),
  scope_type text NOT NULL CHECK (scope_type IN ('tenant', 'facility')),
  facility_id uuid,
  granted_by uuid REFERENCES app_user (id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, membership_id) REFERENCES tenant_membership (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id),
  CHECK ((scope_type = 'tenant' AND facility_id IS NULL) OR (scope_type = 'facility' AND facility_id IS NOT NULL)),
  CHECK (role <> 'tenant_admin' OR scope_type = 'tenant')
);

-- Explicit, time-boxed, audited support access for platform administrators (read-only).
CREATE TABLE support_access_grant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  platform_admin_id uuid NOT NULL REFERENCES app_user (id),
  granted_by uuid NOT NULL REFERENCES app_user (id),
  reason text NOT NULL CHECK (length(reason) >= 10),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (tenant_id, id)
);

CREATE TABLE process_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  unit_type text NOT NULL CHECK (unit_type IN ('kiln', 'raw_mill', 'cement_mill', 'grinding_unit', 'dryer', 'power_plant', 'other')),
  name text NOT NULL,
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id)
);

CREATE TABLE reporting_period (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  label text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'collecting' CHECK (status IN ('draft', 'collecting', 'calculated', 'under_review', 'approved_locked', 'revision')),
  UNIQUE (tenant_id, facility_id, id),
  UNIQUE (tenant_id, facility_id, start_date, end_date),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id),
  CHECK (end_date >= start_date)
);

-- ───────────────────────── Shared reference catalog (not tenant-owned) ─────────────────────────
CREATE TABLE ref.factor_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  value numeric NOT NULL,
  unit text NOT NULL,
  source_document text NOT NULL,
  effective_from date NOT NULL,
  UNIQUE (code, version)
);

-- ───────────────────────── Tenant-owned operational data ─────────────────────────
CREATE TABLE factor_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  facility_id uuid,
  factor_code text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  base_catalog_id uuid NOT NULL REFERENCES ref.factor_catalog (id),
  value numeric NOT NULL,
  unit text NOT NULL,
  justification text NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, facility_id, factor_code, version),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id)
);

CREATE TABLE source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('dcs', 'erp', 'lims', 'workbook', 'manual', 'data_package')),
  name text NOT NULL,
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id)
);

CREATE TABLE upload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  source_id uuid,
  filename text NOT NULL,
  sha256 text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL UNIQUE,
  uploaded_by uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, facility_id, id),
  -- Deduplication is scoped to one tenant/facility/period; identical files in other tenants are independent rows.
  UNIQUE (tenant_id, facility_id, period_id, sha256),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, source_id) REFERENCES source (tenant_id, facility_id, id)
);

CREATE TABLE mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  upload_id uuid NOT NULL,
  source_field text NOT NULL,
  target_field text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, upload_id) REFERENCES upload (tenant_id, facility_id, id)
);

CREATE TABLE activity_record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  process_unit_id uuid,
  upload_id uuid,
  domain text NOT NULL CHECK (domain IN ('production', 'utilities', 'laboratory')),
  activity_type text NOT NULL,
  value numeric,
  unit text NOT NULL,
  value_state text NOT NULL CHECK (value_state IN ('present', 'missing', 'zero', 'not_applicable', 'rejected')),
  observed_on date,
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES app_user (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, process_unit_id) REFERENCES process_unit (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, upload_id) REFERENCES upload (tenant_id, facility_id, id),
  CHECK ((value_state = 'present' AND value IS NOT NULL) OR (value_state = 'zero' AND value = 0) OR (value_state IN ('missing', 'not_applicable', 'rejected') AND value IS NULL))
);

-- Inter-factory transfers name a counterparty facility of the SAME tenant (composite FK).
CREATE TABLE inventory_movement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  material text NOT NULL,
  movement text NOT NULL CHECK (movement IN ('opening_stock', 'closing_stock', 'receipt', 'dispatch', 'transfer_in', 'transfer_out', 'adjustment')),
  quantity numeric NOT NULL,
  unit text NOT NULL,
  counterparty_facility_id uuid,
  -- True when the receiving facility's reported production figure already contains this transferred quantity
  -- (e.g. dispatch-based output); consolidation then removes it to avoid double counting.
  included_in_reported_output boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES app_user (id),
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, counterparty_facility_id) REFERENCES facility (tenant_id, id),
  CHECK ((movement IN ('transfer_in', 'transfer_out')) = (counterparty_facility_id IS NOT NULL)),
  CHECK (counterparty_facility_id IS DISTINCT FROM facility_id)
);

CREATE TABLE lab_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  process_unit_id uuid,
  analyte text NOT NULL,
  value numeric,
  unit text NOT NULL,
  sampled_on date,
  created_by uuid NOT NULL REFERENCES app_user (id),
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, process_unit_id) REFERENCES process_unit (tenant_id, facility_id, id)
);

CREATE TABLE calculation_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES app_user (id),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'failed', 'completed')),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (tenant_id, facility_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id)
);

CREATE TABLE calculation_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  job_id uuid NOT NULL,
  engine_version text NOT NULL,
  input_hash text NOT NULL,
  results jsonb NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, job_id) REFERENCES calculation_job (tenant_id, facility_id, id)
);

CREATE TABLE qa_issue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  run_id uuid NOT NULL,
  rule_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('blocking', 'warning', 'info')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  message text NOT NULL,
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, run_id) REFERENCES calculation_run (tenant_id, facility_id, id)
);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid,
  evidence_code text NOT NULL,
  title text NOT NULL,
  mime text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  text_content text NOT NULL DEFAULT '',
  -- "mapped" means linked to a record only; never "verified".
  mapping_status text NOT NULL DEFAULT 'pending' CHECK (mapping_status IN ('pending', 'mapped', 'missing')),
  created_by uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id)
);

CREATE TABLE evidence_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  activity_record_id uuid,
  lab_result_id uuid,
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, evidence_id) REFERENCES evidence (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, activity_record_id) REFERENCES activity_record (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, lab_result_id) REFERENCES lab_result (tenant_id, facility_id, id),
  CHECK (num_nonnulls(activity_record_id, lab_result_id) = 1)
);

CREATE TABLE report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  period_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('internal_pdf', 'presentation_xlsx', 'data_package')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  synthetic boolean NOT NULL DEFAULT false,
  content jsonb NOT NULL,
  sha256 text NOT NULL,
  submitted_by uuid REFERENCES app_user (id),
  approved_by uuid REFERENCES app_user (id),
  approved_at timestamptz,
  UNIQUE (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, period_id) REFERENCES reporting_period (tenant_id, facility_id, id),
  FOREIGN KEY (tenant_id, facility_id, run_id) REFERENCES calculation_run (tenant_id, facility_id, id),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND approved_by IS DISTINCT FROM submitted_by))
);

CREATE TABLE approval (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  report_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_user (id),
  action text NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected')),
  comment text,
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, facility_id, report_id) REFERENCES report (tenant_id, facility_id, id)
);

-- AI output is advisory only; the CHECK makes that a schema invariant.
CREATE TABLE ai_assessment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  run_id uuid,
  question text NOT NULL,
  retrieved_evidence_ids uuid[] NOT NULL DEFAULT '{}',
  output text NOT NULL,
  advisory boolean NOT NULL DEFAULT true CHECK (advisory),
  created_by uuid NOT NULL REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, facility_id, run_id) REFERENCES calculation_run (tenant_id, facility_id, id)
);

CREATE TABLE mitigation_scenario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  base_run_id uuid NOT NULL,
  name text NOT NULL,
  assumptions jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES app_user (id),
  FOREIGN KEY (tenant_id, facility_id, base_run_id) REFERENCES calculation_run (tenant_id, facility_id, id)
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenant (id),
  facility_id uuid,
  actor_id uuid REFERENCES app_user (id),
  action text NOT NULL,
  target text,
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'denied')),
  via text NOT NULL DEFAULT 'membership' CHECK (via IN ('membership', 'support', 'system')),
  detail jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id)
);

-- ───────────────────────── Context and scope functions ─────────────────────────
CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app.has_support_grant(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM support_access_grant g JOIN app_user u ON u.id = g.platform_admin_id
    WHERE g.tenant_id = p_tenant AND g.platform_admin_id = app.current_user_id()
      AND u.is_platform_admin AND u.status = 'active' AND g.revoked_at IS NULL AND g.expires_at > now())
$$;

CREATE FUNCTION app.is_active_member(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_membership m JOIN app_user u ON u.id = m.user_id JOIN tenant t ON t.id = m.tenant_id
    WHERE m.tenant_id = p_tenant AND m.user_id = app.current_user_id()
      AND m.status = 'active' AND u.status = 'active' AND t.status = 'active')
$$;

CREATE FUNCTION app.has_tenant_role(p_tenant uuid, p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.is_active_member(p_tenant) AND EXISTS (
    SELECT 1 FROM facility_role_assignment a JOIN tenant_membership m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
    WHERE a.tenant_id = p_tenant AND m.user_id = app.current_user_id()
      AND a.role = p_role AND a.scope_type = 'tenant' AND a.revoked_at IS NULL AND a.valid_from <= now())
$$;

-- Row visibility: the row's tenant must equal the transaction's tenant context AND the user must hold an
-- active role assignment covering the facility (or an explicit, unexpired support grant).
-- p_facility IS NULL is used only for tenant-level rows (e.g. tenant-wide factor overrides): any active assignment.
CREATE FUNCTION app.can_write_facility(p_tenant uuid, p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_tenant = app.current_tenant_id() AND app.is_active_member(p_tenant) AND EXISTS (
    SELECT 1 FROM facility_role_assignment a JOIN tenant_membership m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
    WHERE a.tenant_id = p_tenant AND m.user_id = app.current_user_id() AND a.revoked_at IS NULL AND a.valid_from <= now()
      AND (a.scope_type = 'tenant' OR p_facility IS NULL OR a.facility_id = p_facility))
$$;

-- Support access (explicit grant) is read-only: it widens SELECT visibility only.
CREATE FUNCTION app.can_access_facility(p_tenant uuid, p_facility uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.can_write_facility(p_tenant, p_facility)
    OR (p_tenant = app.current_tenant_id() AND app.has_support_grant(p_tenant))
$$;

-- Session resolution runs before any user context exists; exposes only the user id for a valid token hash.
CREATE FUNCTION app.resolve_session(p_token_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.user_id FROM auth_session s JOIN app_user u ON u.id = s.user_id
  WHERE s.token_hash = p_token_hash AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'active'
$$;

-- Background workers claim jobs without seeing job contents of other tenants; the work itself then runs
-- under the requesting user's re-validated scope.
CREATE FUNCTION app.claim_next_job() RETURNS TABLE (job_id uuid, job_tenant_id uuid, job_facility_id uuid, job_requested_by uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE calculation_job j SET status = 'running', attempts = j.attempts + 1
  WHERE j.id = (SELECT q.id FROM calculation_job q WHERE q.status = 'queued' ORDER BY q.created_at, q.id LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING j.id, j.tenant_id, j.facility_id, j.requested_by
$$;

CREATE FUNCTION app.release_job(p_job uuid, p_error text, p_retry boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE calculation_job SET status = CASE WHEN p_retry AND attempts < 3 THEN 'queued' ELSE 'failed' END,
    error = p_error, finished_at = CASE WHEN p_retry AND attempts < 3 THEN NULL ELSE now() END
  WHERE id = p_job AND status = 'running'
$$;

CREATE FUNCTION app.write_audit(p_tenant uuid, p_facility uuid, p_action text, p_target text, p_outcome text, p_via text, p_detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO audit_log (tenant_id, facility_id, actor_id, action, target, outcome, via, detail)
  VALUES (
    (SELECT id FROM tenant WHERE id = p_tenant),
    (SELECT id FROM facility WHERE tenant_id = p_tenant AND id = p_facility),
    app.current_user_id(), p_action, p_target, p_outcome, p_via, coalesce(p_detail, '{}'::jsonb))
$$;

-- Tenant admins look up existing users by exact email to add a membership; nobody else can.
CREATE FUNCTION app.find_user_for_admin(p_tenant uuid, p_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id FROM app_user u
  WHERE app.has_tenant_role(p_tenant, 'tenant_admin') AND p_tenant = app.current_tenant_id() AND lower(u.email) = lower(p_email)
$$;

-- ───────────────────────── Immutability ─────────────────────────
CREATE FUNCTION app.forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE FUNCTION app.protect_approved_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'approved report % is immutable', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.facility_id <> OLD.facility_id OR NEW.run_id <> OLD.run_id OR NEW.content <> OLD.content THEN
    RAISE EXCEPTION 'report ownership and content cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION app.protect_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.facility_id <> OLD.facility_id THEN
    RAISE EXCEPTION 'tenant/facility ownership of % cannot be changed', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calculation_run', 'approval', 'audit_log', 'factor_override', 'ai_assessment'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation()', t || '_append_only', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['source', 'upload', 'mapping', 'activity_record', 'inventory_movement', 'lab_result', 'calculation_job', 'qa_issue', 'evidence', 'evidence_link', 'mitigation_scenario', 'process_unit', 'reporting_period'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app.protect_ownership()', t || '_ownership', t);
  END LOOP;
END $$;

CREATE TRIGGER report_protect BEFORE UPDATE OR DELETE ON report FOR EACH ROW EXECUTE FUNCTION app.protect_approved_report();

-- ───────────────────────── Row-level security ─────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['process_unit', 'reporting_period', 'source', 'upload', 'mapping', 'activity_record',
    'inventory_movement', 'lab_result', 'calculation_job', 'calculation_run', 'qa_issue', 'evidence', 'evidence_link',
    'report', 'approval', 'ai_assessment', 'mitigation_scenario'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app.can_access_facility(tenant_id, facility_id))', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app.can_write_facility(tenant_id, facility_id))', t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (app.can_write_facility(tenant_id, facility_id)) WITH CHECK (app.can_write_facility(tenant_id, facility_id))', t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (app.can_write_facility(tenant_id, facility_id))', t || '_delete', t);
  END LOOP;
END $$;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_member ON tenant FOR SELECT USING (app.is_active_member(id) OR app.has_support_grant(id));

ALTER TABLE facility ENABLE ROW LEVEL SECURITY;
CREATE POLICY facility_scope ON facility FOR SELECT USING (app.can_access_facility(tenant_id, id));

ALTER TABLE factor_override ENABLE ROW LEVEL SECURITY;
CREATE POLICY factor_override_read ON factor_override FOR SELECT USING (app.can_access_facility(tenant_id, facility_id));
CREATE POLICY factor_override_insert ON factor_override FOR INSERT WITH CHECK (app.can_write_facility(tenant_id, facility_id));

ALTER TABLE tenant_membership ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON tenant_membership FOR SELECT
  USING (user_id = app.current_user_id() OR (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin')));
CREATE POLICY membership_admin_insert ON tenant_membership FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin'));
CREATE POLICY membership_admin_update ON tenant_membership FOR UPDATE
  USING (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin'))
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE facility_role_assignment ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_read ON facility_role_assignment FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_membership m WHERE m.tenant_id = facility_role_assignment.tenant_id AND m.id = facility_role_assignment.membership_id AND m.user_id = app.current_user_id())
         OR (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin')));
CREATE POLICY assignment_admin_insert ON facility_role_assignment FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin'));
CREATE POLICY assignment_admin_update ON facility_role_assignment FOR UPDATE
  USING (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin'))
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE support_access_grant ENABLE ROW LEVEL SECURITY;
CREATE POLICY support_grant_read ON support_access_grant FOR SELECT
  USING (platform_admin_id = app.current_user_id() OR (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin')));
CREATE POLICY support_grant_admin_write ON support_access_grant FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin') AND granted_by = app.current_user_id());
CREATE POLICY support_grant_admin_update ON support_access_grant FOR UPDATE
  USING (tenant_id = app.current_tenant_id() AND app.has_tenant_role(tenant_id, 'tenant_admin'));

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_user_visible ON app_user FOR SELECT
  USING (id = app.current_user_id() OR EXISTS (
    SELECT 1 FROM tenant_membership m WHERE m.user_id = app_user.id AND m.tenant_id = app.current_tenant_id()
      AND app.has_tenant_role(m.tenant_id, 'tenant_admin')));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_log FOR SELECT
  USING (tenant_id = app.current_tenant_id() AND (app.has_tenant_role(tenant_id, 'tenant_admin') OR app.has_tenant_role(tenant_id, 'auditor')));

-- ───────────────────────── Grants for the application role ─────────────────────────
GRANT USAGE ON SCHEMA public, app, ref TO trace_app;
GRANT SELECT ON ref.factor_catalog TO trace_app;
GRANT SELECT ON tenant, facility, app_user TO trace_app;
GRANT SELECT, INSERT, UPDATE ON tenant_membership, facility_role_assignment, support_access_grant TO trace_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON process_unit, reporting_period, source, upload, mapping, activity_record,
  inventory_movement, lab_result, calculation_job, qa_issue, evidence_link, mitigation_scenario TO trace_app;
GRANT SELECT, INSERT, UPDATE ON report, evidence TO trace_app;
GRANT SELECT, INSERT ON calculation_run, approval, ai_assessment, factor_override TO trace_app;
GRANT SELECT ON audit_log TO trace_app;
REVOKE ALL ON auth_session FROM trace_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO trace_app;
