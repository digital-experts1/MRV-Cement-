import { withTenant } from "@/lib/server/authz/authorize";
import { badRequest } from "@/lib/server/authz/errors";
import type { Caller } from "@/lib/server/deps";
import type { RunResults } from "@/lib/server/services/jobs";
import { consolidate, type FacilityPeriodResult } from "@/lib/consolidation";
import { toIsoDate } from "@/lib/dates";

/** Tenant-level view across the caller's authorized facilities only (report.read at each facility). */
export function getPortfolio({ deps, principal }: Caller, tenantId: unknown, query: { start?: unknown; end?: unknown }) {
  return withTenant(deps.db, principal, tenantId, "portfolio.read", async ({ sql, access }) => {
    const start = toIsoDate(query.start);
    const end = toIsoDate(query.end);
    if (!start || !end) throw badRequest("start and end (YYYY-MM-DD) are required");
    const authorized = [...access.facilities].filter(([, perms]) => perms.has("report.read")).map(([id]) => id);
    const rows = await sql.query<{
      facility_id: string; name: string; reporting_boundary: string; start_date: string; end_date: string; results: RunResults | null; synthetic: boolean | null;
    }>(
      `SELECT f.id AS facility_id, f.name, f.reporting_boundary, p.start_date::text AS start_date, p.end_date::text AS end_date,
              r.results, r.synthetic
       FROM facility f
       LEFT JOIN reporting_period p ON p.tenant_id = f.tenant_id AND p.facility_id = f.id AND p.start_date = $2 AND p.end_date = $3
       LEFT JOIN LATERAL (
         SELECT results, synthetic FROM calculation_run c
         WHERE c.tenant_id = f.tenant_id AND c.facility_id = f.id AND c.period_id = p.id ORDER BY c.created_at DESC, c.id LIMIT 1
       ) r ON true
       WHERE f.tenant_id = $1 AND f.id = ANY($4::uuid[]) ORDER BY f.code`,
      [access.tenantId, start, end, authorized]
    );
    const included: FacilityPeriodResult[] = [];
    const notIncluded: { facilityId: string; facilityName: string; reason: string }[] = [];
    for (const r of rows.rows) {
      if (!r.start_date) notIncluded.push({ facilityId: r.facility_id, facilityName: r.name, reason: "No reporting period with this exact interval." });
      else if (!r.results) notIncluded.push({ facilityId: r.facility_id, facilityName: r.name, reason: "No completed calculation run for this period." });
      else
        included.push({
          facilityId: r.facility_id,
          facilityName: r.name,
          reportingBoundary: r.reporting_boundary,
          periodStart: r.start_date,
          periodEnd: r.end_date,
          synthetic: !!r.synthetic,
          scope1Tco2: r.results.scope1_tco2,
          clinkerT: r.results.clinker_t,
          cementT: r.results.cement_t,
          transfersIn: r.results.transfers_in.map((t) => ({
            fromFacilityId: t.from_facility_id,
            material: t.material,
            tonnes: t.tonnes,
            includedInReportedOutput: t.included_in_reported_output,
          })),
        });
    }
    return {
      start,
      end,
      authorizedFacilityCount: authorized.length,
      notIncluded,
      clinker: consolidate(included, "clinker"),
      cement: consolidate(included, "cement"),
      engineNote: "Totals come from the tenancy-foundation aggregation of persisted synthetic activity data, not from the authoritative MRV engine.",
    };
  });
}
