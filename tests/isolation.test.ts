import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ISOLATION_CASES } from "./isolation/cases";
import { createIsolationEnv, type Check, type IsolationEnv } from "./isolation/harness";

describe("Supervisor Directive 03 — tenant isolation (synthetic Tenant A: A1+A2, Tenant B: B1)", () => {
  let env: IsolationEnv;
  beforeAll(async () => {
    env = await createIsolationEnv();
  }, 120_000);
  afterAll(async () => {
    await env?.deps.db.close();
  });

  // Cases share one database and run in order (e.g. revocation happens after earlier reads).
  for (const c of ISOLATION_CASES) {
    it(`${c.id} ${c.name}`, async () => {
      const checks: Check[] = [];
      await c.run(env, (label, pass, detail) => checks.push({ label, pass, detail: pass ? undefined : JSON.stringify(detail) }));
      expect(checks.filter((x) => !x.pass)).toEqual([]);
      expect(checks.length).toBeGreaterThan(0);
    }, 60_000);
  }
});
