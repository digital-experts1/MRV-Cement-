import { describe, expect, it } from "vitest";
import { createEmptyStore } from "@/lib/types";
import type { RunView } from "@/lib/mrv/clientTypes";
import { portfolioIssues, portfolioSum, portfolioValue } from "@/lib/mrv/portfolio";

function fixture(value: unknown): RunView {
  const store = createEmptyStore();
  store.calcRows = [{ Metric: "Grid Electricity MWh", Value: value }];
  store.completeness.pct = 100;
  store.readiness = { status: "READY_FOR_INTERNAL_REVIEW", reasons: [] };
  return { store, run: { range_start: "2026-01-01", range_end: "2026-01-31", stale: null, archived: false,
    integrity: { stored: "intact", sameEngine: true, recomputeMatches: true }, coverage: { complete: true } } } as RunView;
}
describe("portfolio saved-result safeguards", () => {
  it("keeps missing distinct from a real zero", () => {
    expect(portfolioValue(fixture(null), "Grid Electricity MWh")).toBeNull();
    expect(portfolioValue(fixture(0), "Grid Electricity MWh")).toBe(0);
    expect(portfolioSum([fixture(10), fixture(null)], "Grid Electricity MWh")).toBeNull();
    expect(portfolioSum([], "Grid Electricity MWh")).toBeNull();
  });
  it("sums decimal activity values without floating point artifacts", () => {
    expect(portfolioSum([fixture("0.1"), fixture("0.2")], "Grid Electricity MWh")).toBe("0.3");
  });
  it("rejects invalid, negative and nonfinite values", () => {
    for (const value of ["broken", -1, Infinity, NaN]) expect(portfolioValue(fixture(value), "Grid Electricity MWh")).toBeNull();
  });
  it("flags a different period even if saved data is complete", () => {
    expect(portfolioIssues(fixture(10), "2026-02-01", "2026-02-28")).toContain("Saved result does not match the selected period.");
  });
  it("flags stale, archived, incomplete and altered results", () => {
    const view = fixture(10);
    view.run.stale = { reason: "revised", at: "2026-02-01" };
    view.run.archived = true;
    view.run.integrity.stored = "altered";
    view.run.coverage.complete = false;
    expect(portfolioIssues(view, "2026-01-01", "2026-01-31")).toHaveLength(4);
  });
  it("does not confuse complete period coverage with complete inputs", () => {
    const view = fixture(10);
    view.store.completeness.pct = 80;
    expect(portfolioIssues(view, "2026-01-01", "2026-01-31")).toContain("Required input fields: 80% complete.");
    expect(portfolioIssues(null, "2026-01-01", "2026-01-31").length).toBeGreaterThan(0);
  });
});
