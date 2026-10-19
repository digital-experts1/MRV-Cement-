"use client";

import { useEffect, useState } from "react";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { ScopeNotice } from "@/components/ui/ScopeNotice";
import { StaleScopeError, useScope } from "@/context/ScopeContext";
import type { ConsolidatedResult } from "@/lib/consolidation";

interface Portfolio {
  start: string;
  end: string;
  authorizedFacilityCount: number;
  notIncluded: { facilityId: string; facilityName: string; reason: string }[];
  clinker: ConsolidatedResult;
  cement: ConsolidatedResult;
  engineNote: string;
}

const fmt = (v: string | null, dp = 0) =>
  v === null ? "—" : new Intl.NumberFormat("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(Number(v));

function BasisTable({ r }: { r: ConsolidatedResult }) {
  const unit = r.basis === "clinker" ? "t clinker" : "t cement";
  return (
    <div className="section-card mb-lg">
      <SectionHeader icon="trending-up" title={`Consolidated intensity — ${r.basis} basis`} />
      <div className="section-card-body no-pad">
        <table className="data-table">
          <thead>
            <tr>
              <th>Factory</th>
              <th>Reporting boundary</th>
              <th>Period</th>
              <th className="num">Scope 1 (tCO2)</th>
              <th className="num">Production ({unit})</th>
              <th className="num">Facility intensity</th>
            </tr>
          </thead>
          <tbody>
            {r.facilities.map((f) => (
              <tr key={f.facilityId}>
                <td>
                  {f.facilityName} {f.synthetic ? <span className="badge badge-fail" style={{ fontSize: 10 }}>SYNTHETIC</span> : null}
                </td>
                <td className="unit-col">{f.reportingBoundary}</td>
                <td className="mono">
                  {f.periodStart} – {f.periodEnd}
                </td>
                <td className="num">{fmt(f.scope1Tco2)}</td>
                <td className="num">{fmt(r.basis === "clinker" ? f.clinkerT : f.cementT)}</td>
                <td className="num">{fmt(f.intensity, 4)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ fontWeight: 700 }}>
                Consolidated (Σ emissions ÷ Σ production{Number(r.excludedInternalTransfersT) ? `, ${fmt(r.excludedInternalTransfersT)} t internal transfers removed` : ""})
              </td>
              <td className="num" style={{ fontWeight: 700 }}>{fmt(r.totalScope1Tco2)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{fmt(r.totalDenominatorT)}</td>
              <td className="num" style={{ fontWeight: 700 }}>{fmt(r.consolidatedIntensity, 4)}</td>
            </tr>
          </tbody>
        </table>
        {r.withheldReasons.length ? (
          <div className="dataset-banner dataset-banner-warn" style={{ margin: 12 }}>
            Consolidated value withheld: {r.withheldReasons.join(" ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Tenant-level view across the factories the signed-in user is authorized to see. */
export default function PortfolioPage() {
  const { status, tenantId, periods, periodId, scopedFetch, memberships } = useScope();
  const period = periods.find((p) => p.id === periodId);
  const [data, setData] = useState<Portfolio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!tenantId || !period) return;
    scopedFetch<Portfolio>(`/tenants/${tenantId}/portfolio?start=${period.start_date}&end=${period.end_date}`)
      .then(setData)
      .catch((e) => {
        if (!(e instanceof StaleScopeError)) setError(e instanceof Error ? e.message : String(e));
      });
  }, [tenantId, period, scopedFetch]);

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
      <PageHeader
        icon="trending-up"
        title="Portfolio"
        desc={`${org ?? "Organization"} · ${period ? `${period.start_date} – ${period.end_date}` : "select a period"} · authorized factories only. Intensities are never averaged.`}
      />
      {error ? <div className="dataset-banner dataset-banner-warn">{error}</div> : null}
      {data ? (
        <>
          <div className="dataset-banner dataset-banner-warn" role="note">
            {data.engineNote} Not externally verified.
          </div>
          <BasisTable r={data.clinker} />
          <BasisTable r={data.cement} />
          {data.notIncluded.length ? (
            <div className="section-card mb-lg">
              <SectionHeader icon="alert-triangle" title="Authorized factories not included" />
              <div className="section-card-body">
                <ul style={{ fontSize: 12.5, margin: "0 0 0 18px" }}>
                  {data.notIncluded.map((n) => (
                    <li key={n.facilityId}>
                      {n.facilityName}: {n.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <div className="section-card">
            <SectionHeader icon="info" title="Consolidation treatment" />
            <div className="section-card-body">
              <ul style={{ fontSize: 12.5, margin: "0 0 0 18px", lineHeight: 1.6 }}>
                {data.cement.treatment.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
