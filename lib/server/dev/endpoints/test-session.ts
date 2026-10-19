import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { devGuard } from "@/lib/server/dev/guard";

const USERS: Record<string, string> = { A: "MRV_E2E_A", B: "MRV_E2E_B", C: "MRV_E2E_C", REVOKED: "MRV_E2E_REVOKED" };

/**
 * Development-only (only reachable via the NODE_ENV=development branch of app/api/dev/test-session/route.ts): signs the calling browser in as one of the SYNTHETIC hosted-test
 * users using the server-side credentials, so browser tests never handle passwords. Sets the normal Supabase session
 * cookies; returns no credential.
 */
export async function POST(req: Request) {
  const denied = devGuard(req, { hosted: true });
  if (denied) return denied;
  const label = ((await req.json().catch(() => null)) as { user?: string } | null)?.user ?? "";
  const prefix = USERS[label];
  if (!prefix) return Response.json({ error: "user must be one of A, B, C, REVOKED" }, { status: 400 });
  const cookies: string[] = [];
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => parseCookieHeader(req.headers.get("cookie") ?? "").map((c) => ({ name: c.name, value: c.value ?? "" })),
      setAll: (list) => {
        for (const c of list) cookies.push(serializeCookieHeader(c.name, c.value, c.options));
      },
    },
  });
  const { data, error } = await db.auth.signInWithPassword({ email: process.env[prefix + "_EMAIL"]!, password: process.env[prefix + "_PASSWORD"]! });
  if (error || !data.user) return Response.json({ error: "sign-in failed" }, { status: 401 });
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify({ ok: true, user: label }), { headers });
}
