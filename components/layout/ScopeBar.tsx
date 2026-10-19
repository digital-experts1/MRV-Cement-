"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { useScope } from "@/context/ScopeContext";

/** Always-visible active organization, factory and reporting period. Lists contain only server-authorized entries. */
export function ScopeBar() {
  const s = useScope();

  if (s.status === "loading") return <div className="scope-bar scope-muted">Loading access…</div>;
  if (s.status === "signed-out") {
    return (
      <div className="scope-bar">
        <span className="scope-muted">Local workspace · not signed in</span>
        <Link className="btn btn-secondary btn-sm" href="/signin">
          <Icon name="lock" size={13} /> <span className="btn-label">Sign in</span>
        </Link>
      </div>
    );
  }

  const tenant = s.memberships.find((m) => m.tenantId === s.tenantId);
  return (
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
      <label className="scope-field">
        <span className="scope-label">Period</span>
        {s.periods.length ? (
          <select className="scope-select" value={s.periodId ?? ""} onChange={(e) => s.selectPeriod(e.target.value)}>
            {s.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.start_date} – {p.end_date})
              </option>
            ))}
          </select>
        ) : (
          <span className="scope-value scope-muted">—</span>
        )}
      </label>
      {tenant?.synthetic ? <span className="badge badge-fail" style={{ fontSize: 10.5 }}>SYNTHETIC ORG</span> : null}
      <span className="scope-user" title={s.user?.email}>
        {s.user?.displayName}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void s.signOut()}>
        Sign out
      </button>
      {s.error ? <span className="badge badge-warn" title={s.error}>Scope error</span> : null}
    </div>
  );
}
