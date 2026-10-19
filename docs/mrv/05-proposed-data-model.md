# 05 — Canonical Data Model (v2, corrected per Supervisor Directive 02)

Target: PostgreSQL. Status: tenancy/identity/operational ownership layer **implemented** in `db/migrations/0001_tenant_foundation.sql`
(see [10](10-multi-tenant-foundation.md); names there supersede this design where they differ, e.g. `facility_role_assignment`
replaces `role_assignment`, `ref.factor_catalog` + `factor_override`). Remaining entities below are still design only.
The migration has only been run against ephemeral in-process databases, never against a deployed database.
Conventions: `id uuid`, `created_at`, `created_by`. Mutable tables carry `version` (optimistic concurrency).
⛔ = insert-only (enforced by revoking UPDATE/DELETE from the application role and by triggers).

## Corrections applied in v2

| # | Directive 02 correction | Where |
|---|---|---|
| C1 | Mutable job status separated from immutable completed snapshots | `calculation_job` vs `calculation_snapshot` |
| C2 | Snapshots preserve actual input **versions**, not mutable references | `calculation_snapshot_input` copies values |
| C3 | Tenant ownership enforced by DB constraints + authorization, not just `tenant_id` | composite FKs + RLS (§1) |
| C4 | Role assignments with explicit tenant and facility scope | `role_assignment` |
| C5 | External verification is a separate evidence-backed event | `verification_statement` |
| C6 | Shared unit definitions separated from tenant-owned records | `ref_*` schema |
| C7 | Explicit inventory movements and product allocation relationships | `inventory_movement`, `product_allocation` |
| C8 | Required-data completeness defined separately from QA pass % | `completeness_rule`, snapshot metrics |

## 1. Tenancy enforcement (C3)

- Every tenant-owned table has `tenant_id NOT NULL` **and** a composite unique key `(tenant_id, id)`.
- Child tables reference parents with **composite foreign keys** including `tenant_id`, e.g.
  `FOREIGN KEY (tenant_id, facility_id) REFERENCES facility (tenant_id, id)`. A row can therefore never point at a
  parent belonging to another tenant, even if application code is wrong.
