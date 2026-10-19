"use client";

import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { useScope } from "@/context/ScopeContext";

/**
 * Shows the signed-in user's own effective permissions (computed live by the database). Member invitation and role
 * management are not yet migrated to the Supabase persistence layer; until then roles are granted by an operator.
 */
export default function AccessAdminPage() {
  const scope = useScope();
  const { tenantId, tenantPermissions, facilities, memberships } = scope;

  if (scope.status !== "ready" || !tenantId) {
    return (
      <div className="page-container">
        <PageHeader icon="lock" title="Access Management" />
        <ScopeNotice signIn={scope.status === "signed-out"} title="Sign in to view organization access" desc="Membership and factory access are managed per organization." />
      </div>
    );
  }

  const org = memberships.find((m) => m.tenantId === tenantId)?.name;
  return (
    <div className="page-container">
      <PageHeader icon="lock" title="Access Management" desc={`${org ?? "Organization"} · your effective permissions (evaluated by the database on every request)`} />
      <div className="dataset-banner dataset-banner-warn" role="note">
        Inviting members and granting roles from the UI is not yet available on the persistent database. Membership alone grants nothing; access comes only from explicit
        role assignments.
      </div>
      <div className="section-card mb-lg">
        <SectionHeader icon="lock" title="Tenant-level permissions" />
        <div className="section-card-body mono" style={{ fontSize: 12 }}>
          {tenantPermissions.length ? tenantPermissions.join(", ") : "None"}
        </div>
      </div>
      {facilities.map((f) => (
        <div key={f.id} className="section-card mb-lg">
          <SectionHeader icon="factory" title={`${f.code} · ${f.name} (${f.timezone})`} />
          <div className="section-card-body mono" style={{ fontSize: 12 }}>
            {f.permissions.length ? f.permissions.join(", ") : "No access"}
          </div>
        </div>
      ))}
    </div>
  );
}
