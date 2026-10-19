/**
 * HOSTED end-to-end acceptance (Directive 06B §2) — real Supabase Auth + PostgREST of an EXPLICITLY designated staging
 * project. Skipped unless every guard below is satisfied; it never runs against a project classified production/unsure.
 *
 * Required environment (test runner only, never NEXT_PUBLIC_ beyond the existing URL/key, never committed or printed):
 *   MRV_STAGING_E2E=1
 *   MRV_SUPABASE_ENVIRONMENT=test            (owner classification of NEXT_PUBLIC_SUPABASE_URL)
 *   MRV_STAGING_PROJECT_REF=<ref>            (must equal the ref in NEXT_PUBLIC_SUPABASE_URL)
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   MRV_EXECUTOR_KEY_ID, MRV_EXECUTOR_KEY    (the staging executor key; server-side secret)
 *   MRV_E2E_A_EMAIL / MRV_E2E_A_PASSWORD     (synthetic test login A)
 *   MRV_E2E_B_EMAIL / MRV_E2E_B_PASSWORD     (synthetic test login B, no access to A's organization)
 *   optional MRV_E2E_REVOKED_EMAIL / _PASSWORD / _TENANT / _FACILITY  (a login whose role in that facility was revoked
 *     by an operator beforehand — authenticated has no grant to revoke roles itself)
 *
 * Creates SYNTHETIC organizations named "SYNTHETIC E2E <timestamp>". Readings/runs are append-only by design, so these
 * records remain in staging as labelled synthetic test data.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, beforeAll } from "vitest";
import { createSampleDataset } from "@/lib/sampleData";
import { resolveRange } from "@/lib/mrv/dateRanges";
import { MAPPING_VERSION, type ImportMapping } from "@/lib/mrv/importMapping";
import { toConfigDrafts, toReadingDrafts, type StoredReading } from "@/lib/mrv/readings";
import { effectivePeriod, importBody, planRun, type ConfigDoc, type ImportBatchMeta } from "@/lib/mrv/executorPayload";
import { signExecutorRequest, type ExecutorKey, type ExecutorPurpose } from "@/lib/mrv/executorSign";

const env = process.env;
const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.[1];
const enabled =
  env.MRV_STAGING_E2E === "1" &&
  env.MRV_SUPABASE_ENVIRONMENT === "test" &&
  !!ref &&
  ref === env.MRV_STAGING_PROJECT_REF &&
  !!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
  !!env.MRV_EXECUTOR_KEY_ID &&
  !!env.MRV_EXECUTOR_KEY &&
  !!env.MRV_E2E_A_EMAIL &&
  !!env.MRV_E2E_B_EMAIL;

const MONTHLY: ImportMapping = { version: MAPPING_VERSION, interval: "calendar_month_of_date" };

async function login(email: string, password: string): Promise<{ db: SupabaseClient; uid: string }> {
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`login failed for a synthetic test user: ${error?.message ?? "no user"}`);
  return { db, uid: data.user.id };
}

describe.skipIf(!enabled)("HOSTED staging: trusted executor via real Supabase Auth + PostgREST (synthetic data)", () => {
  const KEY: ExecutorKey = { keyId: env.MRV_EXECUTOR_KEY_ID ?? "", secret: Buffer.from(env.MRV_EXECUTOR_KEY ?? "", "hex") };
  let A: { db: SupabaseClient; uid: string };
  let B: { db: SupabaseClient; uid: string };
  let t = "";
  let f1 = "";
  let f2 = "";
  const sign = (uid: string, purpose: ExecutorPurpose, tenant: string, facility: string, body: string, issuedAt?: number) =>
    signExecutorRequest(KEY, purpose, { userId: uid, tenantId: tenant, facilityId: facility }, body, { issuedAt });
  const rpc = (c: SupabaseClient, fn: string, tenant: string, facility: string, body: string, auth: unknown) =>
    c.rpc(fn, { p_tenant: tenant, p_facility: facility, p_body: body, p_auth: auth });

  async function plan(c: SupabaseClient, tenant: string, facility: string) {
    const range = resolveRange({ preset: "quarter", year: 2025, quarter: 1 }, { timezone: "UTC" });
    const r = await c.from("activity_reading")
      .select("id, section, series_key, record_key, observed_on, interval_start, interval_end, granularity, measurement_type, mapping_version, quality_state, payload, synthetic, revision")
      .eq("tenant_id", tenant).eq("facility_id", facility).eq("is_current", true).lte("interval_start", range.end).gte("interval_end", range.start);
    const d = await c.from("config_document").select("id, kind, content, effective_from, effective_to, created_at").eq("tenant_id", tenant).eq("facility_id", facility);
    if (r.error || d.error) throw new Error("read failed");
    const p = planRun({ readings: r.data as (StoredReading & { synthetic: boolean })[], docs: d.data as ConfigDoc[], range, facility: { code: "E2E", synthetic: true } });
    if (p.kind !== "run") throw new Error(p.note);
    return p;
  }

  beforeAll(async () => {
    A = await login(env.MRV_E2E_A_EMAIL!, env.MRV_E2E_A_PASSWORD ?? "");
    B = await login(env.MRV_E2E_B_EMAIL!, env.MRV_E2E_B_PASSWORD ?? "");
    const org = await A.db.rpc("mrv_create_organization", { p_name: `SYNTHETIC E2E ${new Date().toISOString()}`, p_facility_code: "E1", p_facility_name: "Synthetic E2E Factory 1", p_timezone: "UTC", p_synthetic: true });
    if (org.error) throw new Error(org.error.message);
    t = org.data as string;
    f1 = ((await A.db.from("facility").select("id").eq("tenant_id", t).eq("code", "E1").single()).data as { id: string }).id;
    f2 = (await A.db.rpc("mrv_add_facility", { p_tenant: t, p_code: "E2", p_name: "Synthetic E2E Factory 2", p_timezone: "UTC" })).data as string;
  }, 60_000);

  it("legitimate signed import, then server-generated calculation, succeed; retries are idempotent", async () => {
    const input = createSampleDataset();
    const drafts = toReadingDrafts(input, MONTHLY, "demo:SYNTHETIC_E2E");
    const eff = effectivePeriod({ start: "2025-01-01", end: "2025-03-31" }, drafts.readings)!;
    const batch: ImportBatchMeta = {
      id: crypto.randomUUID(), origin: "demo", status: "accepted", filename: "SYNTHETIC_E2E", sha256: null, size_bytes: null, mime: null, storage_path: null,
      errors: [], assertions: [], declared_period_start: "2025-01-01", declared_period_end: "2025-03-31", synthetic: true, mapping: MONTHLY,
      effective_from: eff.from, effective_to: eff.to, effective_basis: eff.basis,
    };
    const body = importBody(batch, drafts.readings, toConfigDrafts(input));
    const imp = await rpc(A.db, "mrv_import_v2", t, f1, body, sign(A.uid, "import", t, f1, body));
    expect(imp.error).toBeNull();
    expect((imp.data as { status: string }).status).toBe("accepted");
    const retry = await rpc(A.db, "mrv_import_v2", t, f1, body, sign(A.uid, "import", t, f1, body));
    expect((retry.data as { idempotent_replay?: boolean }).idempotent_replay).toBe(true);

    const p = await plan(A.db, t, f1);
    const run = await rpc(A.db, "mrv_finalize_run", t, f1, p.body, sign(A.uid, "run", t, f1, p.body));
    expect(run.error).toBeNull();
    const again = await rpc(A.db, "mrv_finalize_run", t, f1, p.body, sign(A.uid, "run", t, f1, p.body));
    expect(again.data).toBe(run.data);
  }, 120_000);

  it("retired RPCs, unsigned/forged/altered/expired/replayed/cross-facility requests are rejected; no fake run persists", async () => {
    const count = async () => (await A.db.from("calculation_run").select("id", { count: "exact", head: true }).eq("tenant_id", t)).count ?? -1;
    const before = await count();
    const retired = await A.db.rpc("mrv_record_run", { p_tenant: t, p_facility: f1, p_run: { qa_overall: "PASS" }, p_reading_ids: [], p_document_ids: [], p_qa: [] });
    expect(retired.error).not.toBeNull();
    const retiredImp = await A.db.rpc("mrv_record_import", { p_tenant: t, p_facility: f1, p_batch: {}, p_readings: [], p_documents: [] });
    expect(retiredImp.error).not.toBeNull();

    const p = await plan(A.db, t, f1);
    const fake = JSON.parse(p.body);
    fake.results.calcRows.find((x: { Metric: string }) => x.Metric === "Total Embedded CO2").Value = 1;
    fake.results.calcRows.find((x: { Metric: string }) => x.Metric === "QA/QC Overall Status").Value = "PASS";
    const fakeBody = JSON.stringify(fake);
    const now = Math.floor(Date.now() / 1000);
    const cases: [string, Promise<{ error: unknown }>][] = [
      ["unsigned", Promise.resolve(rpc(A.db, "mrv_finalize_run", t, f1, p.body, null))],
      ["forged key", Promise.resolve(rpc(A.db, "mrv_finalize_run", t, f1, fakeBody, signExecutorRequest({ keyId: KEY.keyId, secret: Buffer.alloc(32, 7) }, "run", { userId: A.uid, tenantId: t, facilityId: f1 }, fakeBody)))],
      ["altered payload", Promise.resolve(rpc(A.db, "mrv_finalize_run", t, f1, fakeBody, sign(A.uid, "run", t, f1, p.body)))],
      ["expired", Promise.resolve(rpc(A.db, "mrv_finalize_run", t, f1, p.body, sign(A.uid, "run", t, f1, p.body, now - 600)))],
      ["cross-facility", Promise.resolve(rpc(A.db, "mrv_finalize_run", t, f2, p.body, sign(A.uid, "run", t, f1, p.body)))],
      ["other user with A's signature", Promise.resolve(rpc(B.db, "mrv_finalize_run", t, f1, p.body, sign(A.uid, "run", t, f1, p.body)))],
    ];
    for (const [label, call] of cases) expect((await call).error, label).not.toBeNull();
    // Replay: a signature that was accepted once (idempotent return of the existing run) cannot be used again.
    const once = sign(A.uid, "run", t, f1, p.body);
    expect((await rpc(A.db, "mrv_finalize_run", t, f1, p.body, once)).error).toBeNull();
    const replay = await rpc(A.db, "mrv_finalize_run", t, f1, p.body, once);
    expect(String((replay.error as { message?: string } | null)?.message)).toMatch(/already used/);
    expect(await count()).toBe(before);
  }, 120_000);

  it("cross-tenant isolation: B reads nothing of A and cannot import into A even with a valid signature", async () => {
    const sees = await B.db.from("activity_reading").select("id", { count: "exact", head: true }).eq("tenant_id", t);
    expect(sees.count ?? 0).toBe(0);
    const body = importBody({ id: crypto.randomUUID(), origin: "manual", status: "accepted", filename: null, sha256: null, size_bytes: null, mime: null, storage_path: null, errors: [], assertions: [], declared_period_start: null, declared_period_end: null, synthetic: true, mapping: MONTHLY, effective_from: null, effective_to: null, effective_basis: null }, [], []);
    const r = await rpc(B.db, "mrv_import_v2", t, f1, body, sign(B.uid, "import", t, f1, body));
    expect(r.error).not.toBeNull();
  });

  it.skipIf(!env.MRV_E2E_REVOKED_EMAIL)("a user whose role was revoked is rejected at execution time", async () => {
    const R = await login(env.MRV_E2E_REVOKED_EMAIL!, env.MRV_E2E_REVOKED_PASSWORD ?? "");
    const rt = env.MRV_E2E_REVOKED_TENANT!;
    const rf = env.MRV_E2E_REVOKED_FACILITY!;
    const body = importBody({ id: crypto.randomUUID(), origin: "manual", status: "accepted", filename: null, sha256: null, size_bytes: null, mime: null, storage_path: null, errors: [], assertions: [], declared_period_start: null, declared_period_end: null, synthetic: true, mapping: MONTHLY, effective_from: null, effective_to: null, effective_basis: null }, [], []);
    const r = await rpc(R.db, "mrv_import_v2", rt, rf, body, sign(R.uid, "import", rt, rf, body));
    expect(r.error).not.toBeNull();
  });
});
