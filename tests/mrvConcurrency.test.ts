import { describe, expect, it } from "vitest";
import { runConcurrencyCases } from "./mrv/concurrencyHarness";

describe("Evidence upload/delete race and concurrent replacements — separate concurrent transactions on a real PostgreSQL server (synthetic)", () => {
  it("pre-fix race reproduces; fixed 0007 keeps every interleaving consistent", async () => {
    const res = await runConcurrencyCases();
    const failed = res.checks.filter((c) => !c.pass);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
  }, 180_000);
});
