import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { withTenant, type Principal } from "@/lib/server/authz/authorize";
import { badRequest, HttpError, isUuid } from "@/lib/server/authz/errors";
import { asUser } from "@/lib/server/db/context";
import type { Caller, ServerDeps } from "@/lib/server/deps";

/**
 * Foundation-level aggregation used to prove ownership propagation through background jobs.
 * NOT the authoritative MRV engine (lib/calcEngine.ts is not yet server-wired); results are labelled accordingly.
 */
export const FOUNDATION_ENGINE = "tenancy-foundation-aggregate-0";

export interface RunResults {
  engine: string;
  scope1_tco2: string | null;
  clinker_t: string | null;
  cement_t: string | null;
  transfers_in: { from_facility_id: string; material: string; tonnes: string; included_in_reported_output: boolean }[];
  missing: string[];
}

const REQUIRED: Record<string, keyof Pick<RunResults, "scope1_tco2" | "clinker_t" | "cement_t">> = {
  direct_emissions_tco2: "scope1_tco2",
  clinker_produced_t: "clinker_t",
  cement_produced_t: "cement_t",
};

export function enqueueCalculation({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown, body: { periodId?: unknown; idempotencyKey?: unknown }) {
  return withTenant(deps.db, principal, tenantId, "calculation.enqueue", async ({ sql, require, access, audit }) => {
    require(String(facilityId), "calculation.run");
    if (!isUuid(body.periodId) || typeof body.idempotencyKey !== "string" || !body.idempotencyKey) throw badRequest("periodId and idempotencyKey are required");
    const inserted = await sql.query<{ id: string }>(
      `INSERT INTO calculation_job (tenant_id, facility_id, period_id, requested_by, idempotency_key)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING id`,
      [access.tenantId, facilityId, body.periodId, principal.userId, body.idempotencyKey]
    );
    const id =
      inserted.rows[0]?.id ??
      (await sql.query<{ id: string }>("SELECT id FROM calculation_job WHERE tenant_id = $1 AND idempotency_key = $2", [access.tenantId, body.idempotencyKey])).rows[0]?.id;
    if (!id) throw badRequest("Idempotency key already used outside your scope");
    await audit("calculation.enqueue", `calculation_job:${id}`, String(facilityId));
    return { jobId: id };
  });
}

/**
 * Worker step. The claim reveals only (job, tenant, facility, requester). The work then runs under the requester's
 * *current* authorization — revoked access fails the job instead of running with stale privileges — and every row
 * written carries the job's tenant/facility, enforced by composite FKs.
 */
export async function runNextJob(deps: ServerDeps): Promise<{ jobId: string; status: "completed" | "failed"; runId?: string; error?: string } | null> {
  const claim = await asUser(deps.db, { userId: "", tenantId: null }, async (sql) => {
    const r = await sql.query<{ job_id: string; job_tenant_id: string; job_facility_id: string; job_requested_by: string }>("SELECT * FROM app.claim_next_job()");
    return r.rows[0] ?? null;
  });
  if (!claim) return null;

  const principal = await asUser(deps.db, { userId: claim.job_requested_by, tenantId: null }, async (sql) => {
    const r = await sql.query<{ id: string; email: string; display_name: string; is_platform_admin: boolean }>(
      "SELECT id, email, display_name, is_platform_admin FROM app_user WHERE id = $1 AND status = 'active'",
      [claim.job_requested_by]
    );
    const u = r.rows[0];
    return u ? ({ userId: u.id, email: u.email, displayName: u.display_name, isPlatformAdmin: u.is_platform_admin } satisfies Principal) : null;
  });

  const release = (error: string, retry: boolean) =>
    asUser(deps.db, { userId: "", tenantId: null }, (sql) => sql.query("SELECT app.release_job($1, $2, $3)", [claim.job_id, error, retry]));

  if (!principal) {
    await release("Requesting user is no longer active", false);
    return { jobId: claim.job_id, status: "failed", error: "Requesting user is no longer active" };
  }

  try {
    const runId = await withTenant(deps.db, principal, claim.job_tenant_id, "calculation.run", async ({ sql, require, access, audit }) => {
      require(claim.job_facility_id, "calculation.run");
      const job = await sql.query<{ period_id: string }>("SELECT period_id FROM calculation_job WHERE tenant_id = $1 AND id = $2", [access.tenantId, claim.job_id]);
      const periodId = job.rows[0].period_id;
      const records = await sql.query<{ id: string; activity_type: string; value: string | null; value_state: string; version: number }>(
        "SELECT id, activity_type, value::text AS value, value_state, version FROM activity_record WHERE tenant_id = $1 AND facility_id = $2 AND period_id = $3 ORDER BY id",
        [access.tenantId, claim.job_facility_id, periodId]
      );
      const transfers = await sql.query<{ counterparty_facility_id: string; material: string; quantity: string; included_in_reported_output: boolean }>(
        "SELECT counterparty_facility_id, material, quantity::text AS quantity, included_in_reported_output FROM inventory_movement WHERE tenant_id = $1 AND facility_id = $2 AND period_id = $3 AND movement = 'transfer_in'",
        [access.tenantId, claim.job_facility_id, periodId]
      );
      const results: RunResults = { engine: FOUNDATION_ENGINE, scope1_tco2: null, clinker_t: null, cement_t: null, transfers_in: [], missing: [] };
      for (const [type, key] of Object.entries(REQUIRED)) {
        const rows = records.rows.filter((r) => r.activity_type === type);
        // Missing is never zero: any missing/rejected row (or no rows) leaves the total null.
        if (!rows.length || rows.some((r) => r.value === null)) {
          results.missing.push(type);
          continue;
        }
        results[key] = rows.reduce((s, r) => s.plus(r.value as string), new Decimal(0)).toString();
      }
      results.transfers_in = transfers.rows.map((t) => ({
        from_facility_id: t.counterparty_facility_id,
        material: t.material,
        tonnes: t.quantity,
        included_in_reported_output: t.included_in_reported_output,
      }));
      const tenant = await sql.query<{ synthetic: boolean }>("SELECT synthetic FROM tenant WHERE id = $1", [access.tenantId]);
      const inputHash = createHash("sha256").update(JSON.stringify(records.rows)).digest("hex");
      const run = await sql.query<{ id: string }>(
        `INSERT INTO calculation_run (tenant_id, facility_id, period_id, job_id, engine_version, input_hash, results, synthetic)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [access.tenantId, claim.job_facility_id, periodId, claim.job_id, FOUNDATION_ENGINE, inputHash, JSON.stringify(results), tenant.rows[0]?.synthetic ?? false]
      );
      await sql.query("UPDATE calculation_job SET status = 'completed', finished_at = now(), error = NULL WHERE tenant_id = $1 AND id = $2", [access.tenantId, claim.job_id]);
      await audit("calculation.run", `calculation_run:${run.rows[0].id}`, claim.job_facility_id, { jobId: claim.job_id });
      return run.rows[0].id;
    });
    return { jobId: claim.job_id, status: "completed", runId };
  } catch (err) {
    const denied = err instanceof HttpError && (err.status === 403 || err.status === 404);
    const message = denied ? "Requester no longer authorized for this facility" : err instanceof Error ? err.message : String(err);
    await release(message, !denied);
    return { jobId: claim.job_id, status: "failed", error: message };
  }
}
