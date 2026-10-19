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

  it("source profile requires explicit carbonate unit and mass basis: without them the raw-material rows are rejected at import", () => {
    expect(q.requiredUnits).toEqual(["carbonate", "massBasis"]);
    expect(q.undeclaredErrors.length).toBeGreaterThan(0);
    expect(q.undeclaredErrors.every((e) => e.includes("04_Raw_Material_Input") && /requires an explicit Carbonate Unit and Mass Basis declaration/.test(e))).toBe(true);
    expect(q.undeclaredReferenceMethodA).toBeNull();
    expect(q.undeclaredDirectMethodA).toBeNull();
  });

  it("with the declared units (fraction, dry): Method A is calculated, original values preserved, mapping version recorded", () => {
    expect(q.inputIssues).toEqual([]);
    expect(q.declaredRawRows.every((r) => r.unit === "fraction" && r.basis === "dry" && r.version === "trace-source-units/v1")).toBe(true);
    expect(q.declaredRawRows.every((r) => typeof r.caSource === "number" && r.caSource === r.caFraction)).toBe(true);
    // Reference vs application only — this says nothing about agreement with the workbook.
    expect(q.register.filter((r) => r.status === "discrepancy")).toEqual([]);
    expect(q.methodAFinding.referenceVsApplication).toBe("within_tolerance");
    const notComparable = q.register.filter((r) => r.status === "not_comparable").map((r) => r.metric);
    expect(notComparable).toEqual(["Stock movement closing difference", "Product allocation (per cement type)"]);
  });

  it("keeps workbook-reproduction and engine factor scenarios separate (no factor changed to match the workbook)", () => {
    expect(q.methodAScenarios["WORKBOOK-REPRO/Q1-DEMO/v1"]).toBe("347036.4");
    expect(Number(q.methodAScenarios.workbookCached)).toBeCloseTo(347036.4, 6);
    expect(q.methodAScenarios["STOICH-ROUNDED-MM/v1"]).not.toBe("347036.4");
  });

  it("reports Method A as matching the reference but ~227.53 t different from the workbook (factor set), not 'no discrepancies'", () => {
    expect(q.methodAFinding.applicationMinusWorkbookT).toBeCloseTo(-227.53, 2);
    expect(q.methodAFinding.workbookComparison).toMatch(/differs from workbook \(factor set\)/);
    expect(q.methodAFinding.statement).toMatch(/matches the independent reference under the declared assumptions/);
    expect(q.methodAFinding.statement).toMatch(/differs from the workbook by 227\.53 t/);
  });

  it("does not report stock reconciliation as passed without inventory evidence", () => {
    expect(q.qa.find((c) => c.id === "MB-04")?.status).toBe("NOT_EVALUATED");
  });
});
