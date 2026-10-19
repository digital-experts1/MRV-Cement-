import { devGuard } from "@/lib/server/dev/guard";
import { syntheticRegister } from "@/tests/mrv/cases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Development-only (excluded from production builds): independent reference vs application on the SYNTHETIC fixture. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  return Response.json({ dataset: "SYNTHETIC demo fixture", rows: syntheticRegister(), executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
