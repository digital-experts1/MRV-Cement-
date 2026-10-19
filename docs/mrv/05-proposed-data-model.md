# 05 — Proposed Canonical Data Model (input to Sprint 2)

Relational model for PostgreSQL (pending D-01). Every table carries `tenant_id` (row-level isolation),
`created_at`, `created_by`. Mutable business tables carry `version` (optimistic concurrency).
Immutable tables (marked ⛔) are insert-only.

## Identity & structure
- **tenant**(id, name)
- **facility**(id, tenant_id, name, country, timezone)
- **process_unit**(id, facility_id, type: kiln|raw_mill|cement_mill|dryer|power_plant|other, name)
- **product**(id, facility_id, code, name, grade, standard)
- **app_user**, **role_assignment**(user_id, tenant_id, facility_id?, role) — roles per Sprint 7 list

## Period & basis
- **reporting_basis** ⛔(id, profile: corporate_ghg|product_embedded|internal_kpi, methodology_ref, boundary_text, version, effective_from, effective_to, validation_status: validated|unvalidated)
- **reporting_period**(id, facility_id, basis_id, start_date, end_date, status: draft|collecting|validating|calculated|under_review|approved_locked|revision, version)

## Ingestion & sources
- **source_system**(id, facility_id, kind: workbook|manual|scada|dcs|erp|lims, name, description) — metadata only, no live integration claim
- **source_file** ⛔(id, facility_id, filename, mime, size_bytes, sha256, storage_key, uploaded_by, uploaded_at)
- **workbook_schema_version** ⛔(id, code e.g. "V28-14sheet", sheet/column contract JSON)
- **mapping_version** ⛔(id, schema_version_id, mapping JSON)
- **import_batch**(id, period_id, source_file_id?, mapping_version_id, status: staged|validated|committed|rejected|superseded, committed_at)
- **raw_source_record** ⛔(id, import_batch_id, sheet, row_number, column, raw_value text, raw_type, number_format)

## Canonical activity data
- **unit**(code, dimension: mass|energy|volume|energy_per_mass|emission_per_energy|fraction|…, si_factor)
- **unit_conversion**(from_unit, to_unit, factor, requires_property?) — mass↔volume only with declared density
- **activity_record**(id, period_id, facility_id, process_unit_id?, product_id?, activity_type, observed_from, observed_to, timezone, original_value numeric, original_unit, normalized_value numeric, normalized_unit, basis: wet|dry|as_received|n_a, value_state: present|missing|zero|not_applicable|below_detection_limit, data_status: measured|estimated|corrected|substituted, raw_source_record_id?, version)
- **activity_record_revision** ⛔(id, activity_record_id, previous_values JSON, reason, actor, at)

## Methodology & factors
- **methodology_version** ⛔(id, code, formula_set_version, description, source_ref)
- **factor** ⛔(id, code, value numeric, unit, source_document, source_section, version, effective_from, effective_to, status)

## Calculation
- **input_snapshot** ⛔(id, period_id, activity_record_versions JSON, factor_ids JSON, hash)
- **calculation_run** ⛔(id, period_id, input_snapshot_id, methodology_version_id, engine_version, status: pending|running|failed|completed, started_at, finished_at, idempotency_key)
- **calculation_result** ⛔(id, run_id, metric_code, value numeric, unit, boundary, product_id?, lineage JSON)

## QA/QC, evidence, approval, reporting
- **qa_rule_version** ⛔(id, code, severity: blocking|warning|info, applicability, expression_ref)
- **qa_result** ⛔(id, run_id, rule_version_id, status: pass|fail|not_evaluated|not_applicable, observed, expected)
- **qa_issue**(id, qa_result_id, owner, status: open|in_correction|retest|closed|waived, version) + **qa_issue_event** ⛔
- **evidence_file** ⛔(id, source_file_id, …) + **evidence_link**(evidence_id, target_type, target_id) + **evidence_review** ⛔(decision: accepted|rejected, reviewer, reason)
- **approval** ⛔(id, period_id, run_id, step: technical_review|approval, decision, actor, reason, at)
- **report_snapshot** ⛔(id, run_id, profile, version, file_key, sha256, supersedes_id?, internal_approval_id?, external_verification_status: none|in_progress|verified — set only by verifier role)

## Migration of existing data
There is no persisted data today (in-memory only), so Sprint 2 requires **no data migration**. Existing
`localStorage` drafts (`app/dataentry`) are user-local; Sprint 3 offers a one-time "import draft" action rather
than automatic migration.
