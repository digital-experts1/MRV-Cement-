/**
 * Directive 06 database acceptance cases — executed against REAL PostgreSQL (PGlite) with the actual migrations
 * db/supabase/0001–0003 and a minimal stand-in for Supabase's auth/storage schemas and API roles. Requests run as the
 * `authenticated` role with a per-user `request.jwt.claim.sub`, exactly how PostgREST invokes RPCs for a signed-in user.
 *
 * What this proves: the SQL (RLS, grants, executor signature verification, independent input checks, revision history,
 * invalidation, report impacts) behaves as specified. What it does NOT prove: the hosted Supabase Auth/PostgREST/Storage
 * stack — that signed-in vertical slice requires an explicitly designated test project (see docs/mrv/12-directive-06-evidence.md).
 *
 * Shared by Vitest (tests/mrvDb.test.ts) and the development-only route GET /api/dev/mrv-db-selftest. SYNTHETIC data only.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createSampleDataset } from "@/lib/sampleData";
import { resolveRange, type RangeSpec } from "@/lib/mrv/dateRanges";
import { MAPPING_VERSION, type ImportMapping } from "@/lib/mrv/importMapping";
import { toConfigDrafts, toReadingDrafts, type StoredReading } from "@/lib/mrv/readings";
import { effectivePeriod, importBody, planRun, type ConfigDoc, type ImportBatchMeta } from "@/lib/mrv/executorPayload";
import { signExecutorRequest, type ExecutorKey, type ExecutorPurpose } from "@/lib/mrv/executorSign";
import type { MrvInput } from "@/lib/types";

export interface DbCheck {
  label: string;
  pass: boolean;
  detail?: string;
}

const SHIM = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;
`;

const MONTHLY: ImportMapping = { version: MAPPING_VERSION, interval: "calendar_month_of_date" };
const NOW = new Date("2026-10-19T10:00:00Z");
const USERS = {
  A: "aaaaaaaa-0000-4000-8000-000000000001",
  B: "bbbbbbbb-0000-4000-8000-000000000002",
  C: "cccccccc-0000-4000-8000-000000000003",
};

const pgArray = (ids: string[]) => `{${ids.join(",")}}`;

function sqlFile(name: string) {
  return readFileSync(join(process.cwd(), "db", "supabase", name), "utf8");
}

export async function runDbCases(): Promise<{ passed: number; total: number; checks: DbCheck[] }> {
  const checks: DbCheck[] = [];
  const check = (label: string, pass: boolean, detail?: unknown) =>
    checks.push({ label, pass, detail: detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail) });

  const pg = new PGlite();
  await pg.waitReady;
  try {
    await pg.exec(SHIM);
    for (const f of ["0001_mrv_persistence.sql", "0002_mrv_rpc_storage.sql", "0003_mrv_trusted_execution.sql"]) await pg.exec(sqlFile(f));
    check("migrations 0001–0003 apply on PostgreSQL", true);
    for (const [k, id] of Object.entries(USERS)) await pg.query("insert into auth.users (id, email) values ($1, $2)", [id, `${k.toLowerCase()}@synthetic.test`]);
    const keyRow = (await pg.query<{ key_id: string; hex: string }>("select key_id, encode(secret, 'hex') as hex from mrv_private.executor_key where active")).rows[0];
    const KEY: ExecutorKey = { keyId: keyRow.key_id, secret: Buffer.from(keyRow.hex, "hex") };
    check("executor key provisioned by the migration (server copies it into its environment)", !!keyRow && keyRow.hex.length >= 60);

    // ── helpers ──
    const as = async (uid: string | null) => {
      await pg.exec("reset role");
      await pg.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
      await pg.exec("set role authenticated");
    };
    const su = () => pg.exec("reset role");
    const one = async <T,>(q: string, p: unknown[] = []) => (await pg.query<T>(q, p)).rows[0];
    const err = async (fn: () => Promise<unknown>): Promise<string | null> => {
      try {
        await fn();
        return null;
      } catch (e) {
        const x = e as { code?: string; message?: string };
        return `${x.code ?? "?"}: ${x.message ?? String(e)}`;
      }
    };
    const rpc = async <T,>(uid: string, fn: string, purpose: ExecutorPurpose, t: string, f: string, body: string, key: ExecutorKey = KEY): Promise<T> => {
      await as(uid);
      const auth = signExecutorRequest(key, purpose, { userId: uid, tenantId: t, facilityId: f }, body);
      const r = await pg.query<{ r: T }>(`select public.${fn}($1, $2, $3, $4::jsonb) as r`, [t, f, body, JSON.stringify(auth)]);
      return r.rows[0].r;
    };
    const runCount = async () => {
      await su();
      return Number((await one<{ n: number }>("select count(*)::int as n from public.calculation_run")).n);
    };
    const range = (spec: RangeSpec) => resolveRange(spec, { timezone: "UTC", now: NOW });

    const importInput = async (uid: string, t: string, f: string, input: MrvInput, opts: { status?: "accepted" | "rejected"; errors?: string[] } = {}) => {
      const drafts = toReadingDrafts(input, MONTHLY, "workbook:synthetic.xlsx");
      if (drafts.errors.length) throw new Error(drafts.errors.join("; "));
      const declared = { start: String(input.setup["Period start"]), end: String(input.setup["Period end"]) };
      const eff = effectivePeriod(declared, drafts.readings)!;
      const rejected = opts.status === "rejected";
      const batch: ImportBatchMeta = {
        id: crypto.randomUUID(), origin: "workbook", status: rejected ? "rejected" : "accepted", filename: "synthetic.xlsx", sha256: null,
        size_bytes: null, mime: null, storage_path: null, errors: opts.errors ?? [], assertions: [], declared_period_start: declared.start,
        declared_period_end: declared.end, synthetic: true, mapping: MONTHLY, effective_from: rejected ? null : eff.from,
        effective_to: rejected ? null : eff.to, effective_basis: rejected ? null : eff.basis,
      };
      const body = importBody(batch, rejected ? [] : drafts.readings, rejected ? [] : toConfigDrafts(input));
      return rpc<{ status: string; inserted: number; revised: number; unchanged: number }>(uid, "mrv_import_v2", "import", t, f, body);
    };

    const loadPlan = async (uid: string, t: string, f: string, spec: RangeSpec) => {
      await as(uid);
      const rg = range(spec);
      const readings = (
        await pg.query<StoredReading & { synthetic: boolean }>(
          `select id, section, series_key, record_key, observed_on::text, interval_start::text, interval_end::text, granularity, measurement_type,
             mapping_version, quality_state, payload, synthetic, revision
           from public.activity_reading where tenant_id = $1 and facility_id = $2 and is_current and interval_start <= $4 and interval_end >= $3`,
          [t, f, rg.start, rg.end]
        )
      ).rows;
      const docs = (
        await pg.query<ConfigDoc>(
          "select id, kind, content, effective_from::text, effective_to::text, to_char(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS.US') as created_at from public.config_document where tenant_id = $1 and facility_id = $2",
          [t, f]
        )
      ).rows;
      return planRun({ readings, docs, range: rg, facility: { code: "SYN", synthetic: true } });
    };
    const calculate = async (uid: string, t: string, f: string, spec: RangeSpec) => {
      const plan = await loadPlan(uid, t, f, spec);
      if (plan.kind !== "run") throw new Error(plan.note);
      return { plan, id: await rpc<string>(uid, "mrv_finalize_run", "run", t, f, plan.body) };
    };

    // ── 1. Two identities, two organizations, multiple factories ──
    await as(USERS.A);
    const tA = (await one<{ id: string }>("select public.mrv_create_organization('Synthetic Org A', 'A1', 'Synthetic Factory A1', 'UTC', true) as id")).id;
    const fA1 = (await one<{ id: string }>("select id from public.facility where tenant_id = $1 and code = 'A1'", [tA])).id;
    const fA2 = (await one<{ id: string }>("select public.mrv_add_facility($1, 'A2', 'Synthetic Factory A2', 'UTC') as id", [tA])).id;
    await as(USERS.B);
    const tB = (await one<{ id: string }>("select public.mrv_create_organization('Synthetic Org B', 'B1', 'Synthetic Factory B1', 'UTC', true) as id")).id;
    const fB1 = (await one<{ id: string }>("select id from public.facility where tenant_id = $1", [tB])).id;
    check("two users create two organizations and three factories", !!(tA && fA1 && fA2 && tB && fB1));

    // ── 2. Import Q1 (synthetic) through the trusted executor; identical re-import does not double count ──
    const imp = await importInput(USERS.A, tA, fA1, createSampleDataset());
    check("signed import accepted", imp.status === "accepted" && imp.inserted > 0, imp);
    const again = await importInput(USERS.A, tA, fA1, createSampleDataset());
    check("identical re-import: 0 inserted, all unchanged (no double counting)", again.inserted === 0 && again.revised === 0 && again.unchanged === imp.inserted, again);
    await su();
    const current = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where facility_id = $1 and is_current", [fA1])).n);
    check("current readings equal the source rows", current === imp.inserted, { current });

    // ── 3. Normal server-calculated runs: January, Q1, custom ──
    const jan = await calculate(USERS.A, tA, fA1, { preset: "month", year: 2025, month: 1 });
    const q1 = await calculate(USERS.A, tA, fA1, { preset: "quarter", year: 2025, quarter: 1 });
    const custom = await calculate(USERS.A, tA, fA1, { preset: "custom", start: "2025-01-01", end: "2025-02-28" });
    check("January, Q1 and custom runs finalized by the trusted executor", !!(jan.id && q1.id && custom.id));
    await su();
    const q1Row = await one<{ qa: string; n: number; key: string; inputs: number }>(
      "select qa_overall as qa, (select count(*)::int from public.run_qa_result where run_id = r.id) as n, executor_key_id as key, (select count(*)::int from public.calculation_run_input where run_id = r.id) as inputs from public.calculation_run r where id = $1",
      [q1.id]
    );
    const q1Results = JSON.parse(q1.plan.body).results;
    check("QA rows and overall status are derived from the engine results inside the database", q1Row.n === q1Results.qaqc.length && q1Row.qa === q1Results.calcRows.find((x: { Metric: string }) => x.Metric === "QA/QC Overall Status").Value, q1Row);
    check("run pins its exact reading revisions", q1Row.inputs === JSON.parse(q1.plan.body).reading_ids.length, q1Row);

    // ── 4. Direct-RPC tampering with a real user's identity (A is an authorized calculator) ──
    const before = await runCount();
    await as(USERS.A);
    const fake = {
      kind: "formal", range_start: "2025-01-01", range_end: "2025-03-31", range_label: "Q1", timezone: "UTC", engine_version: "x", methodology_version: "x",
      input_snapshot: {}, input_sha256: "0".repeat(64), results: { calcRows: [{ Metric: "Total Embedded CO2", Value: 1 }] }, results_fingerprint: "0".repeat(64),
      qa_overall: "PASS", completeness_pct: 100,
    };
    const readingIds = pgArray(JSON.parse(q1.plan.body).reading_ids);
    const e1 = await err(() => pg.query("select public.mrv_record_run($1, $2, $3::jsonb, $4::uuid[], '{}'::uuid[], '[{\"check_id\":\"X\",\"status\":\"PASS\"}]'::jsonb)", [tA, fA1, JSON.stringify(fake), readingIds]));
    check("retired mrv_record_run: direct call with invented emissions + QA PASS is refused", !!e1 && e1.startsWith("42501"), e1);
    const e2 = await err(() => pg.query("select public.mrv_finalize_run($1, $2, $3, null)", [tA, fA1, q1.plan.body]));
    check("mrv_finalize_run without executor authorization is refused", !!e2 && e2.startsWith("42501"), e2);
    const tampered = JSON.parse(q1.plan.body);
    tampered.results.calcRows.find((x: { Metric: string }) => x.Metric === "Total Embedded CO2").Value = 1;
    tampered.results.calcRows.find((x: { Metric: string }) => x.Metric === "QA/QC Overall Status").Value = "PASS";
    tampered.run.results_fingerprint = "0".repeat(64);
    const authFor = (body: string, key = KEY, uid = USERS.A) => JSON.stringify(signExecutorRequest(key, "run", { userId: uid, tenantId: tA, facilityId: fA1 }, body));
    const goodAuth = authFor(q1.plan.body);
    const e3 = await err(() => pg.query("select public.mrv_finalize_run($1, $2, $3, $4::jsonb)", [tA, fA1, JSON.stringify(tampered), goodAuth]));
    check("altered emissions / fake QA PASS with a signature for the original body are refused", !!e3 && /signature/.test(e3), e3);
    const forgedKey: ExecutorKey = { keyId: KEY.keyId, secret: Buffer.alloc(32, 7) };
    const e4 = await err(() => pg.query("select public.mrv_finalize_run($1, $2, $3, $4::jsonb)", [tA, fA1, JSON.stringify(tampered), authFor(JSON.stringify(tampered), forgedKey)]));
    check("self-signed (forged key) tampered run is refused", !!e4 && /signature/.test(e4), e4);
    const inconsistent = JSON.parse(q1.plan.body);
    inconsistent.input_snapshot.production[0]["Clinker Produced t"] = 1;
    const incBody = JSON.stringify(inconsistent);
    const e5 = await err(() => pg.query("select public.mrv_finalize_run($1, $2, $3, $4::jsonb)", [tA, fA1, incBody, authFor(incBody)]));
    check("even with a valid executor signature, inputs inconsistent with the pinned readings are refused", !!e5 && e5.startsWith("22023"), e5);
    const replayPlan = await loadPlan(USERS.A, tA, fA1, { preset: "quarter", year: 2025, quarter: 1 });
    const replayAuth = replayPlan.kind === "run" ? authFor(replayPlan.body) : "{}";
    if (replayPlan.kind === "run") {
      await as(USERS.A);
      await pg.query("select public.mrv_finalize_run($1, $2, $3, $4::jsonb)", [tA, fA1, replayPlan.body, replayAuth]);
      const e6 = await err(() => pg.query("select public.mrv_finalize_run($1, $2, $3, $4::jsonb)", [tA, fA1, replayPlan.body, replayAuth]));
      check("a used executor signature cannot be replayed", !!e6 && /already used/.test(e6), e6);
      await as(USERS.B);
      const e7 = await err(() => pg.query("select public.mrv_finalize_run($1, $2, $3, $4::jsonb)", [tA, fA1, replayPlan.body, replayAuth]));
      check("another user cannot use A's signed request against A's factory", !!e7 && e7.startsWith("42501"), e7);
    }
    check("no authoritative run was created by any tampering attempt", (await runCount()) === before + 1, { before, after: await runCount() });
    await as(USERS.A);
    const e8 = await err(() => pg.query("insert into public.calculation_run (tenant_id, facility_id, range_start, range_end, range_label, timezone, engine_version, methodology_version, input_snapshot, input_sha256, results, results_fingerprint, qa_overall, created_by) values ($1, $2, '2025-01-01', '2025-01-31', 'x', 'UTC', 'x', 'x', '{}', 'x', '{}', 'x', 'PASS', $3)", [tA, fA1, USERS.A]));
    check("direct table insert of a run is refused (SELECT-only grant)", !!e8 && e8.startsWith("42501"), e8);
    const e9 = await err(() => pg.query("select public.mrv_record_import($1, $2, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb)", [tA, fA1]));
    check("retired mrv_record_import is refused", !!e9 && e9.startsWith("42501"), e9);

    // ── 5. Approved report on Q1; then a correction → revision history, stale runs, report impact, report unchanged ──
    await su();
    const report = (await one<{ id: string }>(
      "insert into public.report_snapshot (tenant_id, facility_id, run_id, status, content, content_sha256, created_by, approved_by, approved_at) values ($1, $2, $3, 'approved_locked', '{\"synthetic\":true}', 'x', $4, $5, now()) returning id",
      [tA, fA1, q1.id, USERS.A, USERS.B]
    )).id;
    const corrected = createSampleDataset();
    corrected.production[0]["Clinker Produced t"] = 175500;
    const corr = await importInput(USERS.A, tA, fA1, corrected);
    check("correction creates exactly one new revision", corr.revised === 1 && corr.inserted === 0, corr);
    await su();
    const hist = (await pg.query<{ revision: number; is_current: boolean }>(
      "select revision, is_current from public.activity_reading where facility_id = $1 and section = 'production' and interval_start = '2025-01-01' order by revision",
      [fA1]
    )).rows;
    check("revision history kept (r1 superseded, r2 current)", hist.length === 2 && !hist[0].is_current && hist[1].is_current, hist);
    const stale = (await pg.query<{ run_id: string }>("select run_id from public.run_invalidation where run_id = any($1::uuid[])", [pgArray([jan.id, q1.id, custom.id])])).rows.map((x) => x.run_id);
    check("January, Q1 and custom runs marked stale (runs themselves unchanged)", [jan.id, q1.id, custom.id].every((id) => stale.includes(id)), stale);
    const impact = await one<{ n: number }>("select count(*)::int as n from public.report_impact where report_id = $1", [report]);
    check("approved report gets a visible impact record", impact.n >= 1, impact);
    const repAfter = await one<{ status: string; content: unknown }>("select status, content from public.report_snapshot where id = $1", [report]);
    check("approved report content unchanged", repAfter.status === "approved_locked" && JSON.stringify(repAfter.content) === '{"synthetic":true}', repAfter);
    const e10 = await err(() => pg.query("update public.report_snapshot set content = '{}' where id = $1", [report]));
    check("approved report cannot be rewritten (even by the table owner)", !!e10, e10);

    // ── 6. Concurrent import between calculation and finalization ──
    const racing = await loadPlan(USERS.A, tA, fA1, { preset: "quarter", year: 2025, quarter: 1 });
    const late = createSampleDataset();
    late.production[0]["Clinker Produced t"] = 175500;
    late.electricity[1]["Grid MWh"] = 30600;
    await importInput(USERS.A, tA, fA1, late);
    const e11 = racing.kind === "run" ? await err(() => rpc(USERS.A, "mrv_finalize_run", "run", tA, fA1, racing.body)) : "no plan";
    check("a run computed before a concurrent import cannot become current (40001, retry)", !!e11 && e11.startsWith("40001"), e11);
    const retried = await calculate(USERS.A, tA, fA1, { preset: "quarter", year: 2025, quarter: 1 });
    check("recalculation after the import succeeds", !!retried.id);

    // ── 7. Invalid import preserves the accepted dataset ──
    await su();
    const beforeBad = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where facility_id = $1 and is_current", [fA1])).n);
    const bad = await importInput(USERS.A, tA, fA1, createSampleDataset(), { status: "rejected", errors: ["synthetic validation error"] });
    await su();
    const afterBad = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where facility_id = $1 and is_current", [fA1])).n);
    check("rejected import recorded, current readings untouched", bad.status === "rejected" && beforeBad === afterBad, { bad, beforeBad, afterBad });
    const badBody = JSON.stringify({ batch: { id: crypto.randomUUID(), origin: "workbook", status: "accepted", mapping: null }, readings: [{ section: "production", series_key: "x", record_key: "x", interval_start: "2025-01-31", interval_end: "2025-01-31", granularity: "month", measurement_type: "interval_total", mapping_version: MAPPING_VERSION, interval_basis: "x", source_identity: "x", payload: {} }], documents: [] });
    const e12 = await err(() => rpc(USERS.A, "mrv_import_v2", "import", tA, fA1, badBody));
    check("database independently rejects a reading whose granularity contradicts its interval", !!e12 && e12.startsWith("22023"), e12);

    // ── 8. Legacy (date-inferred) reading is superseded by an explicitly mapped re-import, history preserved ──
    await su();
    const src = (await one<{ id: string }>("insert into public.data_source (tenant_id, facility_id, kind, name) values ($1, $2, 'workbook', 'legacy') returning id", [tA, fA2])).id;
    const lb = (await one<{ id: string }>("insert into public.import_batch (tenant_id, facility_id, source_id, origin, status, created_by) values ($1, $2, $3, 'workbook', 'accepted', $4) returning id", [tA, fA2, src, USERS.A])).id;
    const legacyPayload = { ...createSampleDataset().production[0] };
    const legacyId = (await one<{ id: string }>(
      "insert into public.activity_reading (tenant_id, facility_id, source_id, batch_id, section, series_key, record_key, observed_on, interval_start, interval_end, granularity, payload, content_hash, revision, synthetic, created_by) values ($1, $2, $3, $4, 'production', 'production|kiln 1|cem ii/a-l 42.5n', 'production|kiln 1|cem ii/a-l 42.5n|2025-01-31|#1', '2025-01-31', '2025-01-01', '2025-01-31', 'month', $5, 'x', 1, true, $6) returning id",
      [tA, fA2, src, lb, JSON.stringify(legacyPayload), USERS.A]
    )).id;
    const legacyPlan = await loadPlan(USERS.A, tA, fA2, { preset: "month", year: 2025, month: 1 });
    check("legacy inferred-interval reading is excluded from new calculations", legacyPlan.coverage.excluded.some((x) => x.id === legacyId && x.reason === "legacy_inferred_interval"), legacyPlan.coverage.excludedCounts);
    const fix = await importInput(USERS.A, tA, fA2, createSampleDataset());
    await su();
    const succ = await one<{ n: number; cur: boolean }>(
      "select (select count(*)::int from public.activity_reading where supersedes_id = $1 and mapping_version is not null) as n, (select is_current from public.activity_reading where id = $1) as cur",
      [legacyId]
    );
    check("mapped re-import supersedes the legacy reading (auditable correction, original kept)", fix.revised >= 1 && succ.n === 1 && succ.cur === false, { fix, succ });

    // ── 9. Withdrawal: new revision, history kept, excluded from calculation ──
    await su();
    const marElec = (await one<{ id: string }>("select id from public.activity_reading where facility_id = $1 and section = 'electricity' and interval_start = '2025-03-01' and is_current", [fA1])).id;
    await rpc(USERS.A, "mrv_withdraw_reading", "withdraw", tA, fA1, JSON.stringify({ reading_id: marElec, reason: "synthetic meter fault" }));
    const wPlan = await loadPlan(USERS.A, tA, fA1, { preset: "quarter", year: 2025, quarter: 1 });
    check("withdrawn reading excluded and Q1 coverage incomplete", !wPlan.coverage.complete && wPlan.coverage.excluded.some((x) => x.reason === "withdrawn"), wPlan.coverage.excludedCounts);

    // ── 10. Cross-organization / cross-factory isolation, storage paths, revocation ──
    await as(USERS.B);
    const bSees = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where tenant_id = $1", [tA])).n);
    const bRuns = Number((await one<{ n: number }>("select count(*)::int as n from public.calculation_run where tenant_id = $1", [tA])).n);
    check("B cannot read A's readings or runs", bSees === 0 && bRuns === 0, { bSees, bRuns });
    const e13 = await err(() => importInput(USERS.B, tA, fA1, createSampleDataset()));
    check("B cannot import into A's factory even with a valid executor signature", !!e13 && e13.includes("42501"), e13);
    await su();
    await pg.query("insert into storage.objects (bucket_id, name) values ('mrv-private', $1)", [`${tA}/${fA1}/imports/x/synthetic.xlsx`]);
    await as(USERS.B);
    const bObj = Number((await one<{ n: number }>("select count(*)::int as n from storage.objects")).n);
    check("B cannot list A's private source file", bObj === 0, { bObj });
    const e14 = await err(() => pg.query("insert into storage.objects (bucket_id, name) values ('mrv-private', $1)", [`${tA}/${fA1}/imports/y/evil.xlsx`]));
    check("B cannot upload into A's storage path", !!e14, e14);
    await as(USERS.A);
    const aObj = Number((await one<{ n: number }>("select count(*)::int as n from storage.objects")).n);
    check("A can read its own private source file", aObj === 1, { aObj });

    await su();
    const memC = (await one<{ id: string }>("insert into public.tenant_membership (tenant_id, user_id) values ($1, $2) returning id", [tA, USERS.C])).id;
    const raC = (await one<{ id: string }>("insert into public.role_assignment (tenant_id, membership_id, role, facility_id, granted_by) values ($1, $2, 'contributor_production', $3, $4) returning id", [tA, memC, fA1, USERS.A])).id;
    await as(USERS.C);
    const cA1 = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where facility_id = $1", [fA1])).n);
    const cA2 = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where facility_id = $1", [fA2])).n);
    check("factory-scoped user C reads A1 but not A2 (cross-factory)", cA1 > 0 && cA2 === 0, { cA1, cA2 });
    const e15 = await err(async () => {
      const p = await loadPlan(USERS.C, tA, fA1, { preset: "quarter", year: 2025, quarter: 1 });
      if (p.kind === "run") await rpc(USERS.C, "mrv_finalize_run", "run", tA, fA1, p.body);
    });
    check("contributor without calculation.run cannot finalize runs", !!e15 && e15.includes("42501"), e15);
    await su();
    await pg.query("update public.role_assignment set revoked_at = now() where id = $1", [raC]);
    await as(USERS.C);
    const cAfter = Number((await one<{ n: number }>("select count(*)::int as n from public.activity_reading where facility_id = $1", [fA1])).n);
    const e16 = await err(() => importInput(USERS.C, tA, fA1, createSampleDataset()));
    check("after revocation C reads nothing and cannot import", cAfter === 0 && !!e16 && e16.includes("42501"), { cAfter, e16 });
  } catch (e) {
    check("harness completed without unexpected error", false, e instanceof Error ? `${(e as { code?: string }).code ?? ""} ${e.message}` : String(e));
  } finally {
    await pg.close();
  }
  return { passed: checks.filter((c) => c.pass).length, total: checks.length, checks };
}
