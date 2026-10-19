import type { Principal } from "@/lib/server/authz/authorize";
import { asOwner } from "@/lib/server/db/context";
import type { ServerDeps } from "@/lib/server/deps";
import { createEvidence } from "@/lib/server/services/evidence";
import { enqueueCalculation, runNextJob } from "@/lib/server/services/jobs";
import { createReportFromRun, decideReport, submitReport } from "@/lib/server/services/reports";

/**
 * SYNTHETIC fixtures for development and isolation tests only. All names are fictitious and flagged synthetic.
 * Tenant A ("Synthetic Cement Group A") has two factories; Tenant B has one.
 */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const S = {
  tenantA: id(1),
  tenantB: id(2),
  facA1: id(11),
  facA2: id(12),
  facB1: id(21),
  periodA1: id(111),
  periodA2: id(121),
  periodB1: id(211),
  periodA1Prev: id(112),
  users: {
    adminA: id(1001),
    mgrA1: id(1002),
    analystA: id(1003),
    reviewerA: id(1004),
    approverA: id(1005),
    memberOnlyA: id(1006),
    prodA2: id(1007),
    adminB: id(2001),
    analystB: id(2002),
    approverB: id(2003),
    multi: id(3001),
    platform: id(9001),
  },
} as const;

export type SeedUserKey = keyof typeof S.users;

export const SEED_USERS: Record<SeedUserKey, { email: string; name: string; platform?: boolean }> = {
  adminA: { email: "admin@group-a.example", name: "Ada Admin (A tenant admin)" },
  mgrA1: { email: "manager.a1@group-a.example", name: "Max Manager (A1 only)" },
  analystA: { email: "analyst@group-a.example", name: "Ana Analyst (A, tenant-wide)" },
  reviewerA: { email: "reviewer@group-a.example", name: "Rui Reviewer (A, tenant-wide)" },
  approverA: { email: "approver@group-a.example", name: "Abe Approver (A, tenant-wide)" },
  memberOnlyA: { email: "member@group-a.example", name: "Mo Member (A, no roles)" },
  prodA2: { email: "production.a2@group-a.example", name: "Pia Production (A2 contributor)" },
  adminB: { email: "admin@group-b.example", name: "Bea Admin (B tenant admin + B1 manager)" },
  analystB: { email: "analyst@group-b.example", name: "Ben Analyst (B)" },
  approverB: { email: "approver@group-b.example", name: "Bo Approver (B)" },
  multi: { email: "consultant@multi.example", name: "Cy Consultant (A2 manager + B auditor)" },
  platform: { email: "support@trace-platform.example", name: "Pat Platform (platform admin)", platform: true },
};

export function seedPrincipal(key: SeedUserKey): Principal {
  return { userId: S.users[key], email: SEED_USERS[key].email, displayName: SEED_USERS[key].name, isPlatformAdmin: !!SEED_USERS[key].platform };
}

export interface SeedOutput {
  runs: Record<"A1" | "A2" | "B1", string>;
  reports: Record<"A1" | "A2" | "B1", string>;
  evidence: Record<"A1" | "A2" | "B1", string>;
  records: Record<"A1" | "B1", string>;
}

