/**
 * HOSTED acceptance cases (Directive 06B §2/§4) — real Supabase Auth + PostgREST + Storage of the project the owner
 * designated as development/test. Runner-agnostic: executed by Vitest (tests/hosted/stagingE2E.test.ts) and by the
 * development-only route GET /api/dev/hosted-e2e. SYNTHETIC organizations and logins only.
 *
 * Guards (all required): MRV_STAGING_E2E=1, MRV_SUPABASE_ENVIRONMENT=test, MRV_STAGING_PROJECT_REF equal to the ref in
 * NEXT_PUBLIC_SUPABASE_URL, executor key and synthetic logins present. Secrets are read from the environment only and
 * never returned in results.
 *
 * Fixture (operator setup, see docs/mrv/12-directive-06-evidence.md §1): org "SYNTHETIC E2E Org A" (owner A, factories
 * E1/E2), org "SYNTHETIC E2E Org B" (owner B), C = facility_manager restricted to E1, R = role in E1 revoked.
 * Readings/runs are append-only by design; repeated executions add only unchanged-import batches and idempotent runs.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSampleDataset } from "@/lib/sampleData";
import { resolveRange, type RangeSpec } from "@/lib/mrv/dateRanges";
import { MAPPING_VERSION, type ImportMapping } from "@/lib/mrv/importMapping";
import { toConfigDrafts, toReadingDrafts, type StoredReading } from "@/lib/mrv/readings";
import { effectivePeriod, importBody, planRun, type ConfigDoc, type ImportBatchMeta } from "@/lib/mrv/executorPayload";
import { signExecutorRequest, type ExecutorKey, type ExecutorPurpose } from "@/lib/mrv/executorSign";

export interface HostedCheck {
  label: string;
  pass: boolean;
  detail?: string;
}
export interface HostedResult {
  enabled: boolean;
  reason?: string;
  project?: string;
  passed: number;
  total: number;
  checks: HostedCheck[];
}

const MONTHLY: ImportMapping = { version: MAPPING_VERSION, interval: "calendar_month_of_date" };
const TZ = "Africa/Cairo";
const READING_COLS =
  "id, section, series_key, record_key, observed_on, interval_start, interval_end, granularity, measurement_type, mapping_version, quality_state, payload, synthetic, revision";

export function hostedGuard(env = process.env): { ok: true; ref: string } | { ok: false; reason: string } {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1];
  if (env.MRV_STAGING_E2E !== "1") return { ok: false, reason: "MRV_STAGING_E2E is not 1" };
  if (env.MRV_SUPABASE_ENVIRONMENT !== "test") return { ok: false, reason: "project is not classified as test" };
  if (!ref || ref !== env.MRV_STAGING_PROJECT_REF) return { ok: false, reason: "MRV_STAGING_PROJECT_REF does not match NEXT_PUBLIC_SUPABASE_URL" };
  for (const k of ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "MRV_EXECUTOR_KEY_ID", "MRV_EXECUTOR_KEY", "MRV_E2E_A_EMAIL", "MRV_E2E_A_PASSWORD", "MRV_E2E_B_EMAIL", "MRV_E2E_B_PASSWORD", "MRV_E2E_C_EMAIL", "MRV_E2E_C_PASSWORD", "MRV_E2E_REVOKED_EMAIL", "MRV_E2E_REVOKED_PASSWORD"]) {
    if (!env[k]) return { ok: false, reason: `${k} is not set` };
  }
  return { ok: true, ref };
}

const errText = (e: unknown) => {
  if (!e) return "no error";
  const x = e as { code?: string; message?: string };
  return `${x.code ?? ""} ${x.message ?? String(e)}`.trim();
};

export async function runHostedCases(): Promise<HostedResult> {
  const guard = hostedGuard();
  if (!guard.ok) return { enabled: false, reason: guard.reason, passed: 0, total: 0, checks: [] };
  const env = process.env;
  const checks: HostedCheck[] = [];
  const check = (label: string, pass: boolean, detail?: unknown) => checks.push({ label, pass, detail: detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail) });
  const KEY: ExecutorKey = { keyId: env.MRV_EXECUTOR_KEY_ID!, secret: Buffer.from(env.MRV_EXECUTOR_KEY!, "hex") };
  const client = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = async (email: string, password: string) => {
    const db = client();
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new Error(`login failed for a synthetic test user: ${error?.message ?? "no user"}`);
    return { db, uid: data.user.id };
  };
  const sign = (uid: string, purpose: ExecutorPurpose, t: string, f: string, body: string, issuedAt?: number) =>
    signExecutorRequest(KEY, purpose, { userId: uid, tenantId: t, facilityId: f }, body, { issuedAt });
  const rpc = (c: SupabaseClient, fn: string, t: string, f: string, body: string, auth: unknown) => c.rpc(fn, { p_tenant: t, p_facility: f, p_body: body, p_auth: auth });

  try {
    // ── Real Supabase Auth ──
    const A = await login(env.MRV_E2E_A_EMAIL!, env.MRV_E2E_A_PASSWORD!);
    const B = await login(env.MRV_E2E_B_EMAIL!, env.MRV_E2E_B_PASSWORD!);
    const C = await login(env.MRV_E2E_C_EMAIL!, env.MRV_E2E_C_PASSWORD!);
    const R = await login(env.MRV_E2E_REVOKED_EMAIL!, env.MRV_E2E_REVOKED_PASSWORD!);
    check("four synthetic users sign in through Supabase Auth (password grant, real JWTs)", true);
    const bad = await client().auth.signInWithPassword({ email: env.MRV_E2E_A_EMAIL!, password: "wrong-password-xyz" });
    check("wrong password is rejected by Supabase Auth", !!bad.error, errText(bad.error));
    const anon = await client().from("activity_reading").select("id").limit(1);
    check("anonymous PostgREST access to readings is refused", !!anon.error || (anon.data ?? []).length === 0, errText(anon.error));

    const orgA = await A.db.from("tenant").select("id").eq("name", "SYNTHETIC E2E Org A").single();
    const orgB = await B.db.from("tenant").select("id").eq("name", "SYNTHETIC E2E Org B").single();
    if (orgA.error || orgB.error) throw new Error("synthetic fixture organizations not found (operator setup missing)");
    const t = orgA.data.id as string;
    const tb = orgB.data.id as string;
    const facs = await A.db.from("facility").select("id, code").eq("tenant_id", t);
    const e1 = facs.data!.find((x) => x.code === "E1")!.id as string;
    const e2 = facs.data!.find((x) => x.code === "E2")!.id as string;
    const fb = ((await B.db.from("facility").select("id").eq("tenant_id", tb).single()).data as { id: string }).id;

    // ── Legitimate signed import (server-built body) + idempotent retry ──
    const doImport = async (who: { db: SupabaseClient; uid: string }, tt: string, ff: string, batchId = crypto.randomUUID()) => {
      const input = createSampleDataset();
      const drafts = toReadingDrafts(input, MONTHLY, "demo:SYNTHETIC_E2E");
      const eff = effectivePeriod({ start: "2025-01-01", end: "2025-03-31" }, drafts.readings)!;
      const batch: ImportBatchMeta = {
        id: batchId, origin: "demo", status: "accepted", filename: "SYNTHETIC_E2E_DATASET", sha256: null, size_bytes: null, mime: null, storage_path: null,
        errors: [], assertions: [], declared_period_start: "2025-01-01", declared_period_end: "2025-03-31", synthetic: true, mapping: MONTHLY,
        effective_from: eff.from, effective_to: eff.to, effective_basis: eff.basis,
      };
      const body = importBody(batch, drafts.readings, toConfigDrafts(input));
      return { body, batchId, res: await rpc(who.db, "mrv_import_v2", tt, ff, body, sign(who.uid, "import", tt, ff, body)) };
    };
    const imp = await doImport(A, t, e1);
    const impData = imp.res.data as { status?: string; inserted?: number; unchanged?: number } | null;
    check("legitimate signed import accepted (E1)", !imp.res.error && impData?.status === "accepted", imp.res.error ? errText(imp.res.error) : impData);
    const retry = await rpc(A.db, "mrv_import_v2", t, e1, imp.body, sign(A.uid, "import", t, e1, imp.body));
    check("import retry (same batch id, fresh signature) is idempotent", (retry.data as { idempotent_replay?: boolean } | null)?.idempotent_replay === true, retry.error ? errText(retry.error) : retry.data);
    const impE2 = await doImport(A, t, e2);
    check("legitimate signed import accepted (E2)", !impE2.res.error, impE2.res.error ? errText(impE2.res.error) : impE2.res.data);

    // ── Server-generated calculation + idempotent retry ──
    const plan = async (c: SupabaseClient, tt: string, ff: string, spec: RangeSpec) => {
      const range = resolveRange(spec, { timezone: TZ });
      const r = await c.from("activity_reading").select(READING_COLS).eq("tenant_id", tt).eq("facility_id", ff).eq("is_current", true).lte("interval_start", range.end).gte("interval_end", range.start);
      const d = await c.from("config_document").select("id, kind, content, effective_from, effective_to, created_at").eq("tenant_id", tt).eq("facility_id", ff);
      if (r.error || d.error) throw new Error(`read failed: ${errText(r.error ?? d.error)}`);
      return planRun({ readings: r.data as (StoredReading & { synthetic: boolean })[], docs: d.data as ConfigDoc[], range, facility: { code: "E2E", synthetic: true } });
    };
    const q1 = await plan(A.db, t, e1, { preset: "quarter", year: 2025, quarter: 1 });
    if (q1.kind !== "run") throw new Error(`Q1 not plannable: ${q1.note}`);
    const run = await rpc(A.db, "mrv_finalize_run", t, e1, q1.body, sign(A.uid, "run", t, e1, q1.body));
    check("legitimate server-generated Q1 calculation finalized", !run.error && typeof run.data === "string", run.error ? errText(run.error) : run.data);
    const runAgain = await rpc(A.db, "mrv_finalize_run", t, e1, q1.body, sign(A.uid, "run", t, e1, q1.body));
    check("run retry with a fresh signature returns the same run (no duplicate)", runAgain.data === run.data, { first: run.data, retry: runAgain.data, err: errText(runAgain.error) });
    const stored = await A.db.from("calculation_run").select("qa_overall, synthetic, executor_key_id, results_sha256").eq("id", run.data as string).single();
    check("stored run is synthetic-labelled, executor-attributed, QA derived in DB", !!stored.data?.synthetic && stored.data?.executor_key_id === KEY.keyId && !!stored.data?.qa_overall, { qa: stored.data?.qa_overall, synthetic: stored.data?.synthetic });
    const qaRows = await A.db.from("run_qa_result").select("check_id", { count: "exact", head: true }).eq("run_id", run.data as string);
    check("QA rows persisted from engine results", (qaRows.count ?? 0) > 0, { n: qaRows.count });

    // ── Ranges ──
    const jan = await plan(A.db, t, e1, { preset: "month", year: 2025, month: 1 });
    const janRun = jan.kind === "run" ? await rpc(A.db, "mrv_finalize_run", t, e1, jan.body, sign(A.uid, "run", t, e1, jan.body)) : null;
    check("January range calculated from January readings only", jan.kind === "run" && !janRun?.error && JSON.parse(jan.body).reading_ids.length < JSON.parse(q1.body).reading_ids.length, jan.kind === "run" ? { readings: JSON.parse(jan.body).reading_ids.length, q1: JSON.parse(q1.body).reading_ids.length, err: errText(janRun?.error) } : jan.note);
    const custom = await plan(A.db, t, e1, { preset: "custom", start: "2025-02-01", end: "2025-03-31" });
    const customRun = custom.kind === "run" ? await rpc(A.db, "mrv_finalize_run", t, e1, custom.body, sign(A.uid, "run", t, e1, custom.body)) : null;
    check("custom range (Feb–Mar) calculated", custom.kind === "run" && !customRun?.error, custom.kind === "run" ? errText(customRun?.error) : custom.note);
    const year = await plan(A.db, t, e1, { preset: "year", year: 2025 });
    check("full year with Q1-only data/config is NOT silently calculated; incompleteness reported", year.kind === "none" || !year.coverage.complete, year.kind === "none" ? year.note : { complete: year.coverage.complete });
    const midJan = await plan(A.db, t, e1, { preset: "custom", start: "2025-01-15", end: "2025-02-28" });
    check("partial range: January monthly totals are excluded, not prorated", midJan.kind === "none" || !midJan.coverage.complete, midJan.kind === "none" ? midJan.note : { complete: midJan.coverage.complete });

    // ── Tampering / replay / cross-scope (no run may be created) ──
    const countRuns = async () => (await A.db.from("calculation_run").select("id", { count: "exact", head: true }).eq("tenant_id", t)).count ?? -1;
    const before = await countRuns();
    const retired = await A.db.rpc("mrv_record_run", { p_tenant: t, p_facility: e1, p_run: { qa_overall: "PASS" }, p_reading_ids: [], p_document_ids: [], p_qa: [] });
    check("retired mrv_record_run (direct, with QA PASS) is denied", !!retired.error, errText(retired.error));
    const retiredImp = await A.db.rpc("mrv_record_import", { p_tenant: t, p_facility: e1, p_batch: {}, p_readings: [], p_documents: [] });
    check("retired mrv_record_import is denied", !!retiredImp.error, errText(retiredImp.error));
    const direct = await A.db.from("calculation_run").insert({ tenant_id: t, facility_id: e1, qa_overall: "PASS" });
    check("direct INSERT of a run through PostgREST is denied", !!direct.error, errText(direct.error));
    const upd = await A.db.from("activity_reading").update({ payload: {} }).eq("tenant_id", t);
    check("direct UPDATE of readings through PostgREST is denied", !!upd.error, errText(upd.error));

    const fake = JSON.parse(q1.body);
    for (const row of fake.results.calcRows as { Metric: string; Value: unknown }[]) {
      if (row.Metric === "Total Embedded CO2") row.Value = 1;
      if (row.Metric === "QA/QC Overall Status") row.Value = "PASS";
    }
    fake.run.dependency_sha256 = "forged";
    const fakeBody = JSON.stringify(fake);
    const now = Math.floor(Date.now() / 1000);
    const used = sign(A.uid, "run", t, e1, q1.body);
    await rpc(A.db, "mrv_finalize_run", t, e1, q1.body, used); // consumes the nonce (idempotent return)
    const attempts: [string, () => PromiseLike<{ error: unknown }>, RegExp][] = [
      ["unsigned request", () => rpc(A.db, "mrv_finalize_run", t, e1, fakeBody, null), /authorization required/],
      ["forged key (self-signed)", () => rpc(A.db, "mrv_finalize_run", t, e1, fakeBody, signExecutorRequest({ keyId: KEY.keyId, secret: Buffer.alloc(32, 7) }, "run", { userId: A.uid, tenantId: t, facilityId: e1 }, fakeBody)), /does not match/],
      ["altered payload (fake total + QA PASS) with signature of the original", () => rpc(A.db, "mrv_finalize_run", t, e1, fakeBody, sign(A.uid, "run", t, e1, q1.body)), /does not match/],
      ["expired signature (10 min old)", () => rpc(A.db, "mrv_finalize_run", t, e1, q1.body, sign(A.uid, "run", t, e1, q1.body, now - 600)), /expired/],
      ["future-dated signature", () => rpc(A.db, "mrv_finalize_run", t, e1, q1.body, sign(A.uid, "run", t, e1, q1.body, now + 600)), /future/],
      ["replayed signature", () => rpc(A.db, "mrv_finalize_run", t, e1, q1.body, used), /already used/],
      ["cross-facility (signed for E1, sent to E2)", () => rpc(A.db, "mrv_finalize_run", t, e2, q1.body, sign(A.uid, "run", t, e1, q1.body)), /does not match/],
      ["cross-operation (import signature used to finalize)", () => rpc(A.db, "mrv_finalize_run", t, e1, q1.body, sign(A.uid, "import", t, e1, q1.body)), /does not match/],
      ["other user (B) presenting A's signature", () => rpc(B.db, "mrv_finalize_run", t, e1, q1.body, sign(A.uid, "run", t, e1, q1.body)), /permission denied/],
    ];
    for (const [label, call, expect] of attempts) {
      const r = await call();
      check(`rejected: ${label}`, !!r.error && expect.test(errText(r.error)), errText(r.error));
    }
    check("no authoritative run was created by any tampering/replay attempt", (await countRuns()) === before, { before, after: await countRuns() });

    // ── Cross-tenant ──
    const bSees = await Promise.all(["tenant", "facility", "activity_reading", "calculation_run", "import_batch", "config_document"].map(async (tbl) => {
      const q = tbl === "tenant" ? B.db.from(tbl).select("id", { count: "exact", head: true }).eq("id", t) : B.db.from(tbl).select("id", { count: "exact", head: true }).eq("tenant_id", t);
      return [tbl, (await q).count ?? 0] as const;
    }));
    check("B (other organization) reads nothing of org A", bSees.every(([, n]) => n === 0), Object.fromEntries(bSees));
    const bImp = await doImport(B, t, e1);
    check("B cannot import into A's factory even with a valid executor signature", !!bImp.res.error, errText(bImp.res.error));
    const aInB = await doImport(A, tb, fb);
    check("A cannot import into B's factory", !!aInB.res.error, errText(aInB.res.error));

    // ── Restricted factory (C: facility_manager on E1 only) ──
    const cE1 = await C.db.from("activity_reading").select("id", { count: "exact", head: true }).eq("facility_id", e1);
    const cE2 = await C.db.from("activity_reading").select("id", { count: "exact", head: true }).eq("facility_id", e2);
    check("restricted user C reads E1 but not E2", (cE1.count ?? 0) > 0 && (cE2.count ?? 0) === 0, { e1: cE1.count, e2: cE2.count });
    const cImpE2 = await doImport(C, t, e2);
    check("restricted user C cannot import into E2", !!cImpE2.res.error, errText(cImpE2.res.error));
    const cPlan = await plan(C.db, t, e1, { preset: "quarter", year: 2025, quarter: 1 });
    const cRun = cPlan.kind === "run" ? await rpc(C.db, "mrv_finalize_run", t, e1, cPlan.body, sign(C.uid, "run", t, e1, cPlan.body)) : null;
    check("restricted user C can calculate in E1 (same run returned)", !!cRun && !cRun.error && cRun.data === run.data, { err: errText(cRun?.error), same: cRun?.data === run.data });

    // ── Revoked user (R: role in E1 revoked) ──
    const rSees = await R.db.from("activity_reading").select("id", { count: "exact", head: true }).eq("tenant_id", t);
    check("revoked user R reads nothing", (rSees.count ?? 0) === 0, { n: rSees.count });
    const rImp = await doImport(R, t, e1);
    check("revoked user R is rejected at execution time despite a valid signature", !!rImp.res.error && /permission denied/.test(errText(rImp.res.error)), errText(rImp.res.error));

    // ── Private source files ──
    const path = `${t}/${e1}/e2e/${crypto.randomUUID()}.txt`;
    const up = await A.db.storage.from("mrv-private").upload(path, new Blob(["SYNTHETIC E2E source file"], { type: "text/plain" }), { upsert: false });
    check("A uploads a private source file into its factory path", !up.error, errText(up.error));
    const aDl = await A.db.storage.from("mrv-private").download(path);
    check("A downloads its own private source file", !aDl.error && (await aDl.data!.text()).includes("SYNTHETIC"), errText(aDl.error));
    const bDl = await B.db.storage.from("mrv-private").download(path);
    check("B cannot download A's private source file", !!bDl.error, errText(bDl.error));
    const cDl = await C.db.storage.from("mrv-private").download(path);
    check("restricted user C (E1) can download the E1 file", !cDl.error, errText(cDl.error));
    const pathE2 = `${t}/${e2}/e2e/${crypto.randomUUID()}.txt`;
    await A.db.storage.from("mrv-private").upload(pathE2, new Blob(["SYNTHETIC E2"], { type: "text/plain" }));
    const cDl2 = await C.db.storage.from("mrv-private").download(pathE2);
    check("restricted user C cannot download an E2 file", !!cDl2.error, errText(cDl2.error));
    const bUp = await B.db.storage.from("mrv-private").upload(`${t}/${e1}/e2e/b-${crypto.randomUUID()}.txt`, new Blob(["x"]));
    check("B cannot upload into A's storage path", !!bUp.error, errText(bUp.error));
    const pub = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/mrv-private/${path}`);
    check("no public URL access to the private bucket", pub.status >= 400, { status: pub.status });

    for (const c of [A, B, C, R]) await c.db.auth.signOut();
  } catch (e) {
    check("hosted suite completed without an unexpected error", false, e instanceof Error ? e.message : String(e));
  }
  return { enabled: true, project: guard.ref, passed: checks.filter((c) => c.pass).length, total: checks.length, checks };
}
