"use client";

import Link from "next/link";
import { useRef } from "react";
import { useScope } from "@/context/ScopeContext";
import { Icon } from "@/components/icons/Icon";

export function OrganizationSwitcher() {
  const s = useScope();
  const panel = useRef<HTMLDetailsElement>(null);
  const current = s.memberships.find(m => m.tenantId === s.tenantId);
  const close = () => { if (panel.current) panel.current.open = false; };
  return <details className="organization-switcher" ref={panel} onKeyDown={e => {
    if (e.key === "Escape") { close(); panel.current?.querySelector("summary")?.focus(); }
  }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) close(); }}>
    <summary title={current?.name ?? "Organization workspace"}>
      <span className="organization-avatar" aria-hidden="true">{current?.name.slice(0, 2).toUpperCase() || "OR"}</span>
      <span className="organization-switcher-name"><small>Organization</small><strong>{s.status === "loading" ? "Loading…" : current?.name ?? "Choose workspace"}</strong></span>
      <Icon name="chevron-down" size={14} />
    </summary>
    <div className="organization-switcher-options">
      <span className="organization-menu-label">Your organizations</span>
      {s.memberships.map(m => <button key={m.tenantId} type="button" disabled={s.status === "loading"} aria-pressed={m.tenantId === s.tenantId} onClick={() => { s.selectTenant(m.tenantId); close(); }}>
        <span>{m.name}{m.synthetic ? <small>Demo workspace</small> : null}</span>{m.tenantId === s.tenantId ? <Icon name="check-circle" size={16} /> : null}
      </button>)}
      {s.status === "signed-out" ? <Link href="/signin" onClick={close}>Sign in</Link> : <><Link href="/onboarding" onClick={close}>+ Add organization</Link><Link href="/organizations" onClick={close}>Manage organizations</Link></>}
    </div>
  </details>;
}