export async function seedSynthetic(deps: ServerDeps): Promise<SeedOutput> {
  const u = S.users;
  await asOwner(deps.db, async (sql) => {
    await sql.query(
      `INSERT INTO ref.factor_catalog (code, version, value, unit, source_document, effective_from)
       VALUES ('CLINKER_EF', 1, 0.525, 'tCO2/t clinker', 'SYNTHETIC catalog entry for tests', '2020-01-01')`
    );
    for (const [key, user] of Object.entries(SEED_USERS)) {
      await sql.query("INSERT INTO app_user (id, auth_subject, email, display_name, is_platform_admin) VALUES ($1, $2, $3, $4, $5)", [
        u[key as SeedUserKey], `synthetic|${key}`, user.email, user.name, !!user.platform,
      ]);
    }
    await sql.query(
      `INSERT INTO tenant (id, slug, name, synthetic) VALUES ($1, 'synthetic-a', 'Synthetic Cement Group A', true), ($2, 'synthetic-b', 'Synthetic Cement Group B', true)`,
      [S.tenantA, S.tenantB]
    );
    await sql.query(
      `INSERT INTO facility (id, tenant_id, code, name, country, reporting_boundary) VALUES
       ($1, $3, 'A1', 'A1 Integrated Kiln Plant (synthetic)', 'EG', 'Gate-to-gate: quarry, kiln line 1, cement mills'),
       ($2, $3, 'A2', 'A2 Grinding Station (synthetic)', 'EG', 'Gate-to-gate: cement mills only; clinker received from A1'),
       ($4, $5, 'B1', 'B1 Integrated Plant (synthetic)', 'EG', 'Gate-to-gate: kiln line and cement mills')`,
      [S.facA1, S.facA2, S.tenantA, S.facB1, S.tenantB]
    );
    await sql.query(
      `INSERT INTO process_unit (tenant_id, facility_id, unit_type, name) VALUES
       ($1, $2, 'kiln', 'Kiln 1'), ($1, $2, 'cement_mill', 'Cement mill 1'), ($1, $3, 'grinding_unit', 'Grinding unit 1'), ($4, $5, 'kiln', 'Kiln B')`,
      [S.tenantA, S.facA1, S.facA2, S.tenantB, S.facB1]
    );
    await sql.query(
      `INSERT INTO reporting_period (id, tenant_id, facility_id, label, start_date, end_date) VALUES
       ($1, $4, $5, 'Q1 2026', '2026-01-01', '2026-03-31'),
       ($2, $4, $6, 'Q1 2026', '2026-01-01', '2026-03-31'),
       ($3, $7, $8, 'Q1 2026', '2026-01-01', '2026-03-31'),
       ($9, $4, $5, 'Q4 2025', '2025-10-01', '2025-12-31')`,
      [S.periodA1, S.periodA2, S.periodB1, S.tenantA, S.facA1, S.facA2, S.tenantB, S.facB1, S.periodA1Prev]
    );
    const memberships: [string, string, string][] = [
      [S.tenantA, u.adminA, id(5001)], [S.tenantA, u.mgrA1, id(5002)], [S.tenantA, u.analystA, id(5003)],
      [S.tenantA, u.reviewerA, id(5004)], [S.tenantA, u.approverA, id(5005)], [S.tenantA, u.memberOnlyA, id(5006)],
      [S.tenantA, u.prodA2, id(5007)], [S.tenantB, u.adminB, id(5101)], [S.tenantB, u.analystB, id(5102)],
      [S.tenantB, u.approverB, id(5103)], [S.tenantA, u.multi, id(5201)], [S.tenantB, u.multi, id(5202)],
    ];
    for (const [t, user, m] of memberships) {
      await sql.query("INSERT INTO tenant_membership (id, tenant_id, user_id) VALUES ($1, $2, $3)", [m, t, user]);
    }
    const roles: [string, string, string, string | null][] = [
      [S.tenantA, id(5001), "tenant_admin", null],
      [S.tenantA, id(5002), "facility_manager", S.facA1],
      [S.tenantA, id(5003), "mrv_analyst", null],
      [S.tenantA, id(5004), "reviewer", null],
      [S.tenantA, id(5005), "approver", null],
      [S.tenantA, id(5007), "contributor_production", S.facA2],
      [S.tenantB, id(5101), "tenant_admin", null],
      [S.tenantB, id(5101), "facility_manager", S.facB1],
      [S.tenantB, id(5102), "mrv_analyst", null],
      [S.tenantB, id(5103), "approver", null],
      [S.tenantA, id(5201), "facility_manager", S.facA2],
      [S.tenantB, id(5202), "auditor", null],
    ];
    for (const [t, m, role, f] of roles) {
      await sql.query("INSERT INTO facility_role_assignment (tenant_id, membership_id, role, scope_type, facility_id) VALUES ($1, $2, $3, $4, $5)", [
        t, m, role, f ? "facility" : "tenant", f,
      ]);
    }
  });

  // Activity data (synthetic). Identical activity types in both tenants on purpose.
  const recordIds: Partial<SeedOutput["records"]> = {};
  await asOwner(deps.db, async (sql) => {
    const rows: [string, string, string, string, string, string | null, string][] = [
      [S.tenantA, S.facA1, S.periodA1, "production", "clinker_produced_t", "100000", "t"],
      [S.tenantA, S.facA1, S.periodA1, "production", "cement_produced_t", "120000", "t"],
      [S.tenantA, S.facA1, S.periodA1, "utilities", "direct_emissions_tco2", "52500", "tCO2"],
      [S.tenantA, S.facA2, S.periodA2, "production", "clinker_produced_t", "0", "t"],
      [S.tenantA, S.facA2, S.periodA2, "production", "cement_produced_t", "60000", "t"],
      [S.tenantA, S.facA2, S.periodA2, "utilities", "direct_emissions_tco2", "1500", "tCO2"],
      [S.tenantB, S.facB1, S.periodB1, "production", "clinker_produced_t", "150000", "t"],
      [S.tenantB, S.facB1, S.periodB1, "production", "cement_produced_t", "170000", "t"],
      [S.tenantB, S.facB1, S.periodB1, "utilities", "direct_emissions_tco2", "81000", "tCO2"],
    ];
    for (const [t, f, p, domain, type, value, unit] of rows) {
      const state = value === "0" ? "zero" : "present";
      const r = await sql.query<{ id: string }>(
        `INSERT INTO activity_record (tenant_id, facility_id, period_id, domain, activity_type, value, unit, value_state, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [t, f, p, domain, type, value, unit, state, t === S.tenantA ? u.mgrA1 : u.adminB]
      );
      if (f === S.facA1 && type === "clinker_produced_t") recordIds.A1 = r.rows[0].id;
      if (f === S.facB1 && type === "clinker_produced_t") recordIds.B1 = r.rows[0].id;
    }
    // Inter-factory transfers inside Tenant A: clinker A1→A2 (not production at A2) and 5,000 t cement A1→A2 that
    // A2's dispatch-based cement figure already contains (must be removed on consolidation).
    await sql.query(
      `INSERT INTO inventory_movement (tenant_id, facility_id, period_id, material, movement, quantity, unit, counterparty_facility_id, included_in_reported_output, created_by) VALUES
       ($1, $2, $4, 'clinker', 'transfer_out', 30000, 't', $3, false, $5),
       ($1, $3, $6, 'clinker', 'transfer_in', 30000, 't', $2, false, $5),
       ($1, $2, $4, 'cement', 'transfer_out', 5000, 't', $3, false, $5),
       ($1, $3, $6, 'cement', 'transfer_in', 5000, 't', $2, true, $5)`,
      [S.tenantA, S.facA1, S.facA2, S.periodA1, u.mgrA1, S.periodA2]
    );
  });

  const ctx = (k: SeedUserKey) => ({ deps, principal: seedPrincipal(k) });
  const evidence = {
    A1: (await createEvidence(ctx("analystA"), S.tenantA, S.facA1, { evidenceCode: "EV-A1-001", title: "Kiln fuel weighbridge summary (synthetic A1)", mime: "text/plain", text: "SYNTHETIC kiln fuel weighbridge totals for A1, Tenant A.", periodId: S.periodA1 })).evidenceId,
    A2: (await createEvidence(ctx("analystA"), S.tenantA, S.facA2, { evidenceCode: "EV-A2-001", title: "Cement dispatch log (synthetic A2)", mime: "text/plain", text: "SYNTHETIC cement dispatch for A2 including kiln clinker receipts.", periodId: S.periodA2 })).evidenceId,
    B1: (await createEvidence(ctx("analystB"), S.tenantB, S.facB1, { evidenceCode: "EV-B1-001", title: "Kiln fuel weighbridge summary (synthetic B1)", mime: "text/plain", text: "SYNTHETIC kiln fuel data TENANT-B-CONFIDENTIAL.", periodId: S.periodB1 })).evidenceId,
  };

  const jobs = new Map<string, "A1" | "A2" | "B1">([
    [(await enqueueCalculation(ctx("analystA"), S.tenantA, S.facA1, { periodId: S.periodA1, idempotencyKey: "seed-A1-Q1" })).jobId, "A1"],
    [(await enqueueCalculation(ctx("analystA"), S.tenantA, S.facA2, { periodId: S.periodA2, idempotencyKey: "seed-A2-Q1" })).jobId, "A2"],
    [(await enqueueCalculation(ctx("analystB"), S.tenantB, S.facB1, { periodId: S.periodB1, idempotencyKey: "seed-B1-Q1" })).jobId, "B1"],
  ]);
  const runs: Partial<SeedOutput["runs"]> = {};
  for (let i = 0; i < jobs.size; i++) {
    const r = await runNextJob(deps);
    const key = r ? jobs.get(r.jobId) : undefined;
    if (!r?.runId || !key) throw new Error(`Seed job failed: ${r?.error ?? "no job claimed"}`);
    runs[key] = r.runId;
  }

  const reports = {
    A1: (await createReportFromRun(ctx("analystA"), S.tenantA, runs.A1)).reportId,
    A2: (await createReportFromRun(ctx("analystA"), S.tenantA, runs.A2)).reportId,
    B1: (await createReportFromRun(ctx("analystB"), S.tenantB, runs.B1)).reportId,
  };
  await submitReport(ctx("analystA"), S.tenantA, reports.A1);
  await decideReport(ctx("approverA"), S.tenantA, reports.A1, "approved", "Synthetic approval for isolation tests");
  await submitReport(ctx("analystB"), S.tenantB, reports.B1);
  await decideReport(ctx("approverB"), S.tenantB, reports.B1, "approved", "Synthetic approval for isolation tests");

  return { runs: runs as SeedOutput["runs"], reports, evidence, records: recordIds as SeedOutput["records"] };
}
