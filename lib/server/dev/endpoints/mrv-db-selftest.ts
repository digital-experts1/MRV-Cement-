import { devGuard } from "@/lib/server/dev/guard";
import { runDbCases } from "@/tests/mrv/dbHarness";

/** Development-only (only reachable via the NODE_ENV=development branch of app/api/dev/mrv-db-selftest/route.ts): Directive 06 database cases on a fresh in-process PostgreSQL. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  const started = Date.now();
  const res = await runDbCases();
  return Response.json({ ...res, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
