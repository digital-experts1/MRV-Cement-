"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { useScope } from "@/context/ScopeContext";
import { RangeSelector } from "./RangeSelector";
import { RunStatus } from "./RunStatus";

/** Always-visible active organization, factory and reporting range. Lists contain only server-authorized entries. */
export function ScopeBar() {
  const s = useScope();

  if (s.status === "loading") return <div className="scope-bar scope-muted">Loading workspace…</div>;
  if (s.status === "signed-out") {
    return (
      <div className="scope-bar">
        <span className="scope-muted">Not signed in · data is stored per organization and requires an account</span>
        <Link className="btn btn-primary btn-sm" href="/signin">
          <Icon name="lock" size={13} /> <span className="btn-label">Sign in</span>
        </Link>
      </div>
    );
  }
  if (s.status === "no-organization") {
    return (
      <div className="scope-bar">
        <span className="scope-muted">Signed in as {s.user?.email} · no organization yet</span>
        <Link className="btn btn-primary btn-sm" href="/onboarding">
          Create organization
        </Link>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void s.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  const tenant = s.memberships.find((m) => m.tenantId === s.tenantId);
  return (
    <>
      <div className="scope-bar" aria-label="Active scope">
        <label className="scope-field">
          <span className="scope-label">Organization</span>
          {s.memberships.length > 1 ? (
            <select className="scope-select" value={s.tenantId ?? ""} onChange={(e) => s.selectTenant(e.target.value)}>
              {s.memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="scope-value">{tenant?.name ?? "No organization"}</span>
          )}
        </label>
        <label className="scope-field">
          <span className="scope-label">Factory</span>
          {s.facilities.length ? (
            <select className="scope-select" value={s.facilityId ?? ""} onChange={(e) => s.selectFacility(e.target.value)}>
              {s.facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="scope-value scope-muted">No authorized factory</span>
          )}
        </label>
        {s.facility ? (
          <div className="scope-field">
            <span className="scope-label">Reporting range</span>
            <RangeSelector spec={s.rangeSpec} resolved={s.range} timezone={s.facility.timezone} onChange={s.selectRange} disabled={s.calculating} />
          </div>
        ) : null}
        {tenant?.synthetic ? <span className="badge badge-info" style={{ fontSize: 10.5 }}>Demo organization</span> : null}
        <span className="scope-user" title={s.user?.email}>
          {s.user?.displayName}
        </span>
        <Link className="btn btn-secondary btn-sm" href="/onboarding" title="Create another organization">
          +
        </Link>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void s.signOut()}>
          Sign out
        </button>
        {s.error ? <span className="badge badge-warn" title={s.error}>Error: {s.error.slice(0, 60)}</span> : null}
      </div>
      {s.facility ? <RunStatus /> : null}
    </>
  );
}
