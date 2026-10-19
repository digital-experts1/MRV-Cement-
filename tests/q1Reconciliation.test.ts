import { describe, expect, it } from "vitest";
import { q1Reconciliation } from "./reference/q1";

// The supplied Q1 2025 workbook is labelled DEMO: this is a reconciliation against a demo workbook, not a real-plant validation.
// Fuel aggregation, carbonate unit and mass basis are TEST ASSUMPTIONS pending owner confirmation (Q1_ASSUMPTIONS).
describe("Q1 2025 collection workbook (DEMO-labelled) — workbook vs independent reference vs application", () => {
  const q = q1Reconciliation();

  it("is recognised as a demo workbook and maps with the declared per-sheet mapping (fuel = Q1 totals, assumption Q1-A1)", () => {
    expect(q.labelledDemo).toBe(true);
    expect(q.mappingErrors).toEqual([]);
    expect(q.conflicts).toBe(0);
    expect(q.readings.filter((r) => r.section === "kilnFuel").every((r) => r.interval === "2025-01-01..2025-03-31")).toBe(true);
    expect(q.readings.filter((r) => r.section !== "kilnFuel").every((r) => r.basis === "calendar_month_of_date")).toBe(true);
    expect(q.assumptions.map((a) => a.status)).toEqual(["pending owner confirmation", "pending owner confirmation", "pending owner confirmation"]);
  });

  it("without a unit declaration: no discrepancies; Method A not calculated (contradictory % header), not rescaled", () => {
    expect(q.register.filter((r) => r.status === "discrepancy")).toEqual([]);
    const notComparable = q.register.filter((r) => r.status === "not_comparable").map((r) => r.metric);
    expect(notComparable).toEqual(["Process CO2 Method A", "Stock movement closing difference", "Product allocation (per cement type)"]);
    expect(q.inputIssues).toEqual([]);
  });

  it("with the declared units (fraction, dry): Method A is calculated, original values preserved, mapping version recorded", () => {
    expect(q.declaredInputIssues).toEqual([]);
    expect(q.declaredRawRows.every((r) => r.unit === "fraction" && r.basis === "dry" && r.version === "trace-source-units/v1")).toBe(true);
    expect(q.declaredRawRows.every((r) => typeof r.caSource === "number" && r.caSource === r.caFraction)).toBe(true);
    expect(q.registerDeclared.filter((r) => r.status === "discrepancy")).toEqual([]);
    expect(q.registerDeclared.find((r) => r.metric === "Process CO2 Method A")?.status).toBe("within_tolerance");
  });

  it("keeps workbook-reproduction and engine factor scenarios separate (no factor changed to match the workbook)", () => {
    expect(q.methodAScenarios["WORKBOOK-REPRO/Q1-DEMO/v1"]).toBe("347036.4");
    expect(Number(q.methodAScenarios.workbookCached)).toBeCloseTo(347036.4, 6);
    expect(q.methodAScenarios["STOICH-ROUNDED-MM/v1"]).not.toBe("347036.4");
  });

  it("does not report stock reconciliation as passed without inventory evidence", () => {
    expect(q.qa.find((c) => c.id === "MB-04")?.status).toBe("NOT_EVALUATED");
  });
});
