"use client";

import Link from "next/link";
import { useScope } from "@/context/ScopeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";

export default function OrganizationsPage() {
  const s = useScope();
  return <div className="page-container">
    <PageHeader icon="network" title="Organizations" desc="Choose a workspace, manage access or create another organization." />
    {s.status === "loading" ? <p role="status">Loading organizations…</p> : s.status === "signed-out" ? <ScopeNotice signIn title="Sign in to view your organizations" desc="Only organizations you belong to appear here." /> : <>
      <div className="organization-directory-heading"><p>{s.memberships.length} organization{s.memberships.length === 1 ? "" : "s"} available to your account</p><Link className="btn btn-primary" href="/onboarding">+ Add organization</Link></div>
      <div className="organization-directory">
        {s.memberships.map(m => <article key={m.tenantId} className={`organization-directory-card${m.tenantId === s.tenantId ? " is-current" : ""}`}>
          <span className="organization-avatar" aria-hidden="true">{m.name.slice(0, 2).toUpperCase()}</span>
          <h2>{m.name}</h2><span className={`badge ${m.synthetic ? "badge-info" : ""}`}>{m.synthetic ? "Demo · synthetic data" : "Organization workspace"}</span>
          {m.tenantId === s.tenantId ? <><p className="scope-muted">Current workspace · {s.facilities.length} authorized factories</p><div className="organization-card-actions"><Link href="/factories">View factories →</Link><Link href="/admin/access">Team &amp; access →</Link></div></> : <button type="button" className="btn btn-secondary" onClick={() => s.selectTenant(m.tenantId)}>Switch organization →</button>}
        </article>)}
      </div>
      {!s.memberships.length ? <p>Create your first organization to connect factories and invite your team.</p> : null}
    </>}
  </div>;
}
