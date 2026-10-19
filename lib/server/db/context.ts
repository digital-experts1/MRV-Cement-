import type { Database, Sql } from "./types";

export interface DbContext {
  userId: string;
  /** Tenant whose rows may be visible in this transaction; null = identity-only (own memberships). */
  tenantId: string | null;
}

/**
 * Runs `fn` as the non-bypassing application role with transaction-local tenant context.
 * `SET LOCAL` and `set_config(..., true)` end with the transaction, so pooled connections never carry context over.
 */
export function asUser<T>(db: Database, ctx: DbContext, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return db.transaction(async (sql) => {
    await sql.query("SET LOCAL ROLE trace_app");
    await sql.query("SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)", [ctx.userId, ctx.tenantId ?? ""]);
    return fn(sql);
  });
}

/** Database-owner access. Restricted to migrations, synthetic seeding and session issuance. */
export function asOwner<T>(db: Database, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
