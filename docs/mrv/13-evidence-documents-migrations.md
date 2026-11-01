# 13 — Evidence documents: migrations, application & rollback

Scope: the evidence-document persistence layer (Directive 06 §3 — private evidence files).
Environment: development/test project `vbxvhbnhstdfbkgjuzgs` (owner-designated, test-classified via
`MRV_SUPABASE_ENVIRONMENT=test` + `MRV_STAGING_PROJECT_REF` match; 4 synthetic users, 2 synthetic tenants, no live
customer data).
Rules that apply to every statement here: `db/supabase/*.sql` is applied **additively only**, statement by
statement, via the SQL tool; nothing is reset, dropped or overwritten; every batch is inspected before it
is applied; never applied to production without review.

## What exists today

| Migration | State | Contents |
|---|---|---|
| `0006_evidence_documents.sql` | **Applied** (dev) | `evidence_document` table (append-only, one mutable transition: retire-and-supersede), `evidence_document_supersede_only` trigger, trusted-executor RPC `mrv_store_evidence_document`, grants + RLS, service API path `…/evidence-documents`. Storage layout: `mrv-private/<tenant>/<facility>/evidence/<documentId>/<filename>`. |
| `0007_evidence_replacement_order.sql` | **Written, reviewed and executed in an isolated local PostgreSQL; NOT applied to the remote database** | Replaces `mrv_store_evidence_document` (fixes the replacement FK ordering bug), pins the uploaded file inside the RPC (FOR SHARE row lock + owner check), adds the owner-scoped Storage delete policy `mrv_private_delete_evidence` + lock-then-check helper `mrv_private.evidence_file_deletable(bucket, name)`, adds the `mrv_schema_version()` marker (returns 7). |

## Why 0007 is needed (CONFIRMED, reproduced on real PostgreSQL)

1. **Replacement FK ordering bug.** The 0006 RPC retires the previous document
   (`update … superseded_by = <new id>`) *before* inserting the new row. `evidence_document_superseded_by_fkey`
   is not deferrable, so every replacement fails with `Request violates a data constraint` (SQLSTATE 23503 —
   reproduced by the local harness). First (non-replacing) uploads are not affected. 0007 inserts the new row
   first and retires the old one in the same transaction — still atomic, nothing else changes.
2. **Orphaned files on failed metadata writes.** `mrv-private` intentionally has no delete policy (uploads are
   immutable through the API — 0002). Evidence uploads are the one flow that stores the file *before* the
   trusted-executor metadata write, so a rejected write leaves an orphaned private file that the application
   must be able to remove again. 0007 adds the narrowly-scoped delete policy (below).

Hosted-suite checks affected: "replacement keeps history…", "replacing an already-replaced document is refused"
(now auto-skipped while `mrv_schema_version() < 7`, so running the suite before 0007 no longer leaks orphaned
files) and "failed uploads leave no orphaned file…".

## 0007's Storage delete policy (reviewed against the live schema)

Every condition below is required at once, on `storage.objects` for `authenticated`:

- `bucket_id = 'mrv-private'` and the path's third folder is `evidence` (`storage.foldername(name))[3]`) —
  non-evidence private files (imports) are never deletable by the app role;
- `owner = auth.uid()` — **only the file's own uploader** can delete it (live data confirms `storage.objects.owner`
  is the uploading user's id). Another member's pending upload — even an authorized colleague's — is protected;
- `mrv_auth.has_permission(tenant, facility, 'upload.create')` — scoped to the caller's own facility;
- `mrv_private.evidence_file_deletable(bucket_id, name)` — locks the object row, then refuses if any
  `evidence_document.storage_path` references it (see the race section).

### Privilege model (corrected)

The previous text said policy expressions evaluate "with the table owner's privileges". **That was wrong.** Two
separate mechanisms are involved:

| Mechanism | Runs with | Consequence here |
|---|---|---|
| RLS policy expression | the **querying** role (`authenticated`, with the caller's JWT claims; `auth.uid()` is the caller) | every function the expression calls needs EXECUTE for `authenticated` |
| `SECURITY DEFINER` function body | the function's **owner** (`postgres` on the live project: non-superuser, `rolbypassrls = true` — verified read-only) | the helper's metadata lookup and row lock are not limited by the caller's RLS visibility or table grants |
| Schema USAGE | checked when a name is **resolved**; the policy is parsed once by the migration owner and stored by OID | `authenticated` needs no USAGE on `mrv_private` for the policy to work, and without it cannot call the helper by name |

Grants are minimal: the helper has EXECUTE for `authenticated` only (plus its owner); PUBLIC, `anon` and
`service_role` are revoked (`service_role` bypasses RLS and never evaluates the policy). `authenticated` keeps
**no** USAGE on `mrv_private` (live, read-only: `has_schema_privilege('authenticated','mrv_private','USAGE') = false`;
0007 does not change it). Verified on real PostgreSQL 17.5 (concurrency suite, below): direct call by name →
`42501 permission denied for schema mrv_private`; revoking EXECUTE from `authenticated` (inside a rolled-back
transaction) makes the policy-guarded DELETE fail with `42501 permission denied for function
evidence_file_deletable` — proof that the expression runs as the querying user; the helper's `FOR UPDATE` succeeds
although `authenticated` has no UPDATE on `storage.objects` in the stand-in — proof the body runs as the owner.

### Upload-registration vs. deletion race (proven, then fixed)

Complete flow (`lib/server/mrv/service.ts uploadEvidenceDocument`): validate → Storage upload (caller's JWT; INSERT
policy `mrv_private_insert`; Storage sets `owner`/`owner_id`) → trusted-executor RPC `mrv_store_evidence_document`
→ on any RPC error, `storage.remove([path])` (caller's JWT; DELETE policy above). Triggers on the path:
`storage.objects`: `protect_objects_delete` (statement-level; refuses direct SQL deletes unless the Storage API sets
`storage.allow_delete_query`) and `update_objects_updated_at`; `evidence_document`: `evidence_document_supersede_only`
(immutability). None of them lock or check the other side. The RPC as previously written never looked at
`storage.objects`, and the pre-fix helper was a STABLE existence check evaluated with the DELETE statement's
snapshot. Result (reproduced with separate concurrent transactions — below): in **both** interleavings both
transactions committed and metadata referenced a deleted file. The earlier "residual race is self-inflicted and the
RPC reports the missing file" claim was wrong: the RPC reported nothing. The app's own cleanup can trigger it — the
`catch` runs on *any* RPC error, including a lost response after the RPC actually committed.

Fix — one serialization point, the `storage.objects` row:

1. The RPC share-locks the uploaded object row (`FOR SHARE`) before inserting metadata, refusing if it is missing
   (`22023 the uploaded file was not found; nothing was stored`) or owned by someone else (`42501`).
2. The helper takes `FOR UPDATE` on the same row **before** checking metadata. It is VOLATILE PL/pgSQL, so its
   next statement gets a fresh READ COMMITTED snapshot and sees a registration that committed while it waited.
3. Outside READ COMMITTED the helper refuses (fail-closed); the Storage API uses READ COMMITTED.
4. Both Storage delete orders take this row lock before the metadata check — the direct `DELETE … RETURNING` under
   RLS, and the current upstream storage-api order (superuser `FOR UPDATE`, then a caller-role DELETE probe, then the
   delete) — so there is no lock-order inversion. Assumes `mrv-private` versioning stays DISABLED (verified live).

Outcomes: deletion first → the RPC waits, then fails, nothing stored; registration first → the delete waits, then
affects 0 rows, file retained. Concurrent replacements of one document stay serialized by the existing per-facility
advisory lock plus `FOR UPDATE … is_current`.

## Executed validation

### A. Real multi-connection PostgreSQL — concurrency (`tests/mrv/concurrencyHarness.ts`, 19/19)

Throwaway local cluster (embedded-postgres, PostgreSQL 17.5, deleted afterwards), one backend process per
connection; interleavings forced by polling `pg_stat_activity` until the second transaction is actually waiting on
a lock. Database `prefix` = 0001–0006 + frozen pre-fix 0007 (`tests/mrv/fixtures/0007_pre_race_fix.sql`, commit
cc4009c); database `fixed` = 0001–0007 as committed now. Each race case runs for both delete flows (direct / locked).

| Case | pre-fix 0007 | fixed 0007 |
|---|---|---|
| Deletion wins | registration not blocked, commits; metadata 1, file 0 → **dangling** (race reproduced) | registration waits (`Lock/transactionid`), fails "uploaded file was not found"; metadata 0, audit 0, file 0 |
| Registration wins | delete not blocked, deletes 1; metadata 1, file 0 → **dangling** (race reproduced) | delete waits (`Lock/transactionid`), deletes 0; metadata 1, file 1 |
| Two replacements of one document, ordered | — | second waits (`Lock/advisory`), refused "no longer current"; old retired → superseded by the winner, one current |
| Two replacements fired simultaneously | — | exactly one commits, the other refused; exactly one current successor |
| Cleanup after the replacement race | — | loser's orphan deletable by its uploader (1); winner's file not deletable (0) |

Plus: minimal grants (EXECUTE only `authenticated` + owner; no PUBLIC/anon/service_role; no USAGE on
`mrv_private`); direct call refused; revoked EXECUTE breaks the DELETE (querying-user evaluation); definer body
locks without caller UPDATE; REPEATABLE READ delete refused; user B cannot delete A's orphan in either flow.

### B. PGlite (single connection, sequential only — `tests/mrv/dbHarness.ts`, 76/76)

Applies 0001–0006 verbatim, then 0007 verbatim mid-run, under `authenticated` with per-user JWT claims:
0006 replacement refused with 23503 (bug reproduced) and stores nothing; 0007 → version 7, the same replacement
succeeds with history preserved; stale replacement and cross-reference replacement refused; **new:** registration
refuses a missing file and another user's file, storing nothing; row UPDATE/DELETE refused; tenant isolation; the
delete-policy cases (owner-scoped, orphan cleanup, registered file survives, imports untouchable) now go through the
mirrored `protect_delete` trigger with the Storage API flag. PGlite proves SQL semantics, **not** concurrency.

Pure self-test 41/41; TypeScript check green.

### C. Real Supabase Storage API — NOT validated

0007 is not applied remotely, so nothing above exercised the hosted Storage API, PostgREST or the live
`storage.objects`. Both delete flows in A are models of the Storage API's SQL, not the service itself. Live checks
performed were read-only catalogue queries (owners, `rolbypassrls`, schema/table privileges, triggers, policies,
bucket versioning). Hosted validation requires applying 0007 to the designated test database and re-running the
hosted suite (below).

## Applying 0007 to the designated test database (when authorised)

1. Inspect `db/supabase/0007_evidence_replacement_order.sql`: one `create or replace function`
   (`mrv_store_evidence_document`), one helper (`mrv_private.evidence_file_deletable(text, text)`), one marker
   (`public.mrv_schema_version`), one storage policy (`mrv_private_delete_evidence`), plus revoke/grant
   statements. No table, trigger, existing policy or data row is created, dropped or modified.
2. Apply statement by statement via the SQL tool on `vbxvhbnhstdfbkgjuzgs` (test-classified, no live data).
3. Post-apply verification: `select public.mrv_schema_version()` → 7; re-run `GET /api/dev/hosted-e2e` — the
   two replacement checks now execute (the suite auto-detects the migration via the version marker) and must pass.
4. **One-time orphan review** — five pre-0007 leaked files exist under
   `1388c44a-abdf-482f-9093-4bf3c2ef19f6/35128d23-c903-445f-bd23-499a05a1aa79/evidence/…` (all uploaded by the
   synthetic E2E user `c48ade78-…`, all `hosted-evidence-…-v2.pdf` replacement attempts, none referenced by
   `evidence_document.storage_path`):
   `7b2de97f-…/HOSTED-DOC-883710-v2.pdf`, `63cb4392-…/HOSTED-DOC-972119-v2.pdf`, `2880a41b-…/HOSTED-DOC-150064-v2.pdf`,
   `a8d34f4d-…/HOSTED-DOC-446787-v2.pdf`, `c6ad3ad3-…/HOSTED-DOC-992749-v2.pdf`.
   With 0007's policy in place the synthetic uploader (or the owner via the console) can remove them through the
   API; **only** after confirming each path is absent from `public.evidence_document.storage_path`. Do not delete
   anything whose path is referenced by metadata — a folder-count mismatch alone does not prove disposability.
5. Re-run the hosted suite; the orphan check passes once every evidence folder matches a stored document.

## Rollback procedures (additive-only philosophy)

Rollback is a **last resort** and only ever on a reviewed, explicitly authorised batch; it is written as a new
additive SQL batch (e.g. `0008_…`), never as ad-hoc destructive edits.

### Rolling back 0007

Safe at any time — 0007 changes no data:

```sql
drop policy if exists mrv_private_delete_evidence on storage.objects;
drop function if exists mrv_private.evidence_file_deletable(text, text);
drop function if exists public.mrv_schema_version();
create or replace function public.mrv_store_evidence_document(...)  -- restore the exact 0006 body
```

Effects: replacements fail again (23503), failed-upload cleanup cannot remove orphaned files, and the hosted
suite auto-skips the replacement checks (version marker absent). No row is lost.

### Rolling back 0006 (remove the evidence-document feature)

Only after exporting the evidence rows if any are worth keeping (the dev fixtures are disposable). Order matters:
policies → grants → trigger → functions → table → storage objects.

```sql
-- 1. RLS policy on evidence_document (select names first: pg_policies where tablename = 'evidence_document')
drop policy evidence_document_read on public.evidence_document;
-- 2. Trigger + trigger function from 0006
drop trigger if exists evidence_document_supersede_only on public.evidence_document;
drop function if exists mrv_auth.evidence_document_supersede_only();
-- 3. Trusted-executor RPC + 0007 marker/helper if applied
drop function if exists public.mrv_store_evidence_document(uuid, uuid, text, jsonb);
-- 4. Table (leaf table; dependent FKs drop with it)
drop table if exists public.evidence_document;
-- 5. Bucket objects: only the confirmed orphans above, via the console or the API while 0007's policy exists.
```

Application code to revert together with the batch: `app/evidence/EvidenceDocuments.tsx`, `app/evidence/page.tsx`,
the `evidence-documents` API routes, `lib/mrv/evidenceFiles.ts`, `lib/server/mrv/service.ts` (upload/list/url
functions), and the harness/hosted evidence cases. The register itself (evidence references as configuration
documents) is **not** part of 0006 and keeps working; only uploaded files and their metadata disappear.

## Related divergence resolved: package-lock.json

The local lockfile had drifted ~738 lines from origin/main (commit 67c45a56): npm's Linux resolution **removed**
the entire Vite 8 dev/peer chain (`vite`, `rolldown` + 14 platform binaries, `lightningcss` + 11 binaries,
`fsevents`, `@oxc-project/types`) that Vitest 5 pulls in as peers, plus one cosmetic flag swap. `package.json` was
unchanged — no intended dependency changed, only lockfile resolution. Upstream commit 50acdf6 deliberately
restored the complete lockfile "to unblock clean installs", so the upstream version was restored verbatim;
the local working tree now matches origin/main for `package-lock.json`.
