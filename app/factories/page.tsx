"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useScope } from "@/context/ScopeContext";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";

export default function FactoriesPage() {
  const s = useScope();
  const router = useRouter();
  const tenant = s.memberships.find(m => m.tenantId === s.tenantId);
  return <div className="page-container">
    <PageHeader icon="factory" title="Factories" desc={`${tenant?.name ?? "Organization"} · sites you are authorized to access`} />
    {s.status !== "ready" ? <ScopeNotice signIn={s.status === "signed-out"} title={s.status === "loading" ? "Loading factories…" : "Select an organization first"} desc="Factory access is managed within each organization." /> : <>
      <div className="organization-directory-heading"><p>{s.facilities.length} authorized factories</p><Link className="btn btn-secondary" href="/admin/access">Manage team &amp; access</Link></div>
      <div className="organization-factory-table"><table><thead><tr><th>Factory</th><th>Code</th><th>Timezone</th><th>Reporting boundary</th><th>Action</th></tr></thead><tbody>
        {s.facilities.map(f => <tr key={f.id}><td><strong>{f.name}</strong>{f.id === s.facilityId ? <small>Current factory</small> : null}</td><td>{f.code}</td><td>{f.timezone}</td><td>{f.reporting_boundary || "Not specified"}</td><td><button className="btn btn-secondary btn-sm" type="button" onClick={() => { s.selectFacility(f.id); router.push("/overview"); }}>Open factory →</button></td></tr>)}
      </tbody></table></div>
      {!s.facilities.length ? <p>No authorized factories. Contact your organization administrator to arrange factory access.</p> : null}
    </>}
  </div>;
}
