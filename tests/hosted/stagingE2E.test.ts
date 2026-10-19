/**
 * HOSTED end-to-end acceptance through the Vitest runner. Skipped unless the guards in tests/hosted/cases.ts pass
 * (project explicitly classified as test, ref match, executor key and synthetic logins in the environment).
 * Run (Node >= 20.6; Vitest does not read .env.local itself):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run tests/hosted/stagingE2E.test.ts
 * Variables: see .env.example ("HOSTED E2E only").
 */
import { describe, expect, it } from "vitest";
import { hostedGuard, runHostedCases } from "./cases";

describe.skipIf(!hostedGuard().ok)("HOSTED: real Supabase Auth + PostgREST + Storage (synthetic data)", () => {
  it("passes every authentication, isolation, tampering, replay and range check", async () => {
    const res = await runHostedCases();
    expect(res.enabled).toBe(true);
    expect(res.checks.filter((c) => !c.pass)).toEqual([]);
    expect(res.total).toBeGreaterThan(30);
  }, 180_000);
});
