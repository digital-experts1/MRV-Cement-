import { asUser } from "@/lib/server/db/context";
import type { Database, Sql } from "@/lib/server/db/types";
import {
  SUPPORT_PERMISSIONS,
  TENANT_LEVEL_PERMISSIONS,
  isRole,
  permissionsFor,
  type Permission,
  type Role,
} from "@/lib/tenancy/permissions";
import { forbidden, HttpError, isUuid, notFound } from "./errors";

export interface Principal {
  userId: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
}

export interface TenantAccess {
  tenantId: string;
  via: "membership" | "support";
  tenantPermissions: Set<Permission>;
  /** Authorized facilities only, with the permissions held at each. */
  facilities: Map<string, Set<Permission>>;
}

export interface ScopedCall {
  sql: Sql;
  principal: Principal;
  access: TenantAccess;
  /** Throws 404 if the facility is outside the user's scope, 403 if it is visible but the permission is missing. */
  require(facilityId: string, permission: Permission): void;
  audit(action: string, target: string | null, facilityId?: string | null, detail?: Record<string, unknown>): Promise<void>;
}

/** Loads the caller's access for one tenant inside the current transaction (context already set). */
export async function loadTenantAccess(sql: Sql, principal: Principal, tenantId: string): Promise<TenantAccess | null> {
  const membership = await sql.query<{ id: string }>(
    `SELECT m.id FROM tenant_membership m JOIN tenant t ON t.id = m.tenant_id
     WHERE m.tenant_id = $1 AND m.user_id = $2 AND m.status = 'active' AND t.status = 'active'`,
    [tenantId, principal.userId]
  );
  if (membership.rows.length) {
    const assignments = await sql.query<{ role: string; scope_type: string; facility_id: string | null }>(
      `SELECT role, scope_type, facility_id FROM facility_role_assignment
       WHERE tenant_id = $1 AND membership_id = $2 AND revoked_at IS NULL AND valid_from <= now()`,
      [tenantId, membership.rows[0].id]
    );
    const facilities = await sql.query<{ id: string }>("SELECT id FROM facility WHERE tenant_id = $1", [tenantId]);
    const tenantRoles: Role[] = [];
    const byFacility = new Map<string, Role[]>();
    for (const a of assignments.rows) {
      if (!isRole(a.role)) continue;
      if (a.scope_type === "tenant") tenantRoles.push(a.role);
      else if (a.facility_id) byFacility.set(a.facility_id, [...(byFacility.get(a.facility_id) ?? []), a.role]);
    }
    const map = new Map<string, Set<Permission>>();
    for (const f of facilities.rows) {
      const perms = permissionsFor([...tenantRoles, ...(byFacility.get(f.id) ?? [])]);
      for (const p of TENANT_LEVEL_PERMISSIONS) perms.delete(p);
      if (perms.size) map.set(f.id, perms);
    }
    const tenantPermissions = new Set([...permissionsFor(tenantRoles)].filter((p) => TENANT_LEVEL_PERMISSIONS.includes(p)));
    if (!map.size && !tenantPermissions.size) return null;
    return { tenantId, via: "membership", tenantPermissions, facilities: map };
  }

  if (principal.isPlatformAdmin) {
    const grant = await sql.query<{ ok: boolean }>("SELECT app.has_support_grant($1) AS ok", [tenantId]);
    if (grant.rows[0]?.ok) {
      const facilities = await sql.query<{ id: string }>("SELECT id FROM facility WHERE tenant_id = $1", [tenantId]);
      return {
        tenantId,
        via: "support",
        tenantPermissions: new Set(),
        facilities: new Map(facilities.rows.map((f) => [f.id, new Set(SUPPORT_PERMISSIONS)])),
      };
    }
  }
  return null;
}

async function writeAudit(sql: Sql, tenantId: string | null, facilityId: string | null, action: string, target: string | null, outcome: "allowed" | "denied", via: string, detail: Record<string, unknown>) {
  await sql.query("SELECT app.write_audit($1, $2, $3, $4, $5, $6, $7)", [tenantId, facilityId, action, target, outcome, via, JSON.stringify(detail)]);
}

/**
 * The single entry point for tenant-scoped operations. The tenant id from the request is only a *claim*:
 * it is accepted only after the authenticated user's active membership/role assignments (or explicit support
 * grant) are confirmed inside the same transaction that then runs the operation under RLS.
 */
export async function withTenant<T>(
  db: Database,
  principal: Principal,
  tenantId: unknown,
  action: string,
  fn: (call: ScopedCall) => Promise<T>
): Promise<T> {
  if (!isUuid(tenantId)) throw notFound();
  try {
    return await asUser(db, { userId: principal.userId, tenantId }, async (sql) => {
      const access = await loadTenantAccess(sql, principal, tenantId);
      if (!access) throw notFound();
      const call: ScopedCall = {
        sql,
        principal,
        access,
        require(facilityId, permission) {
          const perms = isUuid(facilityId) ? access.facilities.get(facilityId) : undefined;
          if (!perms) throw notFound();
          if (!perms.has(permission)) throw forbidden(`Missing permission ${permission}`);
        },
        audit: (a, target, facilityId = null, detail = {}) => writeAudit(sql, tenantId, facilityId, a, target, "allowed", access.via, detail),
      };
      const result = await fn(call);
      if (access.via === "support") await call.audit(`support:${action}`, null, null, { readOnly: true });
      return result;
    });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 404)) {
      // The failed transaction rolled back; record the denial in the platform security log (tenant_id NULL) so a
      // probing user's activity is not disclosed to the probed tenant's administrators.
      await asUser(db, { userId: principal.userId, tenantId: null }, (sql) =>
        writeAudit(sql, null, null, action, null, "denied", principal.isPlatformAdmin ? "support" : "membership", { status: err.status, requestedTenant: tenantId })
      ).catch(() => undefined);
    }
    throw err;
  }
}

export function requireTenantPermission(call: ScopedCall, permission: Permission) {
  if (!call.access.tenantPermissions.has(permission)) throw forbidden(`Missing permission ${permission}`);
}