- PostgreSQL Row-Level Security on every tenant table: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`;
  the request handler sets `app.tenant_id` from the authenticated session inside a transaction (`SET LOCAL`).
- Authorization (server, per request) checks `role_assignment` scope before any query; RLS is the second line.

## 2. Shared reference data (C6) — schema `ref`, not tenant-owned, read-only to tenants

- **ref.unit**(code PK, dimension, si_factor numeric, description)
- **ref.unit_conversion**(from_unit, to_unit, factor numeric, requires_property null|density|ncv) — PK(from,to)
- **ref.methodology_version** ⛔(id, code, formula_set_version, source_ref, description)
- **ref.qa_rule_version** ⛔(id, code, severity blocking|warning|info, applicability, expression_ref)
- **ref.completeness_rule** ⛔(id, methodology_version_id, entity, field, condition) — defines "required" (C8)
- **ref.default_factor** ⛔(id, code, value numeric, unit → ref.unit, source_document, source_section, version, effective_from/to)

Tenants may copy a default into their own **factor** table; they never edit `ref.*`.

## 3. Identity and scope (C4)

- **tenant**(id, name)
- **facility**(tenant_id, id, name, country, timezone) — UNIQUE(tenant_id, id)
- **app_user**(id, email, display_name, auth_subject) — global identity
- **role_assignment**(tenant_id, id, user_id → app_user, role, scope_type `tenant|facility`, facility_id NULL,
  valid_from, valid_to, granted_by)
  - CHECK `(scope_type = 'tenant' AND facility_id IS NULL) OR (scope_type = 'facility' AND facility_id IS NOT NULL)`
  - FK `(tenant_id, facility_id) → facility(tenant_id, id)`
  - Roles: data_entry, reviewer, approver, tenant_admin, **external_verifier** (read-only; can file a
    verification statement, cannot edit data). Segregation of duties enforced in the approval service.
- **process_unit**(tenant_id, id, facility_id, type kiln|raw_mill|cement_mill|dryer|power_plant|other, name)
- **product**(tenant_id, id, facility_id, code, name, grade, standard)

## 4. Periods and basis

- **reporting_basis** ⛔(tenant_id, id, profile corporate_ghg|product_embedded|internal_kpi, methodology_version_id,
  boundary_text, version, validation_status validated|unvalidated)
- **reporting_period**(tenant_id, id, facility_id, basis_id, start_date, end_date,
  status draft|collecting|calculated|under_review|approved_locked|revision, version)

## 5. Ingestion and provenance

- **source_file** ⛔(tenant_id, id, facility_id, filename, mime, size_bytes, sha256, storage_key (private bucket),
  uploaded_by, uploaded_at)
- **import_batch**(tenant_id, id, period_id, source_file_id NULL (manual entry has none), channel
  workbook|manual|data_package, schema_version, status staged|validated|committed|rejected|superseded, version)
- **raw_source_record** ⛔(tenant_id, id, import_batch_id, sheet, row_number, column, raw_value text, raw_type,
  number_format) — the untouched cell value, kept before any normalization (Directive item J)
- **workbook_assertion** ⛔(tenant_id, id, import_batch_id, sheet, field, claimed_value text, computed_value text,
  outcome match|mismatch|not_comparable) — workbook totals/statuses as comparison only (item D)

## 6. Canonical activity data (tenant-owned, versioned)

- **activity_record**(tenant_id, id, period_id, facility_id, process_unit_id NULL, activity_type, observed_on,
  value numeric NULL, unit → ref.unit, value_state present|missing|zero|not_applicable|rejected,
  raw_source_record_id NULL, evidence_ref NULL, version)
- **activity_record_version** ⛔(tenant_id, id, activity_record_id, version, value, unit, value_state, changed_by,
  reason, at) — every edit appends a version
- **inventory_movement** (C7)(tenant_id, id, period_id, facility_id, material clinker|cement|raw_meal|fuel:<code>,
  movement opening_stock|closing_stock|receipt|dispatch|transfer_in|transfer_out|adjustment, quantity numeric,
  unit, observed_on, evidence_ref, version) + **inventory_movement_version** ⛔
- **product_allocation** (C7)(tenant_id, id, period_id, product_id, clinker_used numeric, cement_produced numeric,
  allocation_method, version) — explicit clinker→product relationship (no generic JSON)
- **evidence_item**(tenant_id, id, facility_id, evidence_code, type, description, storage_key NULL (private),
  sha256 NULL, mapping_status pending|mapped|missing, version) — **mapped = linked, never "verified"**
- **evidence_link**(tenant_id, evidence_item_id, target_table, target_id) — composite FKs per target type

## 7. Calculation (C1, C2, C8)

- **calculation_job** (mutable, operational)(tenant_id, id, period_id, requested_by, status
  queued|running|failed|completed, error, started_at, finished_at, idempotency_key, snapshot_id NULL)
- **calculation_snapshot** ⛔(tenant_id, id, period_id, methodology_version_id, engine_version, input_hash,
  completeness_pct, qa_pass_pct, overall_qa_status, readiness, created_at) — written once when a job completes
- **calculation_snapshot_input** ⛔(tenant_id, snapshot_id, source_table, source_id, source_version,
  value numeric NULL, unit, value_state) — **copies of the input values used**, so later edits to
  `activity_record` cannot change a completed snapshot
- **calculation_snapshot_factor** ⛔(tenant_id, snapshot_id, factor_code, value, unit, source_document, version)
- **calculation_result** ⛔(tenant_id, snapshot_id, metric_code, value numeric NULL, unit, product_id NULL,
  lineage JSON) — `lineage` lists snapshot_input ids/formula ids (basis for AI "explain this number")
- **qa_result** ⛔(tenant_id, snapshot_id, rule_version_id, status pass|warning|fail|not_evaluated, observed, comment)
- **completeness_result** ⛔(tenant_id, snapshot_id, completeness_rule_id, present boolean)

Completeness (share of required items present) and QA pass % (passing checks / all checks) are stored and displayed
separately. NOT_EVALUATED never counts as pass.

## 8. Review, approval and external verification (C5)

- **approval_event** ⛔(tenant_id, id, snapshot_id, actor, action submitted|approved|rejected|reopened, comment, at)
- **verification_statement** ⛔(tenant_id, id, snapshot_id, report_version, verifier_user_id → app_user,
  verifier_organisation, accreditation_ref, scope_text, opinion reasonable|limited|qualified|adverse,
  statement_date, statement_evidence_item_id NOT NULL → evidence_item, recorded_by, recorded_at)
  - "Verified" status may be displayed **only** when a `verification_statement` exists for that exact snapshot and
    report version. A role flag alone never sets verified status.
- **report_version** ⛔(tenant_id, id, snapshot_id, kind internal_pdf|presentation_xlsx|data_package, synthetic
  boolean, sha256, storage_key, created_at)

## Current implementation mapping (client-side, interim)

| Model concept | Implemented now in | Notes |
|---|---|---|
| raw_source_record / provenance | `RowSource` (`_source.raw`) on every imported row | per row, not per cell table |
| workbook_assertion | `Store.assertions` (`lib/assertions.ts`) | |
| inventory_movement | `MrvInput.inventory`, sheet `14_Inventory_Movements` | clinker only |
| completeness_result | `lib/completeness.ts` | rules hard-coded, not yet `ref.completeness_rule` |
| calculation_snapshot (immutable inputs) | `Store.inputs` deep-copied + `meta.revision` hash | in memory only; no persistence |
| verification_statement | **not implemented**; UI states "not externally verified" everywhere | |
| tenancy / roles | `db/migrations/0001_tenant_foundation.sql`, `lib/server/**` | tested in dev (doc 10) |
| product_allocation | **not implemented** (Sprint 7) | |
