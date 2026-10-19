import { requireTenantPermission, withTenant } from "@/lib/server/authz/authorize";
import { badRequest, forbidden, isUuid, notFound } from "@/lib/server/authz/errors";
import { asUser } from "@/lib/server/db/context";
import type { Caller } from "@/lib/server/deps";
import { TENANT_ONLY_ROLES, isRole, type Permission } from "@/lib/tenancy/permissions";

export async function getMe({ deps, principal }: Caller) {
  const tenants = await asUser(deps.db, { userId: principal.userId, tenantId: null }, async (sql) => {
    const r = await sql.query<{ id: string; name: string; synthetic: boolean }>(
      `SELECT t.id, t.name, t.synthetic FROM tenant t JOIN tenant_membership m ON m.tenant_id = t.id
       WHERE m.user_id = $1 AND m.status = 'active' ORDER BY t.name`,
      [principal.userId]
    );
    return r.rows;
  });
  return {
    user: { id: principal.userId, email: principal.email, displayName: principal.displayName, isPlatformAdmin: principal.isPlatformAdmin },
    memberships: tenants.map((t) => ({ tenantId: t.id, name: t.name, synthetic: t.synthetic, via: "membership" as const })),
  };
}

export function listFacilities({ deps, principal }: Caller, tenantId: unknown) {
  return withTenant(deps.db, principal, tenantId, "facility.list", async ({ sql, access }) => {
    const r = await sql.query<{ id: string; code: string; name: string; country: string | null; reporting_boundary: string }>(
      "SELECT id, code, name, country, reporting_boundary FROM facility WHERE tenant_id = $1 ORDER BY code",
      [access.tenantId]
    );
    return {
      via: access.via,
      tenantPermissions: [...access.tenantPermissions],
      facilities: r.rows
        .filter((f) => access.facilities.has(f.id))
        .map((f) => ({ ...f, permissions: [...(access.facilities.get(f.id) ?? [])] as Permission[] })),
    };
  });
}

export function listPeriods({ deps, principal }: Caller, tenantId: unknown, facilityId: unknown) {
  return withTenant(deps.db, principal, tenantId, "period.list", async ({ sql, require, access }) => {
    require(String(facilityId), "facility.read");
    const r = await sql.query(
      "SELECT id, label, start_date::text AS start_date, end_date::text AS end_date, status FROM reporting_period WHERE tenant_id = $1 AND facility_id = $2 ORDER BY start_date DESC",
      [access.tenantId, facilityId]
    );
    return r.rows;
  });
}

// ───────────── Tenant administration (members.manage) ─────────────

export function listMembers({ deps, principal }: Caller, tenantId: unknown) {
  return withTenant(deps.db, principal, tenantId, "members.list", async (call) => {
    requireTenantPermission(call, "members.manage");
    const members = await call.sql.query<{ membership_id: string; user_id: string; email: string; display_name: string; status: string }>(
      `SELECT m.id AS membership_id, u.id AS user_id, u.email, u.display_name, m.status
       FROM tenant_membership m JOIN app_user u ON u.id = m.user_id WHERE m.tenant_id = $1 ORDER BY u.email`,
      [call.access.tenantId]
    );
    const assignments = await call.sql.query<{ id: string; membership_id: string; role: string; scope_type: string; facility_id: string | null }>(
      "SELECT id, membership_id, role, scope_type, facility_id FROM facility_role_assignment WHERE tenant_id = $1 AND revoked_at IS NULL",
      [call.access.tenantId]
    );
    return members.rows.map((m) => ({ ...m, assignments: assignments.rows.filter((a) => a.membership_id === m.membership_id) }));
  });
}

export function addMember({ deps, principal }: Caller, tenantId: unknown, body: { email?: unknown }) {
  return withTenant(deps.db, principal, tenantId, "members.add", async (call) => {
    requireTenantPermission(call, "members.manage");
    if (typeof body.email !== "string" || !body.email.includes("@")) throw badRequest("A valid email is required");
    const u = await call.sql.query<{ id: string | null }>("SELECT app.find_user_for_admin($1, $2) AS id", [call.access.tenantId, body.email.trim()]);
    const userId = u.rows[0]?.id;
    // Only existing identities can be added; invitations require the production identity provider.
    if (!userId) throw notFound();
    const r = await call.sql.query<{ id: string }>(
      `INSERT INTO tenant_membership (tenant_id, user_id, granted_by) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'active', revoked_at = NULL RETURNING id`,
      [call.access.tenantId, userId, principal.userId]
    );
    await call.audit("members.add", `membership:${r.rows[0].id}`);
    return { membershipId: r.rows[0].id };
  });
}

