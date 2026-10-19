import { devGuard } from "@/lib/server/dev/guard";
import { q1Reconciliation } from "@/tests/reference/q1";

/** Development-only (only reachable via the NODE_ENV=development branch of app/api/dev/q1-inspect/route.ts): Q1 2025 (DEMO-labelled) workbook reconciliation. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  try {
    return Response.json(q1Reconciliation(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
