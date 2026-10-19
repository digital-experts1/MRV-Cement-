import { devGuard } from "@/lib/server/dev/guard";
import { beginRotation, completeRotation, type CompleteRequest } from "@/lib/server/dev/secretRotation";

/**
 * Development-only (only reachable via the NODE_ENV=development branch of app/api/dev/secret-rotation/route.ts): rotation of the test project's executor key and synthetic
 * passwords. Secrets are generated in the database and delivered RSA-encrypted to this process; responses never contain
 * secrets. See lib/server/dev/secretRotation.ts and db/supabase/0004_secret_rotation.sql.
 */
export async function POST(req: Request) {
  const denied = devGuard(req, { hosted: true });
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as ({ action?: string } & CompleteRequest) | null;
  try {
    if (body?.action === "begin") return Response.json(beginRotation(), { headers: { "cache-control": "no-store" } });
    if (body?.action === "complete") return Response.json(await completeRotation(body), { headers: { "cache-control": "no-store" } });
    return Response.json({ error: "action must be begin or complete" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
