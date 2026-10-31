# 13 — Evidence documents: migrations, application & rollback

Scope: the evidence-document persistence layer (Directive 06 §3 — private evidence files).
Environment: development/test project `vbxvhbnhstdfbkgjuzgs` (owner-designated, no live customer data).
Rules that apply to every statement here: `db/supabase/*.sql` is applied **additively only**, statement by
statement, via the SQL tool; nothing is reset, dropped or overwritten; every batch is inspected before it
is applied; never applied to production without review.

## What exists today

| Migration | State | Contents |
|---|---|---|
| `0006_evidence_documents.sql` | **Applied** (dev) | `evidence_document` table (append-only, one mutable transition: retire-and-supersede), `evidence_document_supersede_only` trigger, trusted-executor RPC `mrv_store_evidence_document`, grants + RLS, service API path `…/evidence-documents`. Storage layout: `mrv-private/<tenant>/<facility>/evidence/<documentId>/<filename>`. |
| `0007_evidence_replacement_order.sql` | **Written, NOT applied** | Replaces `mrv_store_evidence_document` (fixes the replacement FK ordering bug) and adds the orphan-cleanup Storage delete policy. |

## Why 0007 is needed (CONFIRMED, reproduced by the hosted suite)

1. **Replacement FK ordering bug.** The 0006 RPC retired the previous document
   (`update … superseded_by = <new id>`) *before* inserting the new row. `evidence_document_superseded_by_fkey`
   is not deferrable, so every replacement failed with `Request violates a data constraint`. First (non-replacing)
   uploads were never affected. 0007 inserts the new row first and retires the old one in the same transaction —
   still atomic, nothing else changes.
2. **Orphaned files on failed metadata writes.** `mrv-private` intentionally has no delete policy (uploads are
   immutable through the API — 0002). Evidence uploads are the one flow that stores the file *before* the
   trusted-executor metadata write, so a rejected write left an orphaned private file. 0007 adds
   `mrv_private_delete_evidence`: deletion is allowed **only** for `evidence/…` paths of that facility, by a
   member with `upload.create`, **and only when no `evidence_document` row references the path** (checked via the
   SECURITY DEFINER helper `mrv_private.evidence_file_registered`, so row visibility cannot hide a registered
   file). Stored documents stay immutable; orphans can always be removed.

Hosted-suite checks blocked until 0007 is applied: "replacement keeps history…", "replacing an
already-replaced document is refused", "failed uploads leave no orphaned file…". Everything else passes
(last full run 81/84, see doc 12 §6 conventions).

## Applying 0007 (when authorised)

1. Inspect `db/supabase/0007_evidence_replacement_order.sql`. It contains exactly two objects:
   `create or replace function public.mrv_store_evidence_document` and the delete policy + helper
   `create or replace function mrv_private.evidence_file_registered`. No table, trigger, policy, grant or
   data row is created, dropped or modified.
2. Apply statement by statement (the two `create or replace` statements, the two `revoke`, the two `grant`,
   then `create policy mrv_private_delete_evidence`).
3. Post-apply verification:
   - `select prosrc like '%insert into public.evidence_document%' and prosrc like '%update public.evidence_document%';`
     on the RPC confirms insert-before-retire order.
   - Re-run `GET /api/dev/hosted-e2e` (development only): the two replacement checks must pass.
   - `select count(*) from pg_policies where tablename = 'objects' and policyname = 'mrv_private_delete_evidence';` → 1.
4. **One-time cleanup** of the orphaned files left by the pre-0007 failed replacement attempts
   (~4 objects under `<tenant>/<facility>/evidence/…`, created by hosted-suite runs). Orphaned paths have no
   `evidence_document` row; with the policy in place any facility member with `upload.create` can remove them
   through the API, or they can be deleted in the Supabase console by the owner. Do **not** delete any object
   whose path appears in `public.evidence_document.storage_path`.
5. Re-run the hosted suite; the orphan check passes once every folder matches a stored document.

## Rollback procedures (additive-only philosophy)

Rollback is a **last resort** and only ever on a reviewed, explicitly authorised batch. Because the project
never resets or overwrites data, a rollback of an applied migration is itself written as a new additive
SQL batch (e.g. `0008_…`) and applied the same way — never as ad-hoc destructive edits.

### Rolling back 0007 (restore the 0006 function / remove the delete policy)

Safe at any time — 0007 changes no data:

```sql
drop policy if exists mrv_private_delete_evidence on storage.objects;
drop function if exists mrv_private.evidence_file_registered(text);
create or replace function public.mrv_store_evidence_document(...)  -- restore the exact 0006 body
```

Effects: replacements fail again with `Request violates a data constraint`, failed-upload cleanup can no
longer remove orphaned files. No row is lost.

### Rolling back 0006 (remove the evidence-document feature)

Only after exporting the evidence rows if any are worth keeping (feature is dev-only so far — the synthetic
hosted fixtures are disposable). Order matters: policies → grants → trigger → function → table → storage objects.

```sql
-- 1. RLS policies on evidence_document (select them first: pg_policies where tablename = 'evidence_document')
drop policy ... on public.evidence_document;                    -- one statement per policy, by name
-- 2. Trigger + trigger function from 0006
drop trigger if exists evidence_document_supersede_only on public.evidence_document;
drop function if exists public.mrv_evidence_document_supersede_only();
-- 3. Trusted-executor RPC
drop function if exists public.mrv_store_evidence_document(uuid, uuid, text, jsonb);
-- 4. Table (drops the dependent FKs; cascade is safe here because it is the leaf table)
drop table if exists public.evidence_document;
-- 5. Bucket objects: delete ONLY paths not present in source_file, e.g. .../evidence/... of the dev fixtures
--    (owner action in the Supabase console, or per-object via the API while 0007's policy exists).
```

Application code to revert together with the batch: `app/evidence/EvidenceDocuments.tsx`,
`app/evidence/page.tsx`, the `evidence-documents` API routes, `lib/mrv/evidenceFiles.ts`,
`lib/server/mrv/service.ts` (upload/list/url functions), and the hosted-suite checks — remove or guard them
so no route references the dropped table. The register itself (evidence references as configuration
documents) is **not** part of 0006 and keeps working; only uploaded files and their metadata disappear.

## Test & verification record

- CONFIRMED (hosted suite, real Supabase, 2026-11-01): register persistence end-to-end — reference saved via
  the real UI survives reload (2 references, `UI-REG-VERIFY-01`), document uploaded through the API
  (`ui-verify-upload.csv`) survives reload, cross-tenant isolation: org B sees 0 of org A's references or files.
- CONFIRMED: pure self-tests 41/41, PGlite DB/isolation harness 59/59, production build green, hosted suite
  81/84 (3 failures all blocked on 0007, labelled as such).
- PARTIALLY VERIFIED: 0007's SQL is type-checked and reviewed but not executed against the live database;
  application + post-apply verification is pending authorisation.
