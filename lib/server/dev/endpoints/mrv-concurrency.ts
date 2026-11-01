import { devGuard } from "@/lib/server/dev/guard";
import { runConcurrencyCases } from "@/tests/mrv/concurrencyHarness";

/** Development-only (only reachable via the NODE_ENV=development branch of app/api/dev/mrv-concurrency/route.ts): evidence race cases on a throwaway local multi-connection PostgreSQL cluster. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  const started = Date.now();
  const res = await runConcurrencyCases();
  return Response.json({ ...res, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
