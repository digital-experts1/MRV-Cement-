import { describe, expect, it } from "vitest";
import { overviewSeries, productionInterval } from "../lib/overviewSeries";
describe("Overview chart series", () => {
  it("preserves monthly intervals instead of implying daily readings", () => {
    expect(productionInterval({ "Interval Start": "2026-01-01", "Interval End": "2026-01-31" })).toBe("2026-01-01 – 2026-01-31");
    expect(productionInterval({})).toBeNull();
  });
  it("never displays a partial total when a grouped reading is missing", () => {
    const s = overviewSeries([{ Date: "2026-01-01", n: 10 }, { Date: "2026-01-01", n: null }, { Date: "2026-01-02", n: 0 }], r => String(r.Date), "n");
    expect(s.labels).toEqual(["2026-01-02"]); expect(s.values).toEqual([0]); expect(s.incomplete).toBe(1);
  });
  it("adds source values using decimal arithmetic and flags ambiguous text", () => {
    const s = overviewSeries([{ Date: "a", n: 0.1 }, { Date: "a", n: 0.2 }, { Date: "b", n: "1.000" }], r => String(r.Date), "n");
    expect(s.values).toEqual([0.3]); expect(s.incomplete).toBe(1);
  });
});
