# Factory profile editing

Organization administrators can use Factories → Edit factory to update the name, country, city/region, site address, site type and registration/reference number. Location fields are optional for existing factories. Location appears in the directory; name updates appear in workspace selectors after reload.

Factory UUID, tenant, code, timezone and reporting boundary are not editable in this profile drawer. Site type is descriptive only. Existing readings, imported workbooks, historical calculation snapshots, methodology and report approval states are preserved. Historical snapshots retain the original metadata; profile editing does not rewrite them.

Deploy `db/supabase/20261104023501_factory_profile_edit.sql` before the application. The additive migration adds profile/version columns and an atomic RPC. Existing facility RLS and direct-write denial remain in place. The RPC checks authenticated identity, tenant-level members.manage, facility access, tenant/factory pairing, strict field types/allowlist and the expected version under a row lock. Audit records contain before/after profile values. A stale edit returns HTTP 409 instead of overwriting a concurrent edit.

Checks: extended PGlite acceptance suite covers successful update, audit, protected/invalid fields, stale versions, cross-tenant pairing, another administrator, non-admin factory manager, anonymous and direct-table write rejection. Browser fixture covers load/save payload, cancel, conflict retention, mobile layout and runtime errors. `db/supabase/tests/factory_edit_check.sql` verifies the hosted RPC with synthetic fixtures, ending with `FACTORY_EDIT_PASS_ROLLED_BACK` so no fixtures persist.

Recovery branch: `recovery/before-factory-edit-2026-11-04` at `516ac6e5983bd8925ce98192ede244ae6e8e4dab`. Reverting the app is compatible with the additive database migration; retain the new columns to preserve edits.
