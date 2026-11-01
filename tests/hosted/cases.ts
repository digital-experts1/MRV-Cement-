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
import { EVIDENCE_MAX_BYTES, evidenceDocumentBody, evidenceStoragePath, validateEvidenceFile } from "@/lib/mrv/evidenceFiles";
import { sha256Bytes } from "@/lib/mrv/sha";
import { createEmptyInput, type SheetRow } from "@/lib/types";
import { evidenceDocumentUrl, listEvidenceDocuments, uploadEvidenceDocument } from "@/lib/server/mrv/service";
import type { MrvCaller } from "@/lib/server/supabase/auth";

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

    // ── All-or-nothing imports: one invalid required row (V28 Demo source without its unit declaration) ──
    const readingsE1 = async () => (await A.db.from("activity_reading").select("id", { count: "exact", head: true }).eq("facility_id", e1)).count ?? -1;
    const partialInput = createSampleDataset();
    partialInput.setup["Workbook mode"] = "Cement_QAQC_V28_Demo";
    partialInput.rawMaterial = partialInput.rawMaterial.map((r, i) => (i === 0 ? r : { ...r, "Carbonate Unit": "percent", "Mass Basis": "dry" }));
    const partialDrafts = toReadingDrafts(partialInput, MONTHLY, "demo:SYNTHETIC_E2E_PARTIAL");
    const partialEff = effectivePeriod({ start: "2025-01-01", end: "2025-03-31" }, partialDrafts.readings)!;
    const partialBatch = (status: "accepted" | "rejected", errors: string[]): ImportBatchMeta => ({
      id: crypto.randomUUID(), origin: "demo", status, filename: "SYNTHETIC_E2E_PARTIAL", sha256: null, size_bytes: null, mime: null, storage_path: null,
      errors, assertions: [], declared_period_start: "2025-01-01", declared_period_end: "2025-03-31", synthetic: true, mapping: MONTHLY,
      effective_from: partialEff.from, effective_to: partialEff.to, effective_basis: partialEff.basis,
    });
    check("the invalid required row is detected while the other rows map (would be a partial import)", partialDrafts.errors.length === 1 && partialDrafts.readings.length > 0, { errors: partialDrafts.errors.length, readings: partialDrafts.readings.length });
    const beforePartial = await readingsE1();
    const sendBody = (body: string) => rpc(A.db, "mrv_import_v2", t, e1, body, sign(A.uid, "import", t, e1, body));
    const p1 = await sendBody(importBody(partialBatch("accepted", partialDrafts.errors), partialDrafts.readings, toConfigDrafts(partialInput)));
    check("DB refuses an 'accepted' batch that carries validation errors", !!p1.error && /no partial acceptance/.test(errText(p1.error)), errText(p1.error));
    const p2 = await sendBody(importBody(partialBatch("rejected", partialDrafts.errors), partialDrafts.readings, []));
    check("DB refuses a 'rejected' batch that would still store readings", !!p2.error && /no partial acceptance/.test(errText(p2.error)), errText(p2.error));
    const p3 = await sendBody(importBody(partialBatch("rejected", partialDrafts.errors), [], []));
    check("the whole batch is recorded as rejected with zero readings stored", !p3.error && (p3.data as { status?: string; inserted?: number })?.status === "rejected" && (p3.data as { inserted?: number }).inserted === 0, p3.error ? errText(p3.error) : p3.data);
    check("no reading of the invalid import reached the database", (await readingsE1()) === beforePartial, { before: beforePartial, after: await readingsE1() });

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

    // ── Key rotation: every key other than the configured one is inactive; a retired key id is refused ──
    for (const retiredId of ["exec-1"].filter((k) => k !== KEY.keyId)) {
      const r = await rpc(A.db, "mrv_finalize_run", t, e1, "{}", signExecutorRequest({ keyId: retiredId, secret: Buffer.alloc(32, 9) }, "run", { userId: A.uid, tenantId: t, facilityId: e1 }, "{}"));
      check(`retired executor key ${retiredId} is refused as inactive`, /trusted executor authorization required/.test(errText(r.error)), errText(r.error));
    }
    const live = await rpc(A.db, "mrv_finalize_run", t, e1, "{}", sign(A.uid, "run", t, e1, "{}"));
    check(`configured executor key ${KEY.keyId} passes signature verification`, /invalid run body/.test(errText(live.error)), errText(live.error));

    // ── Concurrent import during calculation (E2): no stale run is ever left valid, retries never duplicate ──
    const corrected = (bump: number) => {
      const input = createSampleDataset();
      input.production = input.production.map((r, i) => (i === 0 ? { ...r, "Clinker Produced t": 175000 + bump } : r));
      return input;
    };
    const correctImport = async (bump: number) => {
      const input = corrected(bump);
      const drafts = toReadingDrafts(input, MONTHLY, "demo:SYNTHETIC_E2E");
      const eff = effectivePeriod({ start: "2025-01-01", end: "2025-03-31" }, drafts.readings)!;
      const batch: ImportBatchMeta = {
        id: crypto.randomUUID(), origin: "demo", status: "accepted", filename: `SYNTHETIC_E2E_CORRECTION_${bump}`, sha256: null, size_bytes: null, mime: null, storage_path: null,
        errors: [], assertions: [], declared_period_start: "2025-01-01", declared_period_end: "2025-03-31", synthetic: true, mapping: MONTHLY,
        effective_from: eff.from, effective_to: eff.to, effective_basis: eff.basis,
      };
      const body = importBody(batch, drafts.readings, toConfigDrafts(input));
      return rpc(A.db, "mrv_import_v2", t, e2, body, sign(A.uid, "import", t, e2, body));
    };
    const runsE2 = async () => (await A.db.from("calculation_run").select("id", { count: "exact", head: true }).eq("facility_id", e2)).count ?? -1;
    const q1Spec: RangeSpec = { preset: "quarter", year: 2025, quarter: 1 };
    const bump = 1 + (Date.now() % 997);
    // (a) Interleaved: plan → correction committed → finalize the stale plan.
    const stalePlan = await plan(A.db, t, e2, q1Spec);
    const corr = await correctImport(bump);
    check("correction import (E2, January clinker revised) accepted as a revision", !corr.error && (corr.data as { revised?: number })?.revised === 1, corr.error ? errText(corr.error) : corr.data);
    const e2Before = await runsE2();
    const t0 = Date.now();
    const staleFin = stalePlan.kind === "run" ? await rpc(A.db, "mrv_finalize_run", t, e2, stalePlan.body, sign(A.uid, "run", t, e2, stalePlan.body)) : null;
    check("the stale refusal is returned without server-side retries (< 15 s)", Date.now() - t0 < 15_000, { ms: Date.now() - t0 });
    check("finalizing a plan made before a concurrent correction is refused immediately (MRV09, recalculate)", !!staleFin?.error && /^MRV09 /.test(errText(staleFin.error)), errText(staleFin?.error));
    check("the refused stale finalize created no run", (await runsE2()) === e2Before, { before: e2Before, after: await runsE2() });
    const fresh = await plan(A.db, t, e2, q1Spec);
    const freshFin = fresh.kind === "run" ? await rpc(A.db, "mrv_finalize_run", t, e2, fresh.body, sign(A.uid, "run", t, e2, fresh.body)) : null;
    const freshRetry = fresh.kind === "run" ? await rpc(A.db, "mrv_finalize_run", t, e2, fresh.body, sign(A.uid, "run", t, e2, fresh.body)) : null;
    check("recalculation after the correction succeeds; its retry returns the same run", !!freshFin && !freshFin.error && freshRetry?.data === freshFin.data, { err: errText(freshFin?.error), same: freshRetry?.data === freshFin?.data });
    // (b) Truly concurrent: finalize and a further correction race; the facility lock serialises them.
    const racePlan = await plan(A.db, t, e2, q1Spec);
    const e2BeforeRace = await runsE2();
    const [raceFin, raceImp] = await Promise.all([
      racePlan.kind === "run" ? rpc(A.db, "mrv_finalize_run", t, e2, racePlan.body, sign(A.uid, "run", t, e2, racePlan.body)) : Promise.resolve(null),
      correctImport(bump + 1),
    ]);
    const finishedRun = raceFin && !raceFin.error ? (raceFin.data as string) : null;
    const inval = finishedRun ? await A.db.from("run_invalidation").select("id", { count: "exact", head: true }).eq("run_id", finishedRun) : null;
    check(
      "race: either the finalize is refused, or it committed first and the import then marked that run stale",
      !raceImp.error && (finishedRun ? (inval?.count ?? 0) > 0 : /^MRV09 /.test(errText(raceFin?.error))),
      { finalized: !!finishedRun, invalidated: inval?.count ?? null, finErr: errText(raceFin?.error), impErr: errText(raceImp.error) }
    );
    const latest = await plan(A.db, t, e2, q1Spec);
    const [l1, l2] = latest.kind === "run"
      ? await Promise.all([1, 2].map(() => rpc(A.db, "mrv_finalize_run", t, e2, latest.body, sign(A.uid, "run", t, e2, latest.body))))
      : [null, null];
    check("two concurrent retries of the current calculation yield one run id", !!l1 && !l1.error && !l2?.error && l1.data === l2?.data, { a: l1?.data, b: l2?.data, err: errText(l1?.error ?? l2?.error) });
    const created = (await runsE2()) - e2BeforeRace;
    check("race + retries created at most two runs (the possibly-stale one and one current), never duplicates", created >= 1 && created <= 2, { created });
    const validRuns = await A.db.from("calculation_run").select("id, dependency_sha256").eq("facility_id", e2).eq("range_start", "2025-01-01").eq("range_end", "2025-03-31");
    const invalidated = new Set(((await A.db.from("run_invalidation").select("run_id").eq("facility_id", e2)).data ?? []).map((x) => x.run_id as string));
    const validDeps = (validRuns.data ?? []).filter((r) => !invalidated.has(r.id as string)).map((r) => r.dependency_sha256 as string);
    check("no two valid (non-stale) Q1 runs share a dependency hash in E2", new Set(validDeps).size === validDeps.length, { valid: validDeps.length });

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

    // ── Evidence documents (private bucket + trusted executor + register linkage) ──
    const callerOf = (who: { db: SupabaseClient; uid: string }): MrvCaller => ({ db: who.db, user: { id: who.uid, email: null } });
    const EV_ID = `HOSTED-DOC-${String(Date.now() % 1_000_000).padStart(6, "0")}`;
    const EV_ROW: SheetRow = { "Evidence ID": EV_ID, "Evidence Type": "Invoice", Description: "SYNTHETIC hosted E2E evidence reference (not real evidence)", Owner: "E2E A", Status: "Pending" };
    // (a) Register a clearly-labelled synthetic reference through the real config-only import path (as saveManual
    // does when no calculation exists yet: an explicit reporting period scopes the register document).
    const evDrafts = toConfigDrafts({ ...createEmptyInput("manual"), evidence: [EV_ROW] }).filter((d) => d.kind === "evidence_register");
    const evBatch: ImportBatchMeta = {
      id: crypto.randomUUID(), origin: "manual", status: "accepted", filename: "HOSTED_EVIDENCE_REGISTER", sha256: null, size_bytes: null, mime: null, storage_path: null,
      errors: [], assertions: [], declared_period_start: "2025-01-01", declared_period_end: "2025-12-31", synthetic: true, mapping: null,
      effective_from: "2025-01-01", effective_to: "2025-12-31", effective_basis: "declared_period",
    };
    const evRegBody = importBody(evBatch, [], evDrafts);
    const evReg = await rpc(A.db, "mrv_import_v2", t, e1, evRegBody, sign(A.uid, "import", t, e1, evRegBody));
    check("evidence reference registered before any calculation exists (config-only import)", !evReg.error && (evReg.data as { status?: string })?.status === "accepted", evReg.error ? errText(evReg.error) : evReg.data);
    const latestReg = await A.db.from("config_document").select("content").eq("tenant_id", t).eq("facility_id", e1).eq("kind", "evidence_register").order("created_at", { ascending: false }).limit(1).maybeSingle();
    check("the registered reference is the latest evidence_register document", !latestReg.error && ((latestReg.data?.content as SheetRow[] | null) ?? []).some((r) => String(r["Evidence ID"]) === EV_ID), errText(latestReg.error));

    // (b) Upload through the real service (server validation → private bucket → trusted executor metadata write).
    const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, ...new Array(64).fill(0x42)]);
    let doc1 = "";
    try {
      const up1 = await uploadEvidenceDocument(callerOf(A), t, e1, { filename: `hosted-evidence-${EV_ID}.pdf`, bytes: PDF_BYTES, evidenceId: EV_ID, category: "electricity", start: "2025-01-01", end: "2025-01-31" });
      doc1 = up1.documentId;
    } catch (e) {
      check("document stored through the real service (private bucket + trusted executor)", false, e instanceof Error ? e.message : String(e));
    }
    const docsA = await listEvidenceDocuments(callerOf(A), t, e1);
    const d1 = doc1 ? docsA.find((d) => d.id === doc1) : undefined;
    check(
      "document metadata complete (reference, category, coverage, checksum, uploader, current)",
      !!d1 && d1.evidenceId === EV_ID && d1.category === "electricity" && d1.coverageStart === "2025-01-01" && d1.coverageEnd === "2025-01-31"
        && d1.uploadedByMe && d1.isCurrent && d1.sizeBytes === PDF_BYTES.byteLength && d1.sha256 === sha256Bytes(PDF_BYTES),
      d1 ?? (doc1 ? "not found" : "skipped: upload failed")
    );
    let evUrlOk = false;
    let evUrlDetail: unknown = "";
    if (doc1) {
      try {
        const evUrl = await evidenceDocumentUrl(callerOf(A), t, e1, doc1);
        const evFetched = await fetch(evUrl.url);
        const evFetchedBytes = new Uint8Array(await evFetched.arrayBuffer());
        evUrlOk = evFetched.ok && evFetchedBytes.byteLength === PDF_BYTES.byteLength;
        evUrlDetail = { status: evFetched.status, bytes: evFetchedBytes.byteLength };
      } catch (e) {
        evUrlDetail = e instanceof Error ? e.message : String(e);
      }
    }
    check("short-lived signed URL serves exactly the stored bytes", evUrlOk, evUrlDetail || "skipped: upload failed");

    // (c) Authorization and isolation.
    const bDocs = await B.db.from("evidence_document").select("id", { count: "exact", head: true }).eq("tenant_id", t);
    check("B (other organization) reads none of A's evidence documents", (bDocs.count ?? 0) === 0, { n: bDocs.count });
    let bUrlErr = "";
    if (doc1) {
      try { await evidenceDocumentUrl(callerOf(B), t, e1, doc1); } catch (e) { bUrlErr = e instanceof Error ? e.message : String(e); }
    }
    check("B is refused a signed URL for A's document", doc1 ? /denied|forbidden|not found|permission/i.test(bUrlErr) : false, bUrlErr || "skipped: upload failed");
    const evDirect = await A.db.from("evidence_document").insert({ tenant_id: t, facility_id: e1, evidence_id: EV_ID, filename: "direct.pdf", mime: "application/pdf", size_bytes: 8, sha256: "0".repeat(64), storage_path: `${t}/${e1}/evidence/${crypto.randomUUID()}/direct.pdf`, uploaded_by: A.uid });
    check("direct PostgREST INSERT of an evidence document is denied", !!evDirect.error, errText(evDirect.error));

    const expectServiceError = async (label: string, re: RegExp, fn: () => Promise<unknown>) => {
      try {
        await fn();
        check(label, false, "no error was raised");
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        check(label, re.test(m), m);
      }
    };
    await expectServiceError("upload for an unregistered evidence reference is refused", /Register the evidence reference first/, () => uploadEvidenceDocument(callerOf(A), t, e1, { filename: "orphan.pdf", bytes: PDF_BYTES, evidenceId: "NOT-REGISTERED" }));
    await expectServiceError("unsupported file type is refused server-side", /not a supported evidence file/, () => uploadEvidenceDocument(callerOf(A), t, e1, { filename: "notes.txt", bytes: new TextEncoder().encode("x"), evidenceId: EV_ID }));
    await expectServiceError("renamed content is refused server-side", /does not match/, () => uploadEvidenceDocument(callerOf(A), t, e1, { filename: "fake.pdf", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), evidenceId: EV_ID }));
    await expectServiceError("oversized file is refused", /10 MB or smaller/, () => uploadEvidenceDocument(callerOf(A), t, e1, { filename: "big.pdf", bytes: new Uint8Array(EVIDENCE_MAX_BYTES + 1), evidenceId: EV_ID }));
    await expectServiceError("empty file is refused", /empty/i, () => uploadEvidenceDocument(callerOf(A), t, e1, { filename: "empty.pdf", bytes: new Uint8Array(0), evidenceId: EV_ID }));
    await expectServiceError("reversed coverage is refused", /before coverage start/, () => uploadEvidenceDocument(callerOf(A), t, e1, { filename: "invoice.pdf", bytes: PDF_BYTES, evidenceId: EV_ID, start: "2025-02-01", end: "2025-01-01" }));
    await expectServiceError("B cannot upload evidence into A's factory", /denied|forbidden|not found|permission/i, () => uploadEvidenceDocument(callerOf(B), t, e1, { filename: "b.pdf", bytes: PDF_BYTES, evidenceId: EV_ID }));
    await expectServiceError("restricted user C cannot upload evidence into E2", /denied|forbidden|not found|permission/i, () => uploadEvidenceDocument(callerOf(C), t, e2, { filename: "c.pdf", bytes: PDF_BYTES, evidenceId: EV_ID }));

    // (d) Tampering: the evidence-purpose signature is bound to operation, actor, scope and body.
    const tamperId = crypto.randomUUID();
    const tamperBody = evidenceDocumentBody({
      evidenceId: EV_ID, category: null, coverageStart: null, coverageEnd: null, documentId: tamperId, filename: "tamper.pdf",
      mime: "application/pdf", sizeBytes: PDF_BYTES.byteLength, sha256: sha256Bytes(PDF_BYTES),
      storagePath: evidenceStoragePath(t, e1, tamperId, "tamper.pdf"), replaces: null,
    });
    const evTampered = await rpc(A.db, "mrv_store_evidence_document", t, e1, tamperBody, sign(A.uid, "import", t, e1, tamperBody));
    check("an import-purpose signature cannot store evidence documents", !!evTampered.error && /does not match/.test(errText(evTampered.error)), errText(evTampered.error));
    const evUnsigned = await rpc(A.db, "mrv_store_evidence_document", t, e1, tamperBody, null);
    check("an unsigned evidence-document store is refused", !!evUnsigned.error && /authorization required/.test(errText(evUnsigned.error)), errText(evUnsigned.error));
    const evCrossUser = await rpc(B.db, "mrv_store_evidence_document", t, e1, tamperBody, sign(A.uid, "evidence", t, e1, tamperBody));
    check("another user presenting A's evidence signature is refused", !!evCrossUser.error, errText(evCrossUser.error));
    const evTamperRows = await A.db.from("evidence_document").select("id", { count: "exact", head: true }).eq("id", tamperId);
    check("no metadata row was created by any tampering attempt", (evTamperRows.count ?? 0) === 0, { n: evTamperRows.count });

    // (e) Replacement history + failed-upload cleanup. Until db/supabase/0007_evidence_replacement_order.sql is
    // applied, a replacement is refused by the superseded_by FK AFTER the file was already uploaded — and without
    // 0007's delete policy the cleanup cannot remove it. Skip the attempt entirely instead of leaking another
    // orphaned private file; mrv_schema_version() (created by 0007) is the applied/not-applied marker.
    const schemaVersion = await A.db.rpc("mrv_schema_version");
    const mrv0007Applied = !schemaVersion.error && Number(schemaVersion.data ?? 0) >= 7;
    if (doc1 && mrv0007Applied) {
      const evidenceFolders = async () => {
        const l = await A.db.storage.from("mrv-private").list(`${t}/${e1}/evidence`, { limit: 1000 });
        return (l.data ?? []).map((o) => o.name);
      };
      const up2 = await uploadEvidenceDocument(callerOf(A), t, e1, { filename: `hosted-evidence-${EV_ID}-v2.pdf`, bytes: new Uint8Array([...PDF_BYTES.slice(0, 8), ...new Array(64).fill(0x43)]), evidenceId: EV_ID, category: "electricity", start: "2025-01-01", end: "2025-01-31", replace: doc1 });
      const docsAfterReplace = await listEvidenceDocuments(callerOf(A), t, e1);
      const oldDoc = docsAfterReplace.find((d) => d.id === doc1);
      const newDoc = docsAfterReplace.find((d) => d.id === up2.documentId);
      check("replacement keeps history: v1 retired and superseded, v2 current", !!oldDoc && !oldDoc.isCurrent && oldDoc.supersededBy === up2.documentId && !!newDoc?.isCurrent, { oldDoc, newDoc });
      let staleReplaceErr = "";
      const foldersBeforeStale = await evidenceFolders();
      try {
        await uploadEvidenceDocument(callerOf(A), t, e1, { filename: `hosted-evidence-${EV_ID}-v3.pdf`, bytes: PDF_BYTES, evidenceId: EV_ID, replace: doc1 });
      } catch (e) {
        staleReplaceErr = e instanceof Error ? e.message : String(e);
      }
      check("replacing an already-replaced document is refused", /no longer current/.test(staleReplaceErr), staleReplaceErr);
      // Race-relevant API behaviour, unregistered side: the refused write uploaded a file first; the service's
      // cleanup must have removed it again through the real Storage API (delete policy allows the uploader's own
      // unregistered file). No new evidence folder may remain.
      const foldersAfterStale = await evidenceFolders();
      check(
        "failed-upload cleanup removes the refused replacement's file through the real Storage API (no new evidence folder)",
        foldersAfterStale.length === foldersBeforeStale.length && foldersAfterStale.every((n) => foldersBeforeStale.includes(n)),
        { before: foldersBeforeStale.length, after: foldersAfterStale.length, added: foldersAfterStale.filter((n) => !foldersBeforeStale.includes(n)) }
      );
      // Race-relevant API behaviour, registered side: a metadata-referenced file must be undeletable even by its
      // own uploader, through the real Storage API. RLS-refused deletes return success with zero objects removed,
      // so the retained bytes are the proof. (The committed interleaving itself cannot be forced from a client; it
      // is proven with separate concurrent transactions in tests/mrv/concurrencyHarness.ts.)
      const v1Path = ((await A.db.from("evidence_document").select("storage_path").eq("id", doc1).single()).data as { storage_path: string } | null)?.storage_path ?? null;
      const rmRegistered = v1Path ? await A.db.storage.from("mrv-private").remove([v1Path]) : null;
      const dlRegistered = v1Path ? await A.db.storage.from("mrv-private").download(v1Path) : null;
      const dlBytes = dlRegistered && !dlRegistered.error ? (await dlRegistered.data!.text()).length : -1;
      check(
        "a registered file is refused a direct Storage-API delete by its own uploader (0 objects removed, bytes retained)",
        !!v1Path && !rmRegistered?.error && (rmRegistered?.data ?? []).length === 0 && !!dlRegistered && !dlRegistered.error && dlBytes > 0,
        { removed: rmRegistered?.data ?? null, rmErr: errText(rmRegistered?.error), downloadErr: errText(dlRegistered?.error), bytes: dlBytes }
      );
    } else {
      const why = !doc1 ? "skipped: upload failed" : "skipped: db/supabase/0007 is not applied (avoids creating orphaned private files)";
      check("replacement keeps history: v1 retired and superseded, v2 current", false, why);
      check("replacing an already-replaced document is refused", false, why);
      check("failed-upload cleanup removes the refused replacement's file through the real Storage API (no new evidence folder)", false, why);
      check("a registered file is refused a direct Storage-API delete by its own uploader (0 objects removed, bytes retained)", false, why);
    }
    const evFolders = await A.db.storage.from("mrv-private").list(`${t}/${e1}/evidence`, { limit: 1000 });
    const evStoredIds = new Set(((await A.db.from("evidence_document").select("id").eq("tenant_id", t).eq("facility_id", e1)).data ?? []).map((r) => r.id as string));
    check(
      "failed uploads leave no orphaned file in the bucket (every evidence folder matches a stored document)",
      !evFolders.error && (evFolders.data ?? []).every((o) => evStoredIds.has(o.name)),
      { folders: (evFolders.data ?? []).length, documents: evStoredIds.size, err: errText(evFolders.error) }
    );
    const cUp = await uploadEvidenceDocument(callerOf(C), t, e1, { filename: `hosted-evidence-${EV_ID}-c.pdf`, bytes: PDF_BYTES, evidenceId: EV_ID });
    check("restricted user C (E1 facility manager) can upload evidence to E1", !!cUp.documentId, cUp);

    // (f) Regression: E1's stored runs stay readable history and E2's calculations are untouched by E1 evidence.
    const runAfter = await A.db.from("calculation_run").select("id").eq("id", run.data as string).maybeSingle();
    check("E1's stored Q1 run remains readable after the evidence import", !runAfter.error && !!runAfter.data, errText(runAfter.error));
    const e2RunsBefore = await runsE2();
    const e2PlanAgain = await plan(A.db, t, e2, q1Spec);
    const e2RunAgain = e2PlanAgain.kind === "run" ? await rpc(A.db, "mrv_finalize_run", t, e2, e2PlanAgain.body, sign(A.uid, "run", t, e2, e2PlanAgain.body)) : null;
    const e2RunsAfter = await runsE2();
    check(
      "E2 calculations are unaffected by E1's evidence documents (existing run reused, no new run)",
      !!e2RunAgain && !e2RunAgain.error && e2RunsAfter === e2RunsBefore,
      { err: errText(e2RunAgain?.error), before: e2RunsBefore, after: e2RunsAfter }
    );

    for (const c of [A, B, C, R]) await c.db.auth.signOut();
  } catch (e) {
    check("hosted suite completed without an unexpected error", false, e instanceof Error ? e.message : String(e));
  }
  return { enabled: true, project: guard.ref, passed: checks.filter((c) => c.pass).length, total: checks.length, checks };
}
