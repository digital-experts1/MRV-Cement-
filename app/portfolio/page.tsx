"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { useScope } from "@/context/ScopeContext";

/**
 * Multi-factory consolidation has not yet been migrated to the Supabase persistence layer (Directive 05 vertical slice
 * covers one factory). The consolidation rules remain in lib/consolidation.ts; nothing is estimated here.
 */
export default function PortfolioPage() {
  const { status, memberships, tenantId, facilities } = useScope();
  if (status !== "ready" || !tenantId) {
    return (
      <div className="page-container">
        <PageHeader icon="trending-up" title="Portfolio" />
        <ScopeNotice signIn={status === "signed-out"} title="Sign in to view your organization's portfolio" desc="Portfolio views include only the factories you are authorized to access." />
      </div>
    );
  }
  const org = memberships.find((m) => m.tenantId === tenantId)?.name;
  return (
    <div className="page-container">
      <PageHeader icon="trending-up" title="Portfolio" desc={`${org ?? "Organization"} · ${facilities.length} authorized factor${facilities.length === 1 ? "y" : "ies"}`} />
      <div className="dataset-banner dataset-banner-warn" role="note">
        Portfolio consolidation across factories is not yet available on the persistent database. Open each factory from the scope bar to see its stored calculation
        for the selected range. No consolidated figure is shown rather than an incomplete one.
      </div>
    </div>
  );
}
