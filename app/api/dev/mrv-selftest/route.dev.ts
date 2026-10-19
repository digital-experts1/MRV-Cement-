import { devGuard } from "@/lib/server/dev/guard";
import { ACCEPTANCE_CASES } from "@/tests/acceptance/cases";
import { MRV_CASES } from "@/tests/mrv/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only (excluded from production builds): pure-logic suites (Directive 02 acceptance + MRV cases). */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  const results = [...ACCEPTANCE_CASES, ...MRV_CASES].map((c) => {
    try {
      c.run();
      return { id: c.id, name: c.name, passed: true };
    } catch (e) {
      return { id: c.id, name: c.name, passed: false, error: e instanceof Error ? e.message.slice(0, 600) : String(e) };
    }
  });
  return Response.json(
    { passed: results.filter((x) => x.passed).length, total: results.length, results, executedAt: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } }
  );
}
