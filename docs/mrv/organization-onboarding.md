# Organization onboarding

The `/onboarding` route now uses Organization → First factory → Reporting setup → Review & create. Back preserves the in-memory draft. No write occurs before the final confirmation. Invitation acceptance remains available on `?invite=...`.

The initial date range sets the user's reporting view. It does not replace calculation methodology, factors, approvals or reporting configuration. Company initials are generated from the organization name; logo file uploads are not included in this release.

## Database and isolation

Apply `db/supabase/0009_organization_onboarding.sql` after 0001–0008 before deploying the application. It adds `tenant.profile`, a private retry ledger, and `mrv_onboard_organization(uuid,jsonb)`. Existing organization creation remains compatible. The migration was applied to the Cement MRV project on 2026-11-03.

The onboarding RPC deliberately runs with definer privileges to atomically bootstrap the tenant, first facility, membership, initial roles, audit event, profile and preference. It obtains the owner from `auth.uid()` and rejects client-supplied tenant, owner and role fields. The SQL validates the payload independently of TypeScript. EXECUTE is denied to PUBLIC/anon and granted only to authenticated users. Its search_path is empty. Retries are scoped to the signed-in user and request UUID; changed payloads and retries after access revocation are rejected.

Existing tenant membership / facility permission RLS policies protect the new profile alongside existing data. The retry ledger is in `mrv_private`, has RLS enabled, and intentionally has no user-facing policies or grants. The security advisor's no-policy informational finding for this private ledger and authenticated-definer warning for the explicit onboarding RPC are intentional, not reasons to grant broader access.

The existing Auth leaked-password-protection warning remains separate from tenant isolation: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.

## Validation

- TypeScript, production build and production bundle isolation check.
- 154 passing tests (one hosted E2E suite skipped without test credentials; embedded-postgres concurrency suite excluded locally because initdb refuses root).
- PGlite database harness tests cross-tenant reads, forged scope/role fields, private ledger denial, revoked-user retries, anonymous denial and duplicate requests, as well as existing readings, reports, evidence and access-control cases.
- Browser component test: four steps, validation, no early writes, Back preservation, same-key retry, redirect after success, desktop and 390px mobile layouts with no horizontal overflow or browser errors. API/session responses are mocked in this UI check.
- Live Supabase rollback-only smoke test: `db/supabase/tests/onboarding_isolation_check.sql`. The final intentional `ONBOARDING_ISOLATION_PASS_ROLLED_BACK` exception proves checks passed and removes all synthetic fixtures. Confirmed zero retained smoke tenants.

The GitHub PR checks must pass before merge. A successful local/rollback test is not a claim of end-to-end production UI verification; that requires deploying the branch and exercising the signed-in flow.
