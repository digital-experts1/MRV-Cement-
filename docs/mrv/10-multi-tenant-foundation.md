# 10 — Multi-Tenant Foundation (Supervisor Directive 03)

Status: **implemented and isolation-tested in development against real PostgreSQL semantics (PGlite)**.
Not deployed. No production or external database was created, modified or reset.

## 1. Deployment / database inspection

| Item | Finding |
|---|---|
| Repository | No prior database code, migrations, ORM, `vercel.json` or DB environment variables (`.env.example` placeholders only). |
| Vercel / Neon accounts | A read-only project listing was attempted through the connected tools and **timed out**; deployed state is therefore **UNVERIFIED**. Nothing was provisioned. |
| Consequence | Migrations are additive only and tracked in `schema_migrations`. Before applying to any real database, inspect it first (existing tables, roles, data). |

## 2. Schema

Migration: `db/migrations/0001_tenant_foundation.sql` (runner: `lib/server/db/migrate.ts`).

### Identity and hierarchy

| Table | Ownership | Key constraints |
|---|---|---|
| `app_user` | global identity | `auth_subject` unique (IdP subject), `is_platform_admin` |
| `auth_session` | global, **no grant to `trace_app`** | only SHA-256 of token stored; resolved via `app.resolve_session()` |
| `tenant` | — | customer organisation / cement group |
| `tenant_membership` | tenant | UNIQUE(tenant, user); status active/suspended/revoked |
| `facility` | tenant | UNIQUE(tenant_id, id) for composite FKs |
| `facility_role_assignment` | tenant (+facility) | FK (tenant, membership) and (tenant, facility); scope `tenant`\|`facility`; `tenant_admin` tenant-wide only |
| `support_access_grant` | tenant | explicit, time-boxed (`expires_at`), reason required |
| `process_unit` | tenant + facility | kiln, raw/cement mill, grinding unit, dryer, power plant, other |
| `reporting_period` | tenant + facility | facility-specific; UNIQUE(tenant, facility, start, end) |

### Operational data (every table: `tenant_id NOT NULL`, `facility_id`, composite FKs, RLS)

`source`, `upload`, `mapping`, `activity_record`, `inventory_movement`, `lab_result`, `factor_override`,
`calculation_job`, `calculation_run`, `qa_issue`, `evidence`, `evidence_link`, `report`, `approval`,
`ai_assessment`, `mitigation_scenario`, `audit_log`.

- Child → parent references always include tenant and facility, e.g.
  `FOREIGN KEY (tenant_id, facility_id, run_id) REFERENCES calculation_run (tenant_id, facility_id, id)`.
  A record therefore cannot point at another tenant's (or another factory's) facility, period, evidence or run —
  even when written by the database owner (T12).
- Inter-factory transfers (`inventory_movement.counterparty_facility_id`) must reference a facility of the same tenant.
- Ownership columns cannot be changed after insert (`app.protect_ownership` trigger).
- Append-only: `calculation_run`, `approval`, `audit_log`, `factor_override`, `ai_assessment` (trigger).
- Approved `report` rows cannot be updated or deleted by anyone, including the owner (trigger), and
  `approved_by ≠ submitted_by` is a CHECK constraint.
- Upload dedup is unique per (tenant, facility, period, sha256) — never global.
- `ai_assessment.advisory` has `CHECK (advisory)`.

### Shared reference vs tenant overrides

`ref.factor_catalog(code, version, value, unit, source_document, effective_from)` — shared, `SELECT` only for
`trace_app`. Tenants record versioned, append-only `factor_override` rows referencing a catalogue version; they
cannot modify the catalogue or another tenant's overrides (T17).

### Row-level security

- Role `trace_app`: `NOSUPERUSER NOBYPASSRLS`, tables `FORCE ROW LEVEL SECURITY`.
- Every request transaction: `SET LOCAL ROLE trace_app; set_config('app.user_id', …, true); set_config('app.tenant_id', …, true)`.
- Facility-scoped tables: SELECT uses `app.can_access_facility(tenant_id, facility_id)`; INSERT/UPDATE/DELETE use
  `app.can_write_facility(...)` (excludes read-only support grants). Both require the row tenant to equal the
  transaction tenant **and** an active membership + active role assignment covering the facility. Setting the
  tenant context to a foreign tenant therefore still yields zero rows (T01).
- Helper functions are `SECURITY DEFINER` with a fixed `search_path`.

## 3. Permission matrix

