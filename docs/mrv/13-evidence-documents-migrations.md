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
| `0007_evidence_replacement_order.sql` | **Written, reviewed and executed in an isolated local PostgreSQL; NOT applied to the remote database** | Replaces `mrv_store_evidence_document` (fixes the replacement FK ordering bug), adds the owner-scoped Storage delete policy `mrv_private_delete_evidence` + helper `mrv_private.evidence_file_registered`, adds the `mrv_schema_version()` marker (returns 7). |

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
- `not mrv_private.evidence_file_registered(name)` — a path referenced by any `evidence_document.storage_path`
  row (the helper is SECURITY DEFINER, so row visibility can never hide a registered file) is undeletable, even
  by its own uploader.

Residual race, accepted and bounded: the uploader deleting their OWN in-flight file between their own upload and
their own metadata commit can only break their own in-flight RPC (self-inflicted; the RPC reports the missing
file). No cross-user path exists. Policy expressions evaluate with the table owner's privileges (verified: the app
role cannot call `mrv_private.*` directly), so the helper's schema privilege does not affect callers.

## Executed validation (isolated local PostgreSQL / PGlite harness, `tests/mrv/dbHarness.ts`, 75/75)

The migration is **executed**, not just inspected: the harness applies 0001–0006 verbatim, then 0007 verbatim
mid-run, and asserts — under the `authenticated` role with per-user JWT claims, as PostgREST invokes RPCs:

- 0006's replacement is refused with SQLSTATE 23503 (bug reproduced), stores nothing, leaves v1 current;
- 0007 applies and `mrv_schema_version()` = 7; the SAME replacement then succeeds — v1 retired and
  superseded, v2 current, history preserved;
- replacing an already-replaced document is refused ("no longer current") and stores nothing;
- a replacement across a different evidence reference is refused;
- direct authenticated UPDATE/DELETE of document rows is refused (SELECT-only grant + immutability trigger);
- B (other tenant) reads none of A's documents and cannot store one into A's factory;
- storage deletes: A cannot delete C's pending upload; C removes its own pending file; the uploader removes
  its own orphaned file; a metadata-referenced file survives even its own uploader's DELETE (RLS filters —
  never raises — so every case is asserted via the object's survival); non-evidence (imports) files survive.

Pure self-test 41/41 and the full TypeScript check are green. Production build green, and the repository's
`scripts/check-prod-bundle.mjs` executed against a real `next build --webpack` of the current source:
**PASS — 354 build files scanned, none of 9 development markers present.**

Not yet verified: the hosted Supabase stack (PostgREST/Storage API behaviour) with 0007 applied — that requires
applying 0007 to the designated test database (below) and re-running the hosted suite.

## Applying 0007 to the designated test database (when authorised)

1. Inspect `db/supabase/0007_evidence_replacement_order.sql`: one `create or replace function`
   (`mrv_store_evidence_document`), one helper (`mrv_private.evidence_file_registered`), one marker
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
drop function if exists mrv_private.evidence_file_registered(text);
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
