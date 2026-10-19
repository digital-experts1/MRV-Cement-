import { createHash, randomBytes } from "node:crypto";
import { asOwner, asUser } from "@/lib/server/db/context";
import type { Database } from "@/lib/server/db/types";
import type { Principal } from "@/lib/server/authz/authorize";
import { isUuid } from "@/lib/server/authz/errors";

export const SESSION_COOKIE = "trace_session";
const SESSION_TTL_HOURS = 8;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Issues an opaque session token; only its hash is stored. Called after the identity provider authenticates the user. */
export async function issueSession(db: Database, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await asOwner(db, (sql) =>
    sql.query(`INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_TTL_HOURS} hours')`, [hashToken(token), userId])
  );
  return token;
}

export async function revokeSession(db: Database, token: string): Promise<void> {
  await asOwner(db, (sql) => sql.query("UPDATE auth_session SET revoked_at = now() WHERE token_hash = $1", [hashToken(token)]));
}

/** Resolves a session token to a principal on every request (no cached authorization). */
export async function resolvePrincipal(db: Database, token: string | null | undefined): Promise<Principal | null> {
  if (!token || token.length > 200) return null;
  const userId = await asUser(db, { userId: "", tenantId: null }, async (sql) => {
    const r = await sql.query<{ user_id: string | null }>("SELECT app.resolve_session($1) AS user_id", [hashToken(token)]);
    return r.rows[0]?.user_id ?? null;
  });
  if (!isUuid(userId)) return null;
  return asUser(db, { userId, tenantId: null }, async (sql) => {
    const r = await sql.query<{ id: string; email: string; display_name: string; is_platform_admin: boolean }>(
      "SELECT id, email, display_name, is_platform_admin FROM app_user WHERE id = $1 AND status = 'active'",
      [userId]
    );
    const u = r.rows[0];
    return u ? { userId: u.id, email: u.email, displayName: u.display_name, isPlatformAdmin: u.is_platform_admin } : null;
  });
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