Source of truth: `lib/tenancy/permissions.ts`. ✔ = granted at the facilities in the assignment's scope.

| Permission | Tenant admin | Facility manager | Prod. contrib. | Util. contrib. | Lab contrib. | MRV analyst | Reviewer | Approver | Auditor / verifier | Support grant |
|---|---|---|---|---|---|---|---|---|---|---|
| facility.read | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| period.manage | ✔ | ✔ | | | | | | | | |
| upload.create | | ✔ | ✔ | ✔ | ✔ | | | | | |
| activity.write.production | | ✔ | ✔ | | | | | | | |
| activity.write.utilities | | ✔ | | ✔ | | | | | | |
| activity.write.laboratory | | ✔ | | | ✔ | | | | | |
| mapping.manage | | ✔ | | | | ✔ | | | | |
| factor_override.manage | | | | | | ✔ | | | | |
| calculation.run | | ✔ | | | | ✔ | | | | |
| qa.manage | | | | | | ✔ | ✔ | | | |
| evidence.read | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| evidence.write | | ✔ | ✔ | ✔ | ✔ | ✔ | | | | |
| report.read | ✔ | ✔ | | | | ✔ | ✔ | ✔ | ✔ | ✔ |
| report.export | | ✔ | | | | ✔ | ✔ | ✔ | ✔ | |
| report.submit | | ✔ | | | | ✔ | | | | |
| report.review | | | | | | | ✔ | | | |
| **report.approve** | | | | | | | | **✔** | | |
| ai.assess | | ✔ | | | | ✔ | ✔ | | | |
| scenario.manage | | ✔ | | | | ✔ | | | | |
| audit.read (tenant-wide only) | ✔ | | | | | | | | ✔ | |
| members.manage (tenant-wide only) | ✔ | | | | | | | | | |

Rules: membership without assignments → no access (404). `tenant_admin` is tenant-wide only. Platform admin has no
tenant permissions; only an explicit support grant gives the read-only column above, audited per request.
Segregation of duties: submitter cannot approve (service + DB CHECK).

## 4. Data paths

| Path | Control |
|---|---|
| API | Single dispatcher `lib/server/api/router.ts` behind `app/api/v1/[...path]/route.ts`; session resolved on **every** request; cross-origin state changes rejected; unknown body keys rejected (no smuggled `tenant_id`). |
| Object storage / signed URLs | Keys built server-side from authorised scope; HMAC tokens (5 min) bound to kind, tenant, facility, object and user; download re-authorises. |
| Report exports / evidence previews | Same `withTenant` + facility permission checks. |
| Background jobs / retries | Job rows carry tenant/facility; claim via `app.claim_next_job()`; execution under requester's current access; revoked → failed, no run. |
| Search / AI retrieval | SQL search under RLS within route scope; tool args limited to `{query, limit}`; results persisted with evidence IDs (same-tenant check in T09). |
| Cache keys / browser drafts | `lib/tenancy/scopeKeys.ts`: keys include user, tenant, facility, period. Unscoped legacy drafts only in signed-out local workspace. |
| Late responses | `createScopeGuard` + `AbortController` in `context/ScopeContext.tsx`; switching clears the loaded dataset. |
| Audit logs | Tenant rows readable only by tenant admins/auditors of that tenant; denied probes are logged with `tenant_id NULL` (not disclosed to the probed tenant). |

## 5. UI (minimal, existing design system)

- Scope bar on every page (`components/layout/ScopeBar.tsx`): organisation selector when >1 membership, factory
  selector listing only server-authorised factories, period selector, signed-in user, SYNTHETIC ORG badge.
- `/signin` — development-only synthetic identities. `/admin/access` — members, role grants/revocations per
  factory or tenant-wide. `/portfolio` — per-factory results with reporting boundaries + consolidated intensities.

## 6. Executed isolation tests — actual results

Fixtures (SYNTHETIC): Tenant A "Synthetic Cement Group A" with A1 (integrated kiln plant) and A2 (grinding
station); Tenant B with B1. Twelve synthetic users incl. A1-only manager, A2-only production contributor,
member-without-roles, multi-org consultant (A2 manager + B auditor) and a platform admin.

Execution: fresh in-process PostgreSQL (PGlite) with the real migration + RLS, calling the **same dispatcher**
the Next.js route uses (raw `Request` objects, no UI). Run via the development harness `GET /api/dev/isolation`
(same case module as `tests/isolation.test.ts`).

