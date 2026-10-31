import { describe, expect, it } from "vitest";
import { setupDisplay, setupViewRows } from "../lib/setupView";

describe("effective setup presentation", () => {
  it("displays setup when a daily import has no workbook setup rows", () => {
    expect(setupViewRows({ Country: "Egypt", "Period start": "2026-10-01" }, [])).toHaveLength(2);
  });
  it("uses effective values without losing metadata or modifying original rows", () => {
    const rows = [{ Parameter: "Period start", Value: "2025-01-01", Notes: "Original note", _source: { row: 2 } }];
    const result = setupViewRows({ "Period start": "2026-10-01", Country: "Egypt" }, rows);
    expect(result[0]).toEqual({ ...rows[0], Value: "2026-10-01" });
    expect(result).toHaveLength(2);
    expect(rows[0].Value).toBe("2025-01-01");
  });
  it("preserves zero, false and explicit missing values", () => {
    expect(setupDisplay(0)).toBe("0"); expect(setupDisplay(false)).toBe("false");
    expect(setupDisplay(null)).toBe("Not supplied");
    expect(setupViewRows({ x: null }, [{ Parameter: "x", Value: 5 }])[0].Value).toBeNull();
  });
});
