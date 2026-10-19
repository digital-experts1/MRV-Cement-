"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { StaleScopeError, useScope } from "@/context/ScopeContext";
import { ROLE_LABELS, ROLES, TENANT_ONLY_ROLES, type Role } from "@/lib/tenancy/permissions";

interface Assignment {
  id: string;
  role: Role;
  scope_type: "tenant" | "facility";
  facility_id: string | null;
}
interface Member {
  membership_id: string;
  user_id: string;
  email: string;
  display_name: string;
  status: string;
  assignments: Assignment[];
}

/** Tenant-admin membership and facility-access management. Every action is re-authorized server-side. */
export default function AccessAdminPage() {
  const scope = useScope();
  const { tenantId, tenantPermissions, facilities, scopedFetch } = scope;
  const canManage = tenantPermissions.includes("members.manage");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<Record<string, { role: Role; facilityId: string }>>({});

  const load = useCallback(async () => {
    if (!tenantId || !canManage) return;
    try {
      setMembers(await scopedFetch<Member[]>(`/tenants/${tenantId}/members`));
    } catch (e) {
      if (!(e instanceof StaleScopeError)) setMessage(e instanceof Error ? e.message : String(e));
    }
  }, [tenantId, canManage, scopedFetch]);

  useEffect(() => {
    setMembers(null);
    setMessage(null);
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMessage(null);
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (e) {
      if (!(e instanceof StaleScopeError)) setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  const facilityName = (id: string | null) => (id ? (facilities.find((f) => f.id === id)?.code ?? "Other factory") : "All factories");

  if (scope.status !== "ready" || !tenantId) {
    return (
      <div className="page-container">
        <PageHeader icon="lock" title="Access Management" />
        <ScopeNotice signIn={scope.status === "signed-out"} title="Sign in to manage organization access" desc="Membership and factory access are managed per organization by tenant administrators." />
      </div>
    );
  }
  if (!canManage) {
    return (
      <div className="page-container">
        <PageHeader icon="lock" title="Access Management" />
        <ScopeNotice title="Tenant administrator role required" desc="You do not have permission to manage members of this organization." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        icon="lock"
        title="Access Management"
        desc="Members of the active organization and their roles. Membership alone grants no access; each role is granted tenant-wide or for one factory."
      />
      {message ? <div className="dataset-banner dataset-banner-warn" role="status">{message}</div> : null}

      <div className="section-card mb-lg">
        <SectionHeader icon="plus" title="Add existing user to this organization" />
        <div className="section-card-body">
          <form
            className="filter-row"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => scopedFetch(`/tenants/${tenantId}/members`, { method: "POST", json: { email } }), "Member added (no roles yet).");
              setEmail("");
            }}
          >
            <input className="filter-input" type="email" required placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm">Add member</button>
          </form>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="lock" title="Members and role assignments" />
        <div className="section-card-body no-pad">
          <table className="data-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Grant role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(members ?? []).map((m) => {
                const d = draft[m.membership_id] ?? { role: "reviewer" as Role, facilityId: "" };
                const tenantOnly = TENANT_ONLY_ROLES.includes(d.role);
                return (
                  <tr key={m.membership_id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{m.display_name}</div>
                      <div className="unit-col">{m.email}</div>
                    </td>
                    <td>
                      <span className={`badge ${m.status === "active" ? "badge-pass" : "badge-warn"}`}>{m.status}</span>
                    </td>
                    <td>
                      {m.assignments.length ? (
                        m.assignments.map((a) => (
                          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                            <span className="badge badge-info">{ROLE_LABELS[a.role] ?? a.role}</span>
                            <span className="unit-col">{facilityName(a.facility_id)}</span>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => act(() => scopedFetch(`/tenants/${tenantId}/role-assignments/${a.id}`, { method: "DELETE" }), "Role revoked.")}
                            >
                              Revoke
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="unit-col">No roles — no access</span>
                      )}
                    </td>
                    <td>
                      {m.status === "active" ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <select
                            className="filter-select"
                            value={d.role}
                            onChange={(e) => setDraft({ ...draft, [m.membership_id]: { ...d, role: e.target.value as Role } })}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                          <select
                            className="filter-select"
                            value={tenantOnly ? "" : d.facilityId}
                            disabled={tenantOnly}
                            onChange={(e) => setDraft({ ...draft, [m.membership_id]: { ...d, facilityId: e.target.value } })}
                          >
                            <option value="">All factories (tenant-wide)</option>
                            {facilities.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.code} · {f.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() =>
                              act(
                                () =>
                                  scopedFetch(`/tenants/${tenantId}/role-assignments`, {
                                    method: "POST",
                                    json: { membershipId: m.membership_id, role: d.role, facilityId: tenantOnly ? null : d.facilityId || null },
                                  }),
                                "Role granted."
                              )
                            }
                          >
                            Grant
                          </button>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {m.status === "active" && m.user_id !== scope.user?.id ? (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => {
                            if (confirm(`Revoke ${m.email}'s membership and all roles?`)) {
                              void act(() => scopedFetch(`/tenants/${tenantId}/members/${m.membership_id}`, { method: "DELETE" }), "Membership revoked.");
                            }
                          }}
                        >
                          Revoke membership
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
