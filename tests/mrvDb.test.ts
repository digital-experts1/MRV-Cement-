import { describe, expect, it } from "vitest";
import { runDbCases } from "./mrv/dbHarness";

describe("Directive 06 — trusted execution, history and isolation on real PostgreSQL (PGlite, synthetic)", () => {
  it("all database acceptance checks pass", async () => {
    const res = await runDbCases();
    const failed = res.checks.filter((c) => !c.pass);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 120_000);
});
