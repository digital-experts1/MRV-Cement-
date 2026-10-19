import { devGuard } from "@/lib/server/dev/guard";
import { runHostedCases } from "@/tests/hosted/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Development-only (excluded from production builds): hosted acceptance cases against the designated test project.
 * Requires loopback same-origin access plus MRV_STAGING_E2E=1, MRV_SUPABASE_ENVIRONMENT=test and a matching project ref.
 */
export async function GET(req: Request) {
  const denied = devGuard(req, { hosted: true });
  if (denied) return denied;
  const started = Date.now();
  const res = await runHostedCases();
  return Response.json({ ...res, ms: Date.now() - started, executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
