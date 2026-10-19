import { devGuard } from "@/lib/server/dev/guard";
import { runIsolationSuite } from "@/tests/isolation/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only (excluded from production builds): Directive 03 isolation suite on a fresh in-process database. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  const started = Date.now();
  const summary = await runIsolationSuite();
  return Response.json({ ...summary, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