**Run 2026-10-19T11:16:35Z: 18/18 cases passed, 130/130 checks, 1.5 s.** (An earlier run at 11:09:57Z also
passed 18/18; the second run followed a change preventing admins revoking their own admin role.)
`npm test` (Vitest) was **not** executed in this environment (no shell); the same cases are wired into it.

| Case | Requirement | Checks |
|---|---|---|
| T01 | App role cannot bypass RLS; context transaction-local; forced foreign tenant context sees 0 rows | 6/6 |
| T02 | Tenant A cannot list/read/edit/export Tenant B records (API + direct SQL) | 10/10 |
| T03 | Guessed IDs, smuggled body `tenant_id`, foreign period, query-string tampering, malformed IDs | 7/7 |
| T04 | A1-only user cannot access A2 (API + RLS); contributor domain limits | 7/7 |
| T05 | Direct API: no session/forged session → 401, cross-origin → 403, membership-only → 404 | 5/5 |
| T06 | Evidence URLs: other tenant/user → 403, tampered/expired → 403, signed-but-unauthorised → 404, key namespacing | 10/10 |
| T07 | Report export scope | 5/5 |
| T08 | Jobs keep ownership; cross-tenant run FK rejected; per-tenant idempotency; revoked requester → job fails | 7/7 |
| T09 | AI retrieval: only own-tenant docs; model-supplied scope rejected; B control query finds B doc | 10/10 |
| T10 | Draft/cache keys differ per user/org/factory/period; late responses discarded | 3/3 |
| T11 | Revoked membership → 404 on next request (incl. previously issued download URL); revoked session → 401 | 8/8 |
| T12 | Cross-tenant FK associations rejected even as DB owner (9 variants) + via admin API | 10/10 |
| T13 | Identical uploads in two tenants: independent IDs, dedup within tenant only, no cross-listing | 4/4 |
| T14 | Approved reports immutable (app role and owner), append-only approvals, approver-only, SoD | 13/13 |
| T15 | Platform admin: no routine access; explicit grant read-only, RLS blocks writes, audited, not other tenants | 8/8 |
| T16 | Audit logs tenant-isolated | 4/4 |
| T17 | Catalogue read-only; overrides isolated and append-only | 5/5 |
| T18 | Portfolio: authorised factories only; 0.54 tCO2/t clinker and 54,000/175,000 tCO2/t cement (5,000 t internal transfer removed) ≠ naive average 0.231; withheld on mismatched interval/missing data | 8/8 |

Browser check (development, Chromium via Playwright): signed in as the multi-org consultant, the scope bar listed
both organisations and only factory A2 in Tenant A; a draft saved under A2 was **not** shown after switching to
Tenant B (blank form, no draft prompt) and reappeared after switching back. Portfolio and access pages rendered
for the Tenant A admin with no console errors. Production build passed.

## 7. Migration plan

1. Select the database provider and identity provider together with the deployment target (AD-23).
2. **Inspect** the target database read-only (existing schemas, roles, data). Do not reset.
3. Create a login role that is a member of `trace_app`, is **not** superuser/owner and has no `BYPASSRLS`;
   run migrations with a separate owner role (`schema_migrations` makes reruns no-ops).
4. Implement the `Database` adapter for the chosen driver (interface: `lib/server/db/types.ts`), set
   `DOWNLOAD_SIGNING_SECRET` (≥32 chars) and a private bucket adapter (`lib/server/storage.ts`).
5. Re-run the isolation suite against a disposable branch of the target database before any real data.
6. Only then migrate workbook import / manual entry to persist through these services.

## 8. Remaining limitations (honest list)

- **No production identity provider**; production tenant APIs return 503 by design; sign-in is dev-only.
- **No production DB/storage adapters**; development data is in-memory and resets on server restart.
- The authoritative MRV engine (`lib/calcEngine.ts`) still runs client-side; workbook import and data entry are not
  yet persisted per tenant. The job/portfolio totals use a foundation aggregation of synthetic activity rows.
- No services yet for `source`, `mapping`, `lab_result`, `qa_issue`, `mitigation_scenario`, `evidence_link`
  creation, or factor-override management (schema, FKs and RLS exist and are tested at the DB layer).
- No LLM integrated; only the scoped retrieval tool exists. No external search index.
- Support grants have no UI yet (service + test only). Invitations of not-yet-existing users require the IdP.
- Tests are developer-run; no mutation testing of the suite, no load/concurrency testing of RLS functions, no
  independent security review.
- `/api/dev/isolation` and `/dev/acceptance` are compiled into production builds but return 404 there.
