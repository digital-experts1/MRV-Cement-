/**
 * Role → permission matrix (Supervisor Directive 03). Pure data, shared by server authorization, docs and tests.
 * Permissions are evaluated per facility; tenant-scoped assignments apply to every facility of that tenant.
 * Membership alone grants nothing. Approval rights come only from the `approver` role.
 */

export const ROLES = [
  "tenant_admin",
  "facility_manager",
  "contributor_production",
  "contributor_utilities",
  "contributor_laboratory",
  "mrv_analyst",
  "reviewer",
  "approver",
  "auditor",
] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "facility.read",
  "period.manage",
  "upload.create",
  "activity.write.production",
  "activity.write.utilities",
  "activity.write.laboratory",
  "mapping.manage",
  "factor_override.manage",
  "calculation.run",
  "qa.manage",
  "evidence.read",
  "evidence.write",
  "report.read",
  "report.export",
  "report.submit",
  "report.review",
  "report.approve",
  "ai.assess",
  "scenario.manage",
  "audit.read",
    "members.manage",
    "dataset.archive",
  ] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CONTRIBUTOR_BASE: Permission[] = ["facility.read", "upload.create", "evidence.read", "evidence.write"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  tenant_admin: ["facility.read", "period.manage", "members.manage", "audit.read", "report.read", "evidence.read", "dataset.archive"],
  facility_manager: [
    "facility.read", "period.manage", "upload.create", "activity.write.production", "activity.write.utilities",
    "activity.write.laboratory", "mapping.manage", "calculation.run", "evidence.read", "evidence.write",
    "report.read", "report.export", "report.submit", "ai.assess", "scenario.manage",
  ],
  contributor_production: [...CONTRIBUTOR_BASE, "activity.write.production"],
  contributor_utilities: [...CONTRIBUTOR_BASE, "activity.write.utilities"],
  contributor_laboratory: [...CONTRIBUTOR_BASE, "activity.write.laboratory"],
  mrv_analyst: [
    "facility.read", "mapping.manage", "factor_override.manage", "calculation.run", "qa.manage", "evidence.read",
    "evidence.write", "report.read", "report.export", "report.submit", "ai.assess", "scenario.manage",
  ],
  reviewer: ["facility.read", "evidence.read", "report.read", "report.export", "report.review", "qa.manage", "ai.assess"],
  approver: ["facility.read", "evidence.read", "report.read", "report.export", "report.approve"],
  auditor: ["facility.read", "evidence.read", "report.read", "report.export", "audit.read"],
};

/** Roles that may only be granted tenant-wide. */
export const TENANT_ONLY_ROLES: readonly Role[] = ["tenant_admin"];

/** Platform support access: explicit, time-boxed, audited and read-only. Never write or approve. */
export const SUPPORT_PERMISSIONS: readonly Permission[] = ["facility.read", "evidence.read", "report.read"];

/** Tenant-level (not facility-level) permissions evaluated only from tenant-scoped assignments. */
export const TENANT_LEVEL_PERMISSIONS: readonly Permission[] = ["members.manage", "audit.read"];

export const ROLE_LABELS: Record<Role, string> = {
  tenant_admin: "Tenant administrator",
  facility_manager: "Facility manager",
  contributor_production: "Production contributor",
  contributor_utilities: "Utilities contributor",
  contributor_laboratory: "Laboratory contributor",
  mrv_analyst: "MRV analyst",
  reviewer: "Reviewer",
  approver: "Approver",
  auditor: "Read-only auditor / external verifier",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function permissionsFor(roles: Iterable<Role>): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r]) out.add(p);
  return out;
}

export const ACTIVITY_DOMAINS = ["production", "utilities", "laboratory"] as const;
export type ActivityDomain = (typeof ACTIVITY_DOMAINS)[number];

export function writePermissionForDomain(domain: ActivityDomain): Permission {
  return `activity.write.${domain}` as Permission;
}
