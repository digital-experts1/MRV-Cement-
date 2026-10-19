import { consolidate, type FacilityPeriodResult } from "@/lib/consolidation";
import { asOwner, asUser } from "@/lib/server/db/context";
import { S } from "@/lib/server/db/syntheticSeed";
import { runNextJob } from "@/lib/server/services/jobs";
import { issueSession } from "@/lib/server/session";
import { grantSupportAccess } from "@/lib/server/services/tenancy";
import { createScopeGuard, scopedCacheKey, scopedDraftKey } from "@/lib/tenancy/scopeKeys";
import { createIsolationEnv, type Check, type IsolationEnv } from "./harness";

/**
 * Supervisor Directive 03 — tenant isolation acceptance cases (SYNTHETIC Tenant A: A1+A2, Tenant B: B1).
 * Executed against a fresh in-process PostgreSQL (PGlite) with the real migration, RLS policies and the same
 * API dispatcher the Next.js route uses. Shared by Vitest (`npm test`) and the dev harness `/api/dev/isolation`.
 */

export interface IsolationCase {
  id: string;
  name: string;
  run(env: IsolationEnv, check: (label: string, pass: boolean, detail?: unknown) => void): Promise<void>;
}

export interface CaseResult {
  id: string;
  name: string;
  pass: boolean;
  checks: Check[];
  error?: string;
}

const A = S.tenantA;
const B = S.tenantB;

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const rows = (r: { json: unknown }) => (Array.isArray(r.json) ? (r.json as Record<string, unknown>[]) : []);

