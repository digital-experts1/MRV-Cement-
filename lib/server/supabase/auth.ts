import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig, SupabaseConfigError } from "@/integrations/supabase/client";
import { HttpError } from "@/lib/server/authz/errors";

export interface MrvCaller {
  /** User-scoped client: every query/RPC runs as `authenticated` with this user's JWT, so RLS applies. */
  db: SupabaseClient;
  user: { id: string; email: string | null };
}

/**
 * Authenticates a route-handler request from the Supabase session cookies. `getUser()` contacts Supabase Auth on every
 * request, so deleted/signed-out users are rejected immediately (membership is then checked live by the database).
 * No service-role key is used anywhere in the application.
 */
export async function authenticateRequest(req: Request): Promise<{ caller: MrvCaller | null; setCookies: string[] }> {
  let cfg: { url: string; key: string };
  try {
    cfg = supabaseConfig();
  } catch (e) {
    if (e instanceof SupabaseConfigError) throw new HttpError(503, e.message);
    throw e;
  }
  const setCookies: string[] = [];
  const db = createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll: () => parseCookieHeader(req.headers.get("cookie") ?? "").map((c) => ({ name: c.name, value: c.value ?? "" })),
      setAll: (cookies) => {
        for (const c of cookies) setCookies.push(serializeCookieHeader(c.name, c.value, c.options));
      },
    },
  });
  const { data, error } = await db.auth.getUser();
  if (error || !data.user) return { caller: null, setCookies };
  return { caller: { db, user: { id: data.user.id, email: data.user.email ?? null } }, setCookies };
}
