import { describe, expect, it } from "vitest";
import { readingTrends, fuelEnergy, readingInterval } from "../lib/readingTrends";
const metrics = [{ label: "Cement", field: "Cement Produced t" }];
const r = (Date: string, value: unknown) => ({ Date, "Cement Produced t": value });
describe("reading trends regression", () => {
  it("fills absent days with null and preserves measured zero", () => {
    const result = readingTrends([r("2026-10-01", 0), r("2026-10-03", 12)], metrics, "daily", "2026-10-01", "2026-10-03");
    expect(result.series[0].data).toEqual([0, null, 12]); expect(result.indices).toEqual([[0], [], [1]]);
  });
  it("does not publish partial bucket totals with invalid supplied quantities", () => {
    const result = readingTrends([r("2026-10-01", 10), r("2026-10-01", "")], metrics, "daily", "2026-10-01", "2026-10-01");
    expect(result.series[0].data).toEqual([null]);
  });
  it("groups by Monday and calendar month, using decimal arithmetic", () => {
    const rows = [r("2026-10-04", 0.1), r("2026-10-05", 0.2)];
    expect(readingTrends(rows, metrics, "weekly", "2026-10-04", "2026-10-05").labels).toEqual(["2026-09-28", "2026-10-05"]);
    expect(readingTrends(rows, metrics, "monthly", "2026-10-01", "2026-10-31").series[0].data).toEqual([0.3]);
  });
  it("keeps monthly intervals intact and excludes crossing intervals", () => {
    const row = { ...r("2026-10-31", 3100), "Interval Start": "2026-10-01", "Interval End": "2026-10-31" };
    const result = readingTrends([row], metrics, "daily", "2026-10-01", "2026-10-31");
    expect(result.grain).toBe("interval"); expect(result.labels).toEqual(["2026-10-01 – 2026-10-31"]); expect(result.series[0].data).toEqual([3100]);
    expect(readingTrends([row], metrics, "daily", "2026-10-02", "2026-10-31").excluded).toBe(1);
  });
  it("rejects malformed dates and reversed intervals", () => {
    expect(readingInterval(r("2026-02-30", 3))).toBeNull();
    expect(readingInterval({ "Interval Start": "2026-10-04", "Interval End": "2026-10-01" })).toBeNull();
  });
  it("fuel energy requires quantity and NCV and never sums unlike units directly", () => {
    expect(fuelEnergy({ Quantity: 2, "NCV GJ/unit": 25 })).toBe(50);
    expect(fuelEnergy({ Quantity: 2 })).toBeNull();
    expect(fuelEnergy({ Quantity: 0, "NCV GJ/unit": 25 })).toBe(0);
  });
  it("filters groups, preserves source indices and does not mutate inputs", () => {
    const rows = [Object.freeze({ Date: "2026-10-01", "Fuel Type": "Coal", Quantity: 2, "NCV GJ/unit": 25 }), Object.freeze({ Date: "2026-10-01", "Fuel Type": "Gas", Quantity: 100, "NCV GJ/unit": 0.04 })];
    const result = readingTrends(rows, [{ label: "Gas", group: "Fuel Type", field: "", value: fuelEnergy }], "daily", "2026-10-01", "2026-10-01");
    expect(result.series[0].data).toEqual([4]); expect(result.indices).toEqual([[0, 1]]);
    expect(readingTrends([], metrics, "daily", "", "").series[0].data).toEqual([]);
  });
});