export const ISOLATION_CASES: IsolationCase[] = [
  {
    id: "T01",
    name: "Application DB role cannot bypass RLS; context is transaction-local",
    async run({ deps }, check) {
      const role = await asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) =>
        sql.query<{ u: string; rolsuper: boolean; rolbypassrls: boolean }>("SELECT current_user AS u, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
      );
      check("runs as trace_app", role.rows[0]?.u === "trace_app", role.rows[0]);
      check("trace_app is not superuser and has no BYPASSRLS", role.rows[0]?.rolsuper === false && role.rows[0]?.rolbypassrls === false);
      const noTenant = await asUser(deps.db, { userId: S.users.analystA, tenantId: null }, (sql) => sql.query<{ n: number }>("SELECT count(*)::int AS n FROM activity_record"));
      check("no tenant context → 0 activity rows visible", noTenant.rows[0].n === 0, noTenant.rows[0]);
      const inA = await asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) =>
        sql.query<{ total: number; foreign: number }>(`SELECT count(*)::int AS total, count(*) FILTER (WHERE tenant_id <> '${A}')::int AS "foreign" FROM activity_record`)
      );
      check("Tenant A context sees only Tenant A rows", inA.rows[0].total === 6 && inA.rows[0].foreign === 0, inA.rows[0]);
      const after = await deps.db.transaction((sql) => sql.query<{ u: string; t: string | null }>("SELECT current_user AS u, current_setting('app.tenant_id', true) AS t"));
      check("context does not leak to the next transaction on the same connection", after.rows[0].u !== "trace_app" && !after.rows[0].t, after.rows[0]);
      const tamperedCtx = await asUser(deps.db, { userId: S.users.analystA, tenantId: B }, (sql) => sql.query<{ n: number }>("SELECT count(*)::int AS n FROM activity_record"));
      check("A user with tenant context forced to B still sees 0 B rows (RLS checks membership)", tamperedCtx.rows[0].n === 0, tamperedCtx.rows[0]);
    },
  },
  {
    id: "T02",
    name: "Tenant A cannot list, read, edit or export Tenant B records",
    async run({ api, seed, deps }, check) {
      check("list B facilities → 404", (await api("adminA", "GET", `/tenants/${B}/facilities`)).status === 404);
      check("list B1 activity → 404", (await api("analystA", "GET", `/tenants/${B}/facilities/${S.facB1}/activity-records`)).status === 404);
      check("read B record via B path → 404", (await api("analystA", "GET", `/tenants/${B}/activity-records/${seed.records.B1}`)).status === 404);
      check("read B record via own tenant path → 404", (await api("analystA", "GET", `/tenants/${A}/activity-records/${seed.records.B1}`)).status === 404);
      const patch = await api("analystA", "PATCH", `/tenants/${A}/activity-records/${seed.records.B1}`, { value: "1", valueState: "present", version: 1 });
      check("edit B record → 404", patch.status === 404, patch.status);
      const bView = await api("adminB", "GET", `/tenants/${B}/activity-records/${seed.records.B1}`);
      check("B record unchanged", (bView.json as { value: string; version: number }).value === "150000" && (bView.json as { version: number }).version === 1, bView.json);
      check("export B report via B path → 404", (await api("analystA", "GET", `/tenants/${B}/reports/${seed.reports.B1}/export`)).status === 404);
      check("export B report via A path → 404", (await api("analystA", "GET", `/tenants/${A}/reports/${seed.reports.B1}/export`)).status === 404);
      check("list B evidence → 404", (await api("analystA", "GET", `/tenants/${B}/facilities/${S.facB1}/evidence`)).status === 404);
      const upd = await asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) =>
        sql.query("UPDATE activity_record SET value = 1 WHERE id = $1", [seed.records.B1])
      );
      check("direct SQL update of B row under A context affects 0 rows", (upd.affectedRows ?? 0) === 0, upd.affectedRows);
    },
  },
  {
    id: "T03",
    name: "Guessed IDs and tampered request parameters do not bypass access",
    async run({ api, deps }, check) {
      const smuggle = await api("mgrA1", "POST", `/tenants/${A}/facilities/${S.facA1}/activity-records`, {
        periodId: S.periodA1, domain: "production", activityType: "clinker_produced_t", value: "1", unit: "t", valueState: "present", tenant_id: B,
      });
      check("body tenant_id is rejected (400)", smuggle.status === 400, smuggle.json);
      const foreignPeriod = await api("mgrA1", "POST", `/tenants/${A}/facilities/${S.facA1}/activity-records`, {
        periodId: S.periodB1, domain: "production", activityType: "clinker_produced_t", value: "1", unit: "t", valueState: "present",
      });
      check("period of another tenant is rejected by composite FK (400)", foreignPeriod.status === 400, foreignPeriod.json);
      const qp = await api("mgrA1", "GET", `/tenants/${A}/facilities/${S.facA1}/activity-records?tenantId=${B}&facilityId=${S.facB1}`);
      check("query-string tenantId is ignored; only A1 rows returned", qp.status === 200 && rows(qp).every((r) => r.tenant_id === A && r.facility_id === S.facA1) && rows(qp).length > 0);
      for (const bad of ["1%20OR%201=1", "..", "00000000-0000-4000-8000-000000000999"]) {
        check(`malformed/unknown tenant id "${bad}" → 404`, (await api("adminA", "GET", `/tenants/${bad}/facilities`)).status === 404);
      }
      const bCount = await asOwner(deps.db, (sql) => sql.query<{ n: number }>("SELECT count(*)::int AS n FROM activity_record WHERE tenant_id = $1", [B]));
      check("no rows were created in Tenant B", bCount.rows[0].n === 3, bCount.rows[0]);
    },
  },
  {
    id: "T04",
    name: "User assigned to one factory cannot access the other factory",
    async run({ api, deps }, check) {
      const fac = await api("mgrA1", "GET", `/tenants/${A}/facilities`);
      const list = (fac.json as { facilities: { id: string }[] }).facilities;
      check("facility list contains only A1", list.length === 1 && list[0].id === S.facA1, list);
      check("A2 activity list → 404", (await api("mgrA1", "GET", `/tenants/${A}/facilities/${S.facA2}/activity-records`)).status === 404);
      const a2 = await api("analystA", "GET", `/tenants/${A}/facilities/${S.facA2}/activity-records`);
      const a2Id = rows(a2)[0]?.id as string;
      check("read A2 record by id → 404", (await api("mgrA1", "GET", `/tenants/${A}/activity-records/${a2Id}`)).status === 404);
      const create = await api("mgrA1", "POST", `/tenants/${A}/facilities/${S.facA2}/activity-records`, {
        periodId: S.periodA2, domain: "production", activityType: "x", value: "1", unit: "t", valueState: "present",
      });
      check("create in A2 → 404", create.status === 404);
      const sqlCount = await asUser(deps.db, { userId: S.users.mgrA1, tenantId: A }, (sql) =>
        sql.query<{ n: number }>("SELECT count(*)::int AS n FROM activity_record WHERE facility_id = $1", [S.facA2])
      );
      check("RLS hides A2 rows from A1-only user in direct SQL", sqlCount.rows[0].n === 0);
      const prod = await api("prodA2", "POST", `/tenants/${A}/facilities/${S.facA2}/activity-records`, {
        periodId: S.periodA2, domain: "production", activityType: "gypsum_consumed_t", value: "1200", unit: "t", valueState: "present",
      });
      check("production contributor can add production data at A2", prod.status === 200, prod.json);
      const util = await api("prodA2", "POST", `/tenants/${A}/facilities/${S.facA2}/activity-records`, {
        periodId: S.periodA2, domain: "utilities", activityType: "electricity_mwh", value: "10", unit: "MWh", valueState: "present",
      });
      check("production contributor cannot add utilities data (403)", util.status === 403);
    },
  },
  {
    id: "T05",
    name: "Direct API calls enforce the same rules as the UI",
    async run({ api }, check) {
      check("no session → 401", (await api(null, "GET", "/me")).status === 401);
      check("forged session cookie → 401", (await api(null, "GET", `/tenants/${A}/facilities`, undefined, { cookie: "trace_session=forged-token" })).status === 401);
      const xo = await api("mgrA1", "POST", `/tenants/${A}/facilities/${S.facA1}/calculations`, { periodId: S.periodA1, idempotencyKey: "xo" }, { headers: { origin: "https://evil.example" } });
      check("cross-origin state change → 403", xo.status === 403);
      check("membership without roles grants nothing (404)", (await api("memberOnlyA", "GET", `/tenants/${A}/facilities`)).status === 404);
      const me = await api("multi", "GET", "/me");
      check("multi-org user sees both memberships", (me.json as { memberships: unknown[] }).memberships.length === 2, me.json);
    },
  },
  {
    id: "T06",
    name: "Evidence download URLs enforce scope, user binding and expiry",
    async run({ api, seed, deps }, check) {
      const issued = await api("analystA", "POST", `/tenants/${A}/evidence/${seed.evidence.A1}/download-url`);
      const url = (issued.json as { url: string }).url;
      check("analyst A gets a signed URL for A1 evidence", issued.status === 200 && typeof url === "string");
      const path = url.replace("/api/v1", "");
      const ok = await api("analystA", "GET", path);
      check("issuing user can download", ok.status === 200 && ok.text.includes("Tenant A"), ok.status);
      check("Tenant B admin with the same URL → 403", (await api("adminB", "GET", path)).status === 403);
      check("another Tenant A user with the URL → 403", (await api("mgrA1", "GET", path)).status === 403);
      const token = decodeURIComponent(path.split("/").pop()!);
      const tampered = token[0] === "a" ? "b" + token.slice(1) : "a" + token.slice(1);
      check("tampered token → 403", (await api("analystA", "GET", `/downloads/${encodeURIComponent(tampered)}`)).status === 403);
      const expired = deps.signer.issue({ kind: "evidence", tenantId: A, facilityId: S.facA1, objectId: seed.evidence.A1, userId: S.users.analystA }, 60, Date.now() - 3600_000);
      check("expired token → 403", (await api("analystA", "GET", `/downloads/${encodeURIComponent(expired)}`)).status === 403);
      const forged = deps.signer.issue({ kind: "evidence", tenantId: B, facilityId: S.facB1, objectId: seed.evidence.B1, userId: S.users.analystA });
      check("validly signed token for B evidence still denied by authorization (404)", (await api("analystA", "GET", `/downloads/${encodeURIComponent(forged)}`)).status === 404);
      check("URL for B evidence via A path → 404", (await api("analystA", "POST", `/tenants/${A}/evidence/${seed.evidence.B1}/download-url`)).status === 404);
      check("A1-only user cannot get URL for A2 evidence → 404", (await api("mgrA1", "POST", `/tenants/${A}/evidence/${seed.evidence.A2}/download-url`)).status === 404);
      const keys = await asOwner(deps.db, (sql) => sql.query<{ ok: boolean }>("SELECT bool_and(storage_key LIKE 'tenants/' || tenant_id || '/facilities/' || facility_id || '/%') AS ok FROM evidence"));
      check("all storage keys are namespaced by tenant and facility", keys.rows[0].ok === true);
    },
  },
  {
    id: "T07",
    name: "Report export URLs enforce scope",
    async run({ api, seed }, check) {
      const own = await api("analystA", "GET", `/tenants/${A}/reports/${seed.reports.A1}/export`);
      check("analyst A exports A1 report", own.status === 200 && (own.json as { synthetic: boolean }).synthetic === true);
      check("A1-only manager cannot export A2 report → 404", (await api("mgrA1", "GET", `/tenants/${A}/reports/${seed.reports.A2}/export`)).status === 404);
      check("Tenant B admin cannot export A1 report → 404", (await api("adminB", "GET", `/tenants/${A}/reports/${seed.reports.A1}/export`)).status === 404);
      check("Tenant B admin cannot export A1 report via B path → 404", (await api("adminB", "GET", `/tenants/${B}/reports/${seed.reports.A1}/export`)).status === 404);
      check("contributor without report.export → 403", (await api("prodA2", "GET", `/tenants/${A}/reports/${seed.reports.A2}/export`)).status === 403);
    },
  },
  {
    id: "T08",
    name: "Background jobs preserve ownership and re-check access on execution/retry",
    async run(env, check) {
      const { api, deps, seed } = env;
      const job = await api("mgrA1", "POST", `/tenants/${A}/facilities/${S.facA1}/calculations`, { periodId: S.periodA1, idempotencyKey: "shared-key" });
      const jobB = await api("adminB", "POST", `/tenants/${B}/facilities/${S.facB1}/calculations`, { periodId: S.periodB1, idempotencyKey: "shared-key" });
      const jobA = (job.json as { jobId: string }).jobId;
      check("same idempotency key in two tenants creates two independent jobs", job.status === 200 && jobB.status === 200 && jobA !== (jobB.json as { jobId: string }).jobId);
      const r1 = await runNextJob(deps);
      const r2 = await runNextJob(deps);
      const results = [r1, r2];
      check("both jobs completed", results.every((r) => r?.status === "completed"), results);
      const owned = await asOwner(deps.db, (sql) =>
        sql.query<{ ok: boolean }>("SELECT bool_and(r.tenant_id = j.tenant_id AND r.facility_id = j.facility_id AND r.period_id = j.period_id) AS ok FROM calculation_run r JOIN calculation_job j ON j.id = r.job_id")
      );
      check("every run carries its job's tenant, facility and period", owned.rows[0].ok === true);
      const crossErr = await rejects(() =>
        asOwner(deps.db, (sql) =>
          sql.query("INSERT INTO calculation_run (tenant_id, facility_id, period_id, job_id, engine_version, input_hash, results) VALUES ($1, $2, $3, $4, 'x', 'x', '{}')", [B, S.facB1, S.periodB1, jobA])
        )
      );
      check("run in Tenant B referencing Tenant A job is rejected by FK", !!crossErr && /foreign key/i.test(crossErr), crossErr);

      const pending = await api("mgrA1", "POST", `/tenants/${A}/facilities/${S.facA1}/calculations`, { periodId: S.periodA1, idempotencyKey: "revoke-before-run" });
      const members = await api("adminA", "GET", `/tenants/${A}/members`);
      const mgr = rows(members).find((m) => m.user_id === S.users.mgrA1) as { membership_id: string; assignments: { id: string }[] };
      await api("adminA", "DELETE", `/tenants/${A}/role-assignments/${mgr.assignments[0].id}`);
      const r3 = await runNextJob(deps);
      check("job queued before revocation fails after revocation", r3?.jobId === (pending.json as { jobId: string }).jobId && r3?.status === "failed", r3);
      const noRun = await asOwner(deps.db, (sql) => sql.query<{ n: number }>("SELECT count(*)::int AS n FROM calculation_run WHERE job_id = $1", [r3?.jobId]));
      check("no run was produced for the revoked requester", noRun.rows[0].n === 0);
      const regrant = await api("adminA", "POST", `/tenants/${A}/role-assignments`, { membershipId: mgr.membership_id, role: "facility_manager", facilityId: S.facA1 });
      check("access restored for later cases", regrant.status === 200);
      void seed;
    },
  },
  {
    id: "T09",
    name: "AI retrieval cannot reach another tenant's documents; model cannot set scope",
    async run({ api, deps }, check) {
      const a = await api("analystA", "POST", `/tenants/${A}/facilities/${S.facA1}/ai/search`, { query: "kiln" });
      check("A retrieval returns only A1 documents", a.status === 200 && rows(a).length > 0 && rows(a).every((d) => d.tenant_id === A && d.facility_id === S.facA1), a.json);
      check("no Tenant B text in A results", !a.text.includes("TENANT-B-CONFIDENTIAL"));
      const b = await api("analystB", "POST", `/tenants/${B}/facilities/${S.facB1}/ai/search`, { query: "kiln" });
      check("the same query in Tenant B finds B's document (control)", b.status === 200 && b.text.includes("TENANT-B-CONFIDENTIAL"));
      const leak = await api("analystA", "POST", `/tenants/${A}/facilities/${S.facA1}/ai/search`, { query: "TENANT-B-CONFIDENTIAL" });
      check("searching for B's text from A returns nothing", leak.status === 200 && rows(leak).length === 0);
      for (const key of ["tenant_id", "tenantId", "facility_id", "facilityId"]) {
        const r = await api("analystA", "POST", `/tenants/${A}/facilities/${S.facA1}/ai/search`, { query: "kiln", [key]: key.startsWith("t") ? B : S.facB1 });
        check(`model-supplied ${key} is rejected (400)`, r.status === 400);
      }
      check("A analyst targeting B route → 404", (await api("analystA", "POST", `/tenants/${B}/facilities/${S.facB1}/ai/search`, { query: "kiln" })).status === 404);
      const stored = await asOwner(deps.db, (sql) =>
        sql.query<{ ok: boolean }>(`SELECT bool_and(NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id = ANY(a.retrieved_evidence_ids) AND e.tenant_id <> a.tenant_id)) AS ok FROM ai_assessment a`)
      );
      check("stored AI assessments reference only same-tenant evidence", stored.rows[0].ok === true);
    },
  },
  {
    id: "T10",
    name: "Organization/factory switching cannot surface cached or draft data",
    async run(_env, check) {
      const base = { userId: S.users.multi, tenantId: A, facilityId: S.facA2, periodId: S.periodA2 };
      const keys = new Set([
        scopedDraftKey(base),
        scopedDraftKey({ ...base, tenantId: B, facilityId: S.facB1, periodId: S.periodB1 }),
        scopedDraftKey({ ...base, facilityId: S.facA1 }),
        scopedDraftKey({ ...base, periodId: S.periodA1Prev }),
        scopedDraftKey({ ...base, userId: S.users.analystA }),
      ]);
      check("draft keys differ for every user/org/factory/period combination", keys.size === 5);
      check("cache keys include the full scope", scopedCacheKey(base, "x") !== scopedCacheKey({ ...base, tenantId: B }, "x"));
      const guard = createScopeGuard();
      const before = guard.next();
      guard.next(); // user switches factory while the first request is in flight
      check("late response from previous factory is discarded", !guard.isCurrent(before));
    },
  },
  {
    id: "T11",
    name: "Revoked membership and revoked sessions are denied on the next request",
    async run(env, check) {
      const { api, seed } = env;
      check("consultant can read Tenant B before revocation", (await api("multi", "GET", `/tenants/${B}/facilities`)).status === 200);
      const url = (await api("multi", "POST", `/tenants/${B}/evidence/${seed.evidence.B1}/download-url`)).json as { url: string };
      const revoke = await api("adminB", "DELETE", `/tenants/${B}/members/00000000-0000-4000-8000-000000005202`);
      check("Tenant B admin revokes consultant membership", revoke.status === 200, revoke.json);
      check("consultant → Tenant B now 404", (await api("multi", "GET", `/tenants/${B}/facilities`)).status === 404);
      check("previously issued B download URL now denied", (await api("multi", "GET", url.url.replace("/api/v1", ""))).status === 404);
      check("consultant keeps Tenant A (A2) access", (await api("multi", "GET", `/tenants/${A}/facilities`)).status === 200);
      check("Tenant A admin cannot revoke Tenant B membership", (await api("adminA", "DELETE", `/tenants/${A}/members/00000000-0000-4000-8000-000000005101`)).status === 404);
      // A separate session (not the harness's cached one) so later cases keep a valid analystB session.
      const cookie = `trace_session=${encodeURIComponent(await issueSession(env.deps.db, S.users.analystB))}`;
      check("session valid before logout", (await api(null, "GET", "/me", undefined, { cookie })).status === 200);
      await api(null, "POST", "/auth/logout", undefined, { cookie });
      check("revoked session → 401 on the next request", (await api(null, "GET", `/tenants/${B}/facilities`, undefined, { cookie })).status === 401);
    },
  },
  {
    id: "T12",
    name: "Cross-tenant foreign-key associations are rejected by the database",
    async run({ deps, seed, api }, check) {
      const attempts: [string, string, unknown[]][] = [
        ["activity in A pointing at B facility", "INSERT INTO activity_record (tenant_id, facility_id, period_id, domain, activity_type, value, unit, value_state, created_by) VALUES ($1, $2, $3, 'production', 'x', 1, 't', 'present', $4)", [A, S.facB1, S.periodB1, S.users.adminA]],
        ["activity in A1 pointing at B period", "INSERT INTO activity_record (tenant_id, facility_id, period_id, domain, activity_type, value, unit, value_state, created_by) VALUES ($1, $2, $3, 'production', 'x', 1, 't', 'present', $4)", [A, S.facA1, S.periodB1, S.users.adminA]],
        ["activity in A1 pointing at A2 period", "INSERT INTO activity_record (tenant_id, facility_id, period_id, domain, activity_type, value, unit, value_state, created_by) VALUES ($1, $2, $3, 'production', 'x', 1, 't', 'present', $4)", [A, S.facA1, S.periodA2, S.users.adminA]],
        ["A evidence link to B evidence", "INSERT INTO evidence_link (tenant_id, facility_id, evidence_id, activity_record_id) VALUES ($1, $2, $3, $4)", [A, S.facA1, seed.evidence.B1, seed.records.A1]],
        ["A report on B run", "INSERT INTO report (tenant_id, facility_id, period_id, run_id, kind, content, sha256) VALUES ($1, $2, $3, $4, 'internal_pdf', '{}', 'x')", [A, S.facA1, S.periodA1, seed.runs.B1]],
        ["A role assignment on B membership", "INSERT INTO facility_role_assignment (tenant_id, membership_id, role, scope_type) VALUES ($1, '00000000-0000-4000-8000-000000005101', 'reviewer', 'tenant')", [A]],
        ["A role assignment scoped to B facility", "INSERT INTO facility_role_assignment (tenant_id, membership_id, role, scope_type, facility_id) VALUES ($1, '00000000-0000-4000-8000-000000005003', 'reviewer', 'facility', $2)", [A, S.facB1]],
        ["A transfer with B counterparty", "INSERT INTO inventory_movement (tenant_id, facility_id, period_id, material, movement, quantity, unit, counterparty_facility_id, created_by) VALUES ($1, $2, $3, 'clinker', 'transfer_out', 1, 't', $4, $5)", [A, S.facA1, S.periodA1, S.facB1, S.users.adminA]],
        ["moving an A record to B", "UPDATE activity_record SET tenant_id = $1, facility_id = $2, period_id = $3 WHERE id = $4", [B, S.facB1, S.periodB1, seed.records.A1]],
      ];
      for (const [label, text, params] of attempts) {
        const err = await rejects(() => asOwner(deps.db, (sql) => sql.query(text, params)));
        check(`${label} → rejected even as DB owner`, !!err, err);
      }
      const api400 = await api("adminA", "POST", `/tenants/${A}/role-assignments`, { membershipId: "00000000-0000-4000-8000-000000005101", role: "reviewer" });
      check("admin API cannot attach a role to another tenant's membership", api400.status === 400, api400.json);
    },
  },
  {
    id: "T13",
    name: "Identical import files in different tenants do not reveal each other",
    async run({ api }, check) {
      const bytes = new TextEncoder().encode("SYNTHETIC identical workbook bytes v1");
      const up = (user: "mgrA1" | "adminB", t: string, f: string, p: string) => api(user, "POST", `/tenants/${t}/facilities/${f}/uploads?periodId=${p}&filename=q1.xlsx`, undefined, { raw: bytes });
      const a1 = await up("mgrA1", A, S.facA1, S.periodA1);
      const b1 = await up("adminB", B, S.facB1, S.periodB1);
      const ja = a1.json as { uploadId: string; duplicate: boolean };
      const jb = b1.json as { uploadId: string; duplicate: boolean };
      check("both uploads accepted as new in their own tenant", a1.status === 200 && b1.status === 200 && !ja.duplicate && !jb.duplicate, [a1.json, b1.json]);
      check("distinct upload ids", ja.uploadId !== jb.uploadId);
      const b2 = await up("adminB", B, S.facB1, S.periodB1);
      check("B re-upload dedupes to B's own id only", (b2.json as { uploadId: string }).uploadId === jb.uploadId && !b2.text.includes(ja.uploadId));
      const la = await api("mgrA1", "GET", `/tenants/${A}/facilities/${S.facA1}/uploads`);
      const lb = await api("adminB", "GET", `/tenants/${B}/facilities/${S.facB1}/uploads`);
      check("each tenant lists only its own upload", rows(la).every((u) => u.id !== jb.uploadId) && rows(lb).every((u) => u.id !== ja.uploadId) && rows(la).length === 1 && rows(lb).length === 1);
    },
  },
  {
    id: "T14",
    name: "Approved reports remain isolated and immutable; approval needs the approver role",
    async run({ api, deps, seed }, check) {
      const exp = await api("approverA", "GET", `/tenants/${A}/reports/${seed.reports.A1}/export`);
      check("A1 report is approved", (exp.json as { status: string }).status === "approved");
      const appErr = await rejects(() => asUser(deps.db, { userId: S.users.approverA, tenantId: A }, (sql) => sql.query("UPDATE report SET status = 'draft' WHERE id = $1", [seed.reports.A1])));
      check("app role cannot modify an approved report", !!appErr && /immutable/.test(appErr), appErr);
      const ownerErr = await rejects(() => asOwner(deps.db, (sql) => sql.query("UPDATE report SET content = '{}' WHERE id = $1", [seed.reports.A1])));
      check("even the DB owner cannot modify an approved report (trigger)", !!ownerErr && /immutable/.test(ownerErr), ownerErr);
      const delErr = await rejects(() => asOwner(deps.db, (sql) => sql.query("DELETE FROM report WHERE id = $1", [seed.reports.A1])));
      check("approved report cannot be deleted", !!delErr, delErr);
      const apprErr = await rejects(() => asOwner(deps.db, (sql) => sql.query("UPDATE approval SET comment = 'x'")));
      check("approval history is append-only", !!apprErr, apprErr);
      check("Tenant B approver cannot read A1 report", (await api("approverB", "GET", `/tenants/${A}/reports/${seed.reports.A1}/export`)).status === 404);

      const submit = await asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) =>
        sql.query("UPDATE report SET status = 'submitted', submitted_by = $2 WHERE id = $1", [seed.reports.A2, S.users.analystA])
      );
      check("A2 report submitted by analyst", submit.affectedRows === 1);
      const sodErr = await rejects(() => asOwner(deps.db, (sql) => sql.query("UPDATE report SET status = 'approved', approved_by = submitted_by, approved_at = now() WHERE id = $1", [seed.reports.A2])));
      check("DB CHECK forbids submitter self-approval", !!sodErr, sodErr);
      check("member without roles cannot approve (404)", (await api("memberOnlyA", "POST", `/tenants/${A}/reports/${seed.reports.A2}/approve`)).status === 404);
      check("tenant admin cannot approve (403)", (await api("adminA", "POST", `/tenants/${A}/reports/${seed.reports.A2}/approve`)).status === 403);
      check("reviewer cannot approve (403)", (await api("reviewerA", "POST", `/tenants/${A}/reports/${seed.reports.A2}/approve`)).status === 403);
      check("Tenant B approver cannot approve A2 (404)", (await api("approverB", "POST", `/tenants/${A}/reports/${seed.reports.A2}/approve`)).status === 404);
      check("Tenant A approver approves A2", (await api("approverA", "POST", `/tenants/${A}/reports/${seed.reports.A2}/approve`)).status === 200);
    },
  },
  {
    id: "T15",
    name: "Platform administration grants no routine access; support access is explicit, read-only and audited",
    async run(env, check) {
      const { api, deps } = env;
      const me = await api("platform", "GET", "/me");
      check("platform admin has no memberships", (me.json as { memberships: unknown[] }).memberships.length === 0);
      check("platform admin → Tenant A 404 without grant", (await api("platform", "GET", `/tenants/${A}/facilities`)).status === 404);
      await grantSupportAccess(env.caller("adminA"), A, { platformAdminId: S.users.platform, reason: "Synthetic support ticket #1 (isolation test)", hours: 1 });
      const fac = await api("platform", "GET", `/tenants/${A}/facilities`);
      const perms = (fac.json as { via: string; facilities: { permissions: string[] }[] });
      check("with explicit grant: read access via 'support'", fac.status === 200 && perms.via === "support", fac.json);
      check("support permissions are read-only", perms.facilities.every((f) => f.permissions.every((p) => ["facility.read", "evidence.read", "report.read"].includes(p))));
      const write = await api("platform", "POST", `/tenants/${A}/facilities/${S.facA1}/activity-records`, {
        periodId: S.periodA1, domain: "production", activityType: "x", value: "1", unit: "t", valueState: "present",
      });
      check("support cannot write (403)", write.status === 403);
      const rlsWrite = await rejects(() =>
        asUser(deps.db, { userId: S.users.platform, tenantId: A }, (sql) =>
          sql.query("INSERT INTO activity_record (tenant_id, facility_id, period_id, domain, activity_type, value, unit, value_state, created_by) VALUES ($1, $2, $3, 'production', 'x', 1, 't', 'present', $4)", [A, S.facA1, S.periodA1, S.users.platform])
        )
      );
      check("RLS also blocks support writes", !!rlsWrite && /row-level security/i.test(rlsWrite), rlsWrite);
      check("grant does not extend to Tenant B", (await api("platform", "GET", `/tenants/${B}/facilities`)).status === 404);
      const audit = await api("adminA", "GET", `/tenants/${A}/audit-log`);
      check("support access is recorded in Tenant A's audit log", rows(audit).some((r) => r.via === "support" && String(r.action).startsWith("support:")));
    },
  },
  {
    id: "T16",
    name: "Audit logs are tenant-isolated",
    async run({ api }, check) {
      const a = await api("adminA", "GET", `/tenants/${A}/audit-log`);
      const b = await api("adminB", "GET", `/tenants/${B}/audit-log`);
      check("A admin sees only Tenant A entries", rows(a).length > 0 && rows(a).every((r) => r.tenant_id === A));
      check("B admin sees only Tenant B entries", rows(b).length > 0 && rows(b).every((r) => r.tenant_id === B));
      check("facility manager without audit.read → 403", (await api("mgrA1", "GET", `/tenants/${A}/audit-log`)).status === 403);
      check("A admin cannot read B audit log → 404", (await api("adminA", "GET", `/tenants/${B}/audit-log`)).status === 404);
    },
  },
  {
    id: "T17",
    name: "Shared factor catalog is read-only; tenant overrides are versioned and isolated",
    async run({ deps }, check) {
      const cat = await asOwner(deps.db, (sql) => sql.query<{ id: string }>("SELECT id FROM ref.factor_catalog WHERE code = 'CLINKER_EF' AND version = 1"));
      const catalogId = cat.rows[0].id;
      await asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) =>
        sql.query("INSERT INTO factor_override (tenant_id, factor_code, version, base_catalog_id, value, unit, justification, created_by) VALUES ($1, 'CLINKER_EF', 1, $2, 0.51, 'tCO2/t clinker', 'Synthetic plant-specific analysis', $3)", [A, catalogId, S.users.analystA])
      );
      const bView = await asUser(deps.db, { userId: S.users.analystB, tenantId: B }, async (sql) => ({
        overrides: (await sql.query<{ n: number }>("SELECT count(*)::int AS n FROM factor_override")).rows[0].n,
        catalog: (await sql.query<{ v: string }>("SELECT value::text AS v FROM ref.factor_catalog WHERE id = $1", [catalogId])).rows[0].v,
      }));
      check("Tenant B sees no Tenant A override", bView.overrides === 0, bView);
      check("Tenant B still sees the unmodified catalog value", bView.catalog === "0.525", bView);
      const catErr = await rejects(() => asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) => sql.query("UPDATE ref.factor_catalog SET value = 0.4")));
      check("tenants cannot modify the shared catalog", !!catErr && /permission denied/i.test(catErr), catErr);
      const ovErr = await rejects(() => asOwner(deps.db, (sql) => sql.query("UPDATE factor_override SET value = 0.1")));
      check("overrides are append-only (new version required)", !!ovErr, ovErr);
      const foreign = await rejects(() =>
        asUser(deps.db, { userId: S.users.analystA, tenantId: A }, (sql) =>
          sql.query("INSERT INTO factor_override (tenant_id, factor_code, version, base_catalog_id, value, unit, justification, created_by) VALUES ($1, 'CLINKER_EF', 9, $2, 0.1, 't', 'x', $3)", [B, catalogId, S.users.analystA])
        )
      );
      check("A user cannot write an override into Tenant B", !!foreign && /row-level security/i.test(foreign), foreign);
    },
  },
  {
    id: "T18",
    name: "Portfolio uses only authorized factories and sums (never averages) intensities",
    async run({ api }, check) {
      const q = `/tenants/${A}/portfolio?start=2026-01-01&end=2026-03-31`;
      const p = (await api("analystA", "GET", q)).json as {
        authorizedFacilityCount: number;
        clinker: { consolidatedIntensity: string; totalScope1Tco2: string; totalDenominatorT: string };
        cement: { consolidatedIntensity: string; totalDenominatorT: string; excludedInternalTransfersT: string; facilities: { intensity: string }[] };
      };
      check("analyst sees both A factories", p.authorizedFacilityCount === 2);
      check("clinker: 54,000 tCO2 / 100,000 t = 0.54", p.clinker.totalScope1Tco2 === "54000" && p.clinker.totalDenominatorT === "100000" && p.clinker.consolidatedIntensity === "0.54", p.clinker);
      check("cement: internal transfer of 5,000 t removed (175,000 t)", p.cement.totalDenominatorT === "175000" && p.cement.excludedInternalTransfersT === "5000", p.cement);
      const avg = p.cement.facilities.reduce((s, f) => s + Number(f.intensity), 0) / p.cement.facilities.length;
      check("consolidated cement intensity ≠ average of facility intensities", Math.abs(Number(p.cement.consolidatedIntensity) - 54000 / 175000) < 1e-12 && Math.abs(avg - Number(p.cement.consolidatedIntensity)) > 0.01, { consolidated: p.cement.consolidatedIntensity, naiveAverage: avg });
      const mgr = (await api("mgrA1", "GET", q)).json as { authorizedFacilityCount: number; clinker: { facilities: { facilityId: string }[] } };
      check("A1-only manager portfolio contains only A1", mgr.authorizedFacilityCount === 1 && mgr.clinker.facilities.every((f) => f.facilityId === S.facA1));
      check("Tenant B user cannot read Tenant A portfolio", (await api("analystB", "GET", q)).status === 404);
      const base: FacilityPeriodResult = { facilityId: "x", facilityName: "X", reportingBoundary: "", periodStart: "2026-01-01", periodEnd: "2026-03-31", synthetic: true, scope1Tco2: "10", clinkerT: "20", cementT: "30", transfersIn: [] };
      const mixed = consolidate([base, { ...base, facilityId: "y", facilityName: "Y", periodEnd: "2026-06-30" }], "clinker");
      check("different intervals → consolidation withheld", mixed.consolidatedIntensity === null && mixed.withheldReasons.length > 0);
      const missing = consolidate([base, { ...base, facilityId: "y", facilityName: "Y", scope1Tco2: null }], "clinker");
      check("missing facility data → consolidation withheld (never zero)", missing.consolidatedIntensity === null);
    },
  },
];

export async function runIsolationSuite(): Promise<{ results: CaseResult[]; passed: number; failed: number; checks: number }> {
  const env = await createIsolationEnv();
  const results: CaseResult[] = [];
  try {
    for (const c of ISOLATION_CASES) {
      const checks: Check[] = [];
      const check = (label: string, pass: boolean, detail?: unknown) =>
        checks.push({ label, pass, detail: pass || detail === undefined ? undefined : JSON.stringify(detail).slice(0, 400) });
      let error: string | undefined;
      try {
        await c.run(env, check);
      } catch (e) {
        error = e instanceof Error ? `${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}` : String(e);
      }
      results.push({ id: c.id, name: c.name, checks, error, pass: !error && checks.length > 0 && checks.every((x) => x.pass) });
    }
  } finally {
    await env.deps.db.close();
  }
  return {
    results,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    checks: results.reduce((n, r) => n + r.checks.length, 0),
  };
}
