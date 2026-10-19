import { describe, expect, it } from "vitest";
import { q1Reconciliation } from "./reference/q1";

// The supplied Q1 2025 workbook is labelled DEMO: this is a reconciliation against a demo workbook, not a real-plant validation.
describe("Q1 2025 collection workbook (DEMO-labelled) — workbook vs independent reference vs application", () => {
  const q = q1Reconciliation();

  it("is recognised as a demo workbook and maps with the declared per-sheet mapping (fuel = Q1 totals)", () => {
    expect(q.labelledDemo).toBe(true);
    expect(q.mappingErrors).toEqual([]);
    expect(q.conflicts).toBe(0);
    expect(q.readings.filter((r) => r.section === "kilnFuel").every((r) => r.interval === "2025-01-01..2025-03-31")).toBe(true);
    expect(q.readings.filter((r) => r.section !== "kilnFuel").every((r) => r.basis === "calendar_month_of_date")).toBe(true);
  });

  it("has no unexplained discrepancies between reference and application", () => {
    expect(q.register.filter((r) => r.status === "discrepancy")).toEqual([]);
    const notComparable = q.register.filter((r) => r.status === "not_comparable").map((r) => r.metric);
    expect(notComparable).toEqual(["Process CO2 Method A", "Stock movement closing difference", "Product allocation (per cement type)"]);
  });

  it("rejects fraction-valued carbonate under '%' headers instead of rescaling it", () => {
    expect(q.inputIssues.filter((i) => /ambiguous unit/.test(i.reason))).toHaveLength(6);
    expect(q.methodANote.asFractionWithWorkbookFactors).toBe("347036.4");
  });

  it("does not report stock reconciliation as passed without inventory evidence", () => {
    expect(q.qa.find((c) => c.id === "MB-04")?.status).toBe("NOT_EVALUATED");
  });
});
