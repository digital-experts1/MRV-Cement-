import { createHash } from "node:crypto";
import { withTenant } from "@/lib/server/authz/authorize";
import { badRequest, forbidden, isUuid, notFound } from "@/lib/server/authz/errors";
import type { Sql } from "@/lib/server/db/types";
import type { Caller } from "@/lib/server/deps";

interface ReportRow {
  id: string;
  tenant_id: string;
  facility_id: string;
  period_id: string;
  run_id: string;
  status: string;
  synthetic: boolean;
  content: unknown;
  sha256: string;
  submitted_by: string | null;
  approved_by: string | null;
}

async function loadReport(sql: Sql, tenantId: string, reportId: unknown): Promise<ReportRow> {
  if (!isUuid(reportId)) throw notFound();
  const r = await sql.query<ReportRow>(
    "SELECT id, tenant_id, facility_id, period_id, run_id, status, synthetic, content, sha256, submitted_by, approved_by FROM report WHERE tenant_id = $1 AND id = $2",
    [tenantId, reportId]
  );
  if (!r.rows[0]) throw notFound();
  return r.rows[0];
}

export function listReports({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown) {
  return withTenant(deps.db, principal, tenantId, "report.list", async ({ sql, require, access }) => {
    require(String(facilityId), "report.read");
    const r = await sql.query("SELECT id, period_id, run_id, kind, status, synthetic, sha256 FROM report WHERE tenant_id = $1 AND facility_id = $2", [access.tenantId, facilityId]);
    return r.rows;
  });
}

export function createReportFromRun({ deps, principal }: Caller, tenantId: unknown, runId: unknown) {
  return withTenant(deps.db, principal, tenantId, "report.create", async ({ sql, require, access, audit }) => {
    if (!isUuid(runId)) throw notFound();
    const run = await sql.query<{ facility_id: string; period_id: string; results: unknown; synthetic: boolean }>(
      "SELECT facility_id, period_id, results, synthetic FROM calculation_run WHERE tenant_id = $1 AND id = $2",
      [access.tenantId, runId]
    );
    const row = run.rows[0];
    if (!row) throw notFound();
    require(row.facility_id, "report.submit");
    const content = { runId, results: row.results, synthetic: row.synthetic, statement: "Internal report. Not externally verified." };
    const sha = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    const r = await sql.query<{ id: string }>(
      `INSERT INTO report (tenant_id, facility_id, period_id, run_id, kind, synthetic, content, sha256)
       VALUES ($1, $2, $3, $4, 'internal_pdf', $5, $6, $7) RETURNING id`,
      [access.tenantId, row.facility_id, row.period_id, runId, row.synthetic, JSON.stringify(content), sha]
    );
    await audit("report.create", `report:${r.rows[0].id}`, row.facility_id);
    return { reportId: r.rows[0].id };
  });
}

export function submitReport({ deps, principal }: Caller, tenantId: unknown, reportId: unknown) {
  return withTenant(deps.db, principal, tenantId, "report.submit", async ({ sql, require, access, audit }) => {
    const report = await loadReport(sql, access.tenantId, reportId);
    require(report.facility_id, "report.submit");
    if (report.status !== "draft" && report.status !== "rejected") throw badRequest(`Report is ${report.status}`);
    await sql.query("UPDATE report SET status = 'submitted', submitted_by = $3 WHERE tenant_id = $1 AND id = $2", [access.tenantId, report.id, principal.userId]);
    await sql.query("INSERT INTO approval (tenant_id, facility_id, report_id, actor_id, action) VALUES ($1, $2, $3, $4, 'submitted')", [access.tenantId, report.facility_id, report.id, principal.userId]);
    await audit("report.submit", `report:${report.id}`, report.facility_id);
    return { status: "submitted" };
  });
}

/** Approval requires the approver role at the report's facility and segregation from the submitter. */
export function decideReport({ deps, principal }: Caller, tenantId: unknown, reportId: unknown, decision: "approved" | "rejected", comment?: string) {
  return withTenant(deps.db, principal, tenantId, `report.${decision}`, async ({ sql, require, access, audit }) => {
    const report = await loadReport(sql, access.tenantId, reportId);
    require(report.facility_id, "report.approve");
    if (report.status !== "submitted") throw badRequest(`Report is ${report.status}`);
    if (report.submitted_by === principal.userId) throw forbidden("Segregation of duties: the submitter cannot approve or reject");
    await sql.query(
      decision === "approved"
        ? "UPDATE report SET status = 'approved', approved_by = $3, approved_at = now() WHERE tenant_id = $1 AND id = $2"
        : "UPDATE report SET status = 'rejected' WHERE tenant_id = $1 AND id = $2 AND $3::uuid IS NOT NULL",
      [access.tenantId, report.id, principal.userId]
    );
    await sql.query("INSERT INTO approval (tenant_id, facility_id, report_id, actor_id, action, comment) VALUES ($1, $2, $3, $4, $5, $6)", [
      access.tenantId, report.facility_id, report.id, principal.userId, decision, comment ?? null,
    ]);
    await audit(`report.${decision}`, `report:${report.id}`, report.facility_id);
    return { status: decision };
  });
}

export function exportReport({ deps, principal }: Caller, tenantId: unknown, reportId: unknown) {
  return withTenant(deps.db, principal, tenantId, "report.export", async ({ sql, require, access, audit }) => {
    const report = await loadReport(sql, access.tenantId, reportId);
    require(report.facility_id, "report.export");
    await audit("report.export", `report:${report.id}`, report.facility_id);
    return { id: report.id, status: report.status, synthetic: report.synthetic, sha256: report.sha256, content: report.content };
  });
}
