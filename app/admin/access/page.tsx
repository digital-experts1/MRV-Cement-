"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { useScope } from "@/context/ScopeContext";
import { mrvFetch } from "@/lib/apiClient";
import { ROLES, ROLE_LABELS, TENANT_ONLY_ROLES, type Role } from "@/lib/tenancy/permissions";

/**
 * Access Management (first version, Directive 03 / migration 0008). Tenant administrators (`members.manage`) see the
 * member table, invite users with an expiring single-use link ("Not emailed") and grant/revoke existing roles,
 * tenant-wide or per factory. Every change is authorized again by the database; non-administrators get a read-only
 * view of their own effective permissions.
 */

interface MemberRole {
  role: string;
  facility_id: string | null;
}
interface Member {
  membershipId: string;
  userId: string;
  email: string;
  status: string;
  joinedAt: string;
  revokedAt: string | null;
  roles: MemberRole[];
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  facilityId: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

const SCOPE_TENANT_WIDE = "__tenant__";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function invitationState(i: Invitation): { label: string; cls: string } {
  if (i.acceptedAt) return { label: "Accepted", cls: "badge badge-pass" };
  if (i.revokedAt) return { label: "Revoked", cls: "badge badge-fail" };
  if (new Date(i.expiresAt) <= new Date()) return { label: "Expired", cls: "badge badge-warn" };
  return { label: "Open", cls: "badge badge-info" };
}

/** Per-member assignment/revocation controls with their own role & scope selection. */
function MemberControls({ member, tenantId, facilities, busy, onDone, onError, facilityLabel }: {
  member: Member;
  tenantId: string;
  facilities: { id: string; code: string; name: string }[];
  busy: boolean;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
  facilityLabel: (id: string | null) => string;
}) {
  const [role, setRole] = useState<Role>("contributor_production");
  const [scope, setScope] = useState<string>(SCOPE_TENANT_WIDE);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const tenantWide = TENANT_ONLY_ROLES.includes(role) || scope === SCOPE_TENANT_WIDE;
  const facilityId = tenantWide ? null : scope;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <select className="input" style={{ width: 190 }} value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={`Role for ${member.email}`}>
        {ROLES.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
      {!TENANT_ONLY_ROLES.includes(role) && facilities.length > 0 ? (
        <select className="input" style={{ width: 170 }} value={scope} onChange={(e) => setScope(e.target.value)} aria-label={`Scope for ${member.email}`}>
          <option value={SCOPE_TENANT_WIDE}>Tenant-wide</option>
          {facilities.map((f) => (
            <option key={f.id} value={f.id}>{f.code}</option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={busy}
        onClick={() => {
          void (async () => {
            try {
              await mrvFetch(`/orgs/${tenantId}/members/${member.membershipId}/roles`, {
                method: "POST",
                json: { role, facilityId, grant: true },
              });
              onDone(`Granted ${ROLE_LABELS[role]} (${facilityLabel(facilityId)}) to ${member.email}.`);
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            }
          })();
        }}
      >
        Assign
      </button>
      {revoking ? (
        <>
          <input className="input" style={{ width: 220 }} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Reason for revoking ${member.email}`} />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            disabled={busy}
            onClick={() => {
              void (async () => {
                try {
                  await mrvFetch(`/orgs/${tenantId}/members/${member.membershipId}/revoke`, {
                    method: "POST",
                    json: { reason: reason.trim() },
                  });
                  setRevoking(false);
                  setReason("");
                  onDone(`Revoked all access for ${member.email} in this organization. Their account, history and other organizations are untouched.`);
                } catch (e) {
                  onError(e instanceof Error ? e.message : String(e));
                }
              })();
            }}
          >
            Confirm revoke
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRevoking(false)}>Cancel</button>
        </>
      ) : (
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => setRevoking(true)}>
          Revoke access…
        </button>
      )}
    </div>
  );
}

const facilityLabel = (id: string | null, facilities: { id: string; code: string; name: string }[]) => {
  if (id === null) return "Tenant-wide";
  const f = facilities.find((x) => x.id === id);
  return f ? `${f.code} · ${f.name}` : "Unknown factory";
};

export default function AccessAdminPage() {
  const scope = useScope();
  const { tenantId, tenantPermissions, facilities, memberships } = scope;
  const canManage = tenantPermissions.includes("members.manage");

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("contributor_production");
  const [inviteScope, setInviteScope] = useState<string>(SCOPE_TENANT_WIDE);
  const [inviteLink, setInviteLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !canManage) return;
    setLoading(true);
    try {
      const [m, i] = await Promise.all([
        mrvFetch<Member[]>(`/orgs/${tenantId}/members`),
        mrvFetch<Invitation[]>(`/orgs/${tenantId}/members/invitations`),
      ]);
      setMembers(m);
      setInvitations(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tenantId, canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const flabel = (id: string | null) => facilityLabel(id, facilities);

  const run = async (fn: () => Promise<void>, okMessage: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await fn();
      await load();
      setSuccess(okMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inviteScopeOptions = facilities.length > 0 && !TENANT_ONLY_ROLES.includes(inviteRole) ? (
    <label className="auth-field">
      <span>Access scope</span>
      <select className="input" value={inviteScope} onChange={(e) => setInviteScope(e.target.value)}>
        <option value={SCOPE_TENANT_WIDE}>Tenant-wide (all factories)</option>
        {facilities.map((f) => (
          <option key={f.id} value={f.id}>Only {f.code} · {f.name}</option>
        ))}
      </select>
    </label>
  ) : null;

  if (scope.status !== "ready" || !tenantId) {
    return (
      <div className="page-container">
        <PageHeader icon="lock" title="Access Management" />
        <ScopeNotice signIn={scope.status === "signed-out"} title="Sign in to view organization access" desc="Membership and factory access are managed per organization." />
      </div>
    );
  }

  const org = memberships.find((m) => m.tenantId === tenantId)?.name;

  // ───────────── Read-only view: no management permission ─────────────
  if (!canManage) {
    return (
      <div className="page-container">
        <PageHeader icon="lock" title="Access Management" desc={`${org ?? "Organization"} · your effective permissions (evaluated by the database on every request)`} />
        <div className="dataset-banner dataset-banner-warn" role="note">
          Only tenant administrators can invite members and assign roles. Membership alone grants nothing; access comes only from
          explicit role assignments. Ask an administrator of this organization for changes.
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

  // ───────────── Management view: tenant administrator ─────────────
  return (
    <div className="page-container">
      <PageHeader icon="lock" title="Access Management" desc={`${org ?? "Organization"} · members, roles and invitations (only you — a tenant administrator — can change access here)`} />
      {error ? <div className="dataset-banner dataset-banner-error" role="alert">{error}</div> : null}
      {success ? <div className="dataset-banner dataset-banner-ok" role="status">{success}</div> : null}

      <div className="section-card mb-lg">
        <SectionHeader icon="user-plus" title="Invite user" />
        <div className="section-card-body">
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const res = await mrvFetch<{ token: string; expiresAt: string }>(`/orgs/${tenantId}/members/invite`, {
                  method: "POST",
                  json: { email: inviteEmail.trim(), role: inviteRole, facilityId: TENANT_ONLY_ROLES.includes(inviteRole) || inviteScope === SCOPE_TENANT_WIDE ? null : inviteScope },
                });
                setInviteLink({ url: `${window.location.origin}/onboarding?invite=${res.token}`, expiresAt: res.expiresAt });
                setInviteEmail("");
              }, "Invitation created. It was NOT emailed — copy the link below and send it to the invited person yourself.");
            }}
          >
            <label className="auth-field">
              <span>Email address of the person to invite</span>
              <input className="input" type="email" required maxLength={160} value={inviteEmail} onChange={(e) => { setInviteEmail(e.target.value); setInviteLink(null); }} />
            </label>
            <label className="auth-field">
              <span>Role (existing role matrix — no approval rights unless the approver role is granted)</span>
              <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </label>
            {inviteScopeOptions}
            <button type="submit" className="btn btn-primary" disabled={busy || loading}>
              {busy ? "Inviting…" : "Invite user"}
            </button>
          </form>
          {inviteLink ? (
            <div className="mt-md">
              <div className="chip chip-pending">Not emailed</div>{" "}
              <span className="text-sm">Invitation link (single-use, expires {fmtDate(inviteLink.expiresAt)}). It can only be accepted by an account with this email address.</span>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <input className="input" readOnly value={inviteLink.url} onFocus={(e) => e.currentTarget.select()} style={{ minWidth: 280, flex: "1 1 280px" }} />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(inviteLink.url);
                    setSuccess("Link copied to clipboard.");
                  }}
                >
                  Copy link
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="section-card mb-lg">
        <SectionHeader icon="users" title={`Members (${members.filter((m) => m.status === "active").length} active)`} />
        <div className="section-card-body">
          {loading ? <p>Loading members…</p> : members.length === 0 ? <p>No members found.</p> : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Roles &amp; factories</th>
                    <th>Status</th>
                    <th>Joined</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.membershipId}>
                      <td className="mono">{m.email}</td>
                      <td>
                        {m.roles.length === 0 ? <span className="text-sm">No roles (membership alone grants nothing)</span> : m.roles.map((r) => (
                          <span key={`${m.membershipId}:${r.role}:${r.facility_id ?? "tw"}`} className="chip chip-mapped" style={{ marginRight: 6 }}>
                            {ROLE_LABELS[r.role as Role] ?? r.role} · {flabel(r.facility_id)}
                            <button
                              type="button"
                              className="btn btn-icon btn-delete-row"
                              title={`Revoke ${r.role} (${flabel(r.facility_id)})`}
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await mrvFetch(`/orgs/${tenantId}/members/${m.membershipId}/roles`, {
                                    method: "POST",
                                    json: { role: r.role, facilityId: r.facility_id, grant: false },
                                  });
                                }, `Revoked ${ROLE_LABELS[r.role as Role] ?? r.role} for ${m.email}.`)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </td>
                      <td>{m.status === "active" ? <span className="badge badge-pass">Active</span> : <span className="badge badge-fail">Revoked</span>}</td>
                      <td className="text-sm">{fmtDate(m.joinedAt)}{m.revokedAt ? ` (revoked ${fmtDate(m.revokedAt)})` : ""}</td>
                      <td>
                        {m.status === "active" ? (
                          <MemberControls
                            member={m}
                            tenantId={tenantId}
                            facilities={facilities}
                            busy={busy}
                            facilityLabel={flabel}
                            onDone={(msg) => { setSuccess(msg); void load(); }}
                            onError={(msg) => setError(msg)}
                          />
                        ) : <span className="text-sm">Re-invite to restore access</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="section-card mb-lg">
        <SectionHeader icon="mail" title="Invitations" />
        <div className="section-card-body">
          {invitations.length === 0 ? <p className="text-sm">No invitations yet.</p> : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Scope</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invitations.map((i) => {
                    const st = invitationState(i);
                    return (
                      <tr key={i.id}>
                        <td className="mono">{i.email}</td>
                        <td>{ROLE_LABELS[i.role as Role] ?? i.role}</td>
                        <td>{flabel(i.facilityId)}</td>
                        <td className="text-sm">{fmtDate(i.createdAt)}</td>
                        <td className="text-sm">{fmtDate(i.expiresAt)}</td>
                        <td><span className={st.cls}>{st.label}</span></td>
                        <td>
                          {st.label === "Open" ? (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await mrvFetch(`/orgs/${tenantId}/members/invitations/${i.id}/revoke`, { method: "POST" });
                                }, `Revoked the invitation for ${i.email}.`)}
                            >
                              Revoke
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm mt-md">
            Invitation links are single-use, expire after 7 days and can only be accepted by an account with the invited email
            address. They are not emailed automatically — copy and send them yourself.
          </p>
        </div>
      </div>
    </div>
  );
}