export function revokeMember({ deps, principal }: Caller, tenantId: unknown, membershipId: unknown) {
  return withTenant(deps.db, principal, tenantId, "members.revoke", async (call) => {
    requireTenantPermission(call, "members.manage");
    if (!isUuid(membershipId)) throw notFound();
    const r = await call.sql.query<{ user_id: string }>(
      "UPDATE tenant_membership SET status = 'revoked', revoked_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING user_id",
      [call.access.tenantId, membershipId]
    );
    if (!r.rows.length) throw notFound();
    if (r.rows[0].user_id === principal.userId) throw forbidden("Administrators cannot revoke their own membership");
    await call.sql.query("UPDATE facility_role_assignment SET revoked_at = now() WHERE tenant_id = $1 AND membership_id = $2 AND revoked_at IS NULL", [call.access.tenantId, membershipId]);
    await call.audit("members.revoke", `membership:${membershipId}`);
    return { revoked: true };
  });
}

export function assignRole(
  { deps, principal }: Caller,
  tenantId: unknown,
  body: { membershipId?: unknown; role?: unknown; facilityId?: unknown }
) {
  return withTenant(deps.db, principal, tenantId, "roles.assign", async (call) => {
    requireTenantPermission(call, "members.manage");
    if (!isUuid(body.membershipId)) throw badRequest("membershipId is required");
    if (!isRole(body.role)) throw badRequest("Unknown role");
    const facilityId = body.facilityId == null || body.facilityId === "" ? null : body.facilityId;
    if (facilityId !== null && !isUuid(facilityId)) throw badRequest("Invalid facilityId");
    if (facilityId !== null && TENANT_ONLY_ROLES.includes(body.role)) throw badRequest("This role can only be granted tenant-wide");
    // Composite FKs reject a membership or facility belonging to another tenant even if these checks were bypassed.
    const r = await call.sql.query<{ id: string }>(
      `INSERT INTO facility_role_assignment (tenant_id, membership_id, role, scope_type, facility_id, granted_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [call.access.tenantId, body.membershipId, body.role, facilityId ? "facility" : "tenant", facilityId, principal.userId]
    );
    await call.audit("roles.assign", `assignment:${r.rows[0].id}`, facilityId, { role: body.role });
    return { assignmentId: r.rows[0].id };
  });
}

export function revokeRole({ deps, principal }: Caller, tenantId: unknown, assignmentId: unknown) {
  return withTenant(deps.db, principal, tenantId, "roles.revoke", async (call) => {
    requireTenantPermission(call, "members.manage");
    if (!isUuid(assignmentId)) throw notFound();
    const own = await call.sql.query(
      `SELECT 1 FROM facility_role_assignment a JOIN tenant_membership m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
       WHERE a.tenant_id = $1 AND a.id = $2 AND a.role = 'tenant_admin' AND m.user_id = $3`,
      [call.access.tenantId, assignmentId, principal.userId]
    );
    if (own.rows.length) throw forbidden("Administrators cannot revoke their own tenant administrator role");
    const r = await call.sql.query(
      "UPDATE facility_role_assignment SET revoked_at = now() WHERE tenant_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING id",
      [call.access.tenantId, assignmentId]
    );
    if (!r.rows.length) throw notFound();
    await call.audit("roles.revoke", `assignment:${assignmentId}`);
    return { revoked: true };
  });
}

/** Tenant admin grants a platform administrator explicit, time-boxed, read-only support access. */
export function grantSupportAccess({ deps, principal }: Caller, tenantId: unknown, body: { platformAdminId?: unknown; reason?: unknown; hours?: unknown }) {
  return withTenant(deps.db, principal, tenantId, "support.grant", async (call) => {
    requireTenantPermission(call, "members.manage");
    if (!isUuid(body.platformAdminId) || typeof body.reason !== "string") throw badRequest("platformAdminId and reason are required");
    const hours = typeof body.hours === "number" && body.hours > 0 && body.hours <= 72 ? body.hours : 4;
    const r = await call.sql.query<{ id: string }>(
      `INSERT INTO support_access_grant (tenant_id, platform_admin_id, granted_by, reason, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5)) RETURNING id`,
      [call.access.tenantId, body.platformAdminId, principal.userId, body.reason, hours]
    );
    await call.audit("support.grant", `support_grant:${r.rows[0].id}`, null, { hours });
    return { grantId: r.rows[0].id };
  });
}

export function readAuditLog({ deps, principal }: Caller, tenantId: unknown) {
  return withTenant(deps.db, principal, tenantId, "audit.read", async (call) => {
    requireTenantPermission(call, "audit.read");
    const r = await call.sql.query<{ tenant_id: string; action: string; outcome: string; via: string; at: string }>(
      "SELECT tenant_id, action, target, outcome, via, actor_id, at::text AS at FROM audit_log ORDER BY at DESC LIMIT 200"
    );
    return r.rows;
  });
}
