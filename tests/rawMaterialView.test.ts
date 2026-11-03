import { describe, expect, it } from "vitest";
import {
  assayUnit,
  needsRawReview,
  rawTotal,
  rawTrend,
} from "../lib/rawMaterialView";

describe("raw material presentation", () => {
  it("keeps missing, invalid and empty totals distinct from zero", () => {
    expect(rawTotal([], "Quantity t")).toBeNull();
    expect(rawTotal([{ "Quantity t": 0 }], "Quantity t")).toBe(0);
    expect(
      rawTotal([{ "Quantity t": 10 }, { "Quantity t": null }], "Quantity t"),
    ).toBeNull();
    expect(rawTotal([{ "Quantity t": "12 t" }], "Quantity t")).toBeNull();
    expect(
      rawTotal(
        [{ "Quantity t": "1,200.5" }, { "Quantity t": 0.5 }],
        "Quantity t",
      ),
    ).toBe(1201);
  });
  it("sorts and aggregates same-date rows without turning incomplete CO2 into zero", () => {
    const rows = [
      { Date: "2026-10-02", "Quantity t": 5, "Process CO2 Method A t": null },
      { Date: "2026-10-01", "Quantity t": 20, "Process CO2 Method A t": 8 },
      { Date: "2026-10-01", "Quantity t": 30, "Process CO2 Method A t": 12 },
    ];
    expect(rawTrend(rows)).toEqual([
      { date: "2026-10-01", quantity: 50, co2: 20 },
      { date: "2026-10-02", quantity: 5, co2: null },
    ]);
    expect(rows[0].Date).toBe("2026-10-02");
  });
  it("does not infer fraction semantics from small assay values", () => {
    expect(assayUnit({ "CaCO3 %": 0.95 })).toBe("% by header; undeclared");
    expect(assayUnit({ "CaCO3 %": 0.95, "Carbonate Unit": "fraction" })).toBe(
      "fraction",
    );
    expect(assayUnit({ "Moisture Unit": "percent" }, true)).toBe("%");
  });
  it("includes missing evidence and undeclared units in the review queue even when row QA passes", () => {
    const row = {
      "QA Status": "PASS",
      "Evidence ID": "EV1",
      "Carbonate Unit": "percent",
      "Mass Basis": "dry",
    };
    expect(needsRawReview(row)).toBe(false);
    expect(needsRawReview({ ...row, "Evidence ID": "" })).toBe(true);
    expect(needsRawReview({ ...row, "Mass Basis": "" })).toBe(true);
    expect(needsRawReview({ ...row, "QA Status": "WARNING" })).toBe(true);
    expect(
      needsRawReview({ ...row, "Mass Basis": "wet", "Moisture Unit": "" }),
    ).toBe(true);
  });
});
