"use client";

import { LineChart } from "@/components/charts/ChartCanvas";
import { Icon } from "@/components/icons/Icon";
import { QaBadge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { EvidenceLink } from "@/components/ui/EvidenceLink";
import { Fmt } from "@/components/ui/Fmt";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { fmtDate } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}

function RawMaterialContent({ s }: { s: Store }) {
  const rows = s.rawMaterial;
  const dates = rows.map((r) => fmtDate(r.Date));

  return (
    <>
      <PageHeader
        icon="package"
        title="Raw Material Input"
        desc="Carbonate input consumption, chemical assay (CaCO₃, MgCO₃, moisture), and calcination process CO₂ (Method A)."
        actions={<Chip status={`${rows.length} records`} />}
      />

      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="trending-up" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Raw Material Quantity Trend</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 200 }}>
            <LineChart labels={dates} yUnit="t" datasets={[{ label: "Quantity (t)", data: rows.map((r) => n(r["Quantity t"])), color: "#00d4aa" }]} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bar-chart-2" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Process CO₂ Trend (Method A)</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 200 }}>
            <LineChart
              labels={dates}
              yUnit="tCO₂"
              datasets={[
                { label: "CaCO₃ CO₂ (t)", data: rows.map((r) => n(r["CaCO3 CO2 t"])), color: "#4facfe" },
                { label: "MgCO₃ CO₂ (t)", data: rows.map((r) => n(r["MgCO3 CO2 t"])), color: "#a78bfa" },
                { label: "Process CO₂ Method A (t)", data: rows.map((r) => n(r["Process CO2 Method A t"])), color: "#00d4aa" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="file-text" title="Monthly Raw Material Data" />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th className="num">Quantity (t)</th>
                  <th className="num">CaCO₃ %</th>
                  <th className="num">MgCO₃ %</th>
                  <th className="num">Moisture %</th>
                  <th className="num">Calcination Conv.</th>
                  <th className="num">CaCO₃ CO₂ (t)</th>
                  <th className="num">MgCO₃ CO₂ (t)</th>
                  <th className="num">Process CO₂ Method A (t)</th>
                  <th>Evidence ID</th>
                  <th>QA Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${fmtDate(r.Date)}-${String(r.Material)}-${i}`}>
                    <td>{fmtDate(r.Date)}</td>
                    <td>{String(r.Material || "—")}</td>
                    <td className="num">
                      <Fmt value={r["Quantity t"]} unit="t" />
                    </td>
                    <td className="num">
                      <Fmt value={r["CaCO3 %"]} unit="%" />
                    </td>
                    <td className="num">
                      <Fmt value={r["MgCO3 %"]} unit="%" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Moisture %"]} unit="%" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Calcination Conversion"]} unit="ratio" />
                    </td>
                    <td className="num">
                      <Fmt value={r["CaCO3 CO2 t"]} unit="tCO2" />
                    </td>
                    <td className="num">
                      <Fmt value={r["MgCO3 CO2 t"]} unit="tCO2" />
                    </td>
                    <td className="num mono" style={{ color: "var(--accent)" }}>
                      <Fmt value={r["Process CO2 Method A t"]} unit="tCO2" />
                    </td>
                    <td>
                      <EvidenceLink id={r["Evidence ID"]} />
                    </td>
                    <td>
                      <QaBadge status={r["QA Status"]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default function RawMaterialPage() {
  return <RequireWorkbook title="Raw Material Input">{(s) => <RawMaterialContent s={s} />}</RequireWorkbook>;
}
