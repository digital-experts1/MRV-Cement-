import Decimal from "decimal.js";
import { parseStrictNumber } from "./numeric";
import type { AssertionResult, SheetRow, Store } from "./types";

/** Values a workbook *claims* (its own totals and statuses). Kept only for comparison. */
export interface WorkbookClaims {
  calcRows: SheetRow[];
  qaqc: SheetRow[];
  reportOutputs: SheetRow[];
  dashboardKpis: Record<string, unknown>;
}

const REL_TOL = new Decimal("0.0001"); // 0.01 % to absorb workbook display rounding
const ABS_TOL = new Decimal("0.000001");

function compare(sheet: string, field: string, claimed: unknown, computed: unknown): AssertionResult {
  const base = { sheet, field, workbookValue: claimed ?? null, computedValue: computed ?? null };
  if (claimed === null || claimed === undefined || String(claimed).trim() === "") {
    return { ...base, outcome: "NOT_COMPARABLE", note: "Workbook value blank" };
  }
  if (computed === null || computed === undefined) {
    return { ...base, outcome: "NOT_COMPARABLE", note: "Platform could not calculate this value (inputs missing); workbook value not used" };
  }
  const a = parseStrictNumber(claimed);
  const b = parseStrictNumber(computed);
  if (a.kind === "ok" && b.kind === "ok") {
    const tol = Decimal.max(ABS_TOL, b.value.abs().mul(REL_TOL));
    const match = a.value.minus(b.value).abs().lte(tol);
    return { ...base, outcome: match ? "MATCH" : "MISMATCH", note: match ? undefined : "Computed value is authoritative" };
  }
  const match = String(claimed).trim().toUpperCase() === String(computed).trim().toUpperCase();
  return { ...base, outcome: match ? "MATCH" : "MISMATCH", note: match ? undefined : "Workbook status ignored; computed status is authoritative" };
}

export function compareWorkbookClaims(store: Store, claims: WorkbookClaims): AssertionResult[] {
  const results: AssertionResult[] = [];
  for (const r of claims.calcRows) {
    const metric = String(r.Metric ?? "");
    if (!metric) continue;
    results.push(compare("08_Calculations", metric, r.Value, store.calculations[metric]?.Value));
  }
  const computedChecks = new Map(store.qaqc.map((r) => [String(r["Check ID"]), r.Status]));
  for (const r of claims.qaqc) {
    const id = String(r["Check ID"] ?? "");
    if (!id) continue;
    results.push(compare("09_QAQC_Checks", `${id} Status`, r.Status, computedChecks.get(id)));
  }
  const computedOutputs = new Map(store.reportOutputs.map((r) => [String(r["Output Field"]), r.Value]));
  for (const r of claims.reportOutputs) {
    const field = String(r["Output Field"] ?? "");
    if (!field) continue;
    results.push(compare("10_Report_Outputs", field, r.Value, computedOutputs.get(field)));
  }
  const dashMap: Record<string, string> = {
    "Direct Embedded CO2": "Direct Embedded CO2",
    "Total Embedded CO2": "Total Embedded CO2",
    "SEE Cement": "Specific Embedded Emissions Cement",
    "QA/QC Status": "QA/QC Overall Status",
  };
  for (const [kpi, claimed] of Object.entries(claims.dashboardKpis)) {
    const metric = dashMap[kpi];
    results.push(compare("13_Dashboard", kpi, claimed, metric ? store.calculations[metric]?.Value : undefined));
  }
  return results;
}
