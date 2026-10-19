import { devGuard } from "@/lib/server/dev/guard";
import { runDbCases } from "@/tests/mrv/dbHarness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only (excluded from production builds): Directive 06 database cases on a fresh in-process PostgreSQL. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  const started = Date.now();
  const res = await runDbCases();
  return Response.json({ ...res, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
