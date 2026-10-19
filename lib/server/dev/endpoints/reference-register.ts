import { devGuard } from "@/lib/server/dev/guard";
import { syntheticRegister } from "@/tests/mrv/cases";

/** Development-only (only reachable via the NODE_ENV=development branch of app/api/dev/reference-register/route.ts): independent reference vs application on the SYNTHETIC fixture. */
export async function GET(req: Request) {
  const denied = devGuard(req);
  if (denied) return denied;
  return Response.json({ dataset: "SYNTHETIC demo fixture", rows: syntheticRegister(), executedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
}
