import Decimal from "decimal.js";
import { strictNumberOrNull } from "@/lib/numeric";
import { getCalc } from "@/lib/types";
import type { RunView } from "./clientTypes";

export const PORTFOLIO_METRICS = [
  { key: "Cement Produced", label: "Cement production", unit: "t" },
  { key: "Clinker Produced", label: "Clinker production", unit: "t" },
  { key: "Direct Embedded CO2", label: "Direct emissions", unit: "tCO2" },
  { key: "Indirect Grid CO2", label: "Grid emissions", unit: "tCO2" },
  { key: "Grid Electricity MWh", label: "Grid electricity", unit: "MWh" },
  { key: "Total Fuel Energy", label: "Fuel energy", unit: "GJ" },
  { key: "Specific Embedded Emissions Cement", label: "Cement emissions intensity", unit: "tCO2/t cement" },
] as const;

export function portfolioValue(view: RunView | null, metric: string): number | null {
  const value = strictNumberOrNull(getCalc(view?.store ?? null, metric)?.Value);
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

export function portfolioIssues(view: RunView | null, start: string, end: string): string[] {
  if (!view) return ["No saved calculation for this period. Open the factory to calculate or import readings."];
  const { run, store } = view;
  const issues: string[] = [];
  if (run.range_start !== start || run.range_end !== end) issues.push("Saved result does not match the selected period.");
  if (run.stale) issues.push("Readings or settings changed; recalculate this factory.");
  if (run.archived) issues.push("This result is archived.");
  if (run.integrity.stored !== "intact" || !run.integrity.sameEngine || !run.integrity.recomputeMatches) issues.push("Calculation integrity or engine version needs review.");
  if (!run.coverage.complete) issues.push("Period coverage is incomplete or has conflicting readings.");
  if (store.completeness.pct < 100) issues.push(`Required input fields: ${store.completeness.pct}% complete.`);
  if (store.readiness.status !== "READY_FOR_INTERNAL_REVIEW") issues.push(...store.readiness.reasons);
  return [...new Set(issues)];
}

/** Descriptive factory sums only. Never treat these as transfer-adjusted group accounts. */
export function portfolioSum(views: RunView[], metric: string): string | null {
  if (!views.length) return null;
  const values = views.map(v => portfolioValue(v, metric));
  if (values.some(v => v === null)) return null;
  return values.reduce<Decimal>((sum, v) => sum.plus(v!), new Decimal(0)).toString();
}
