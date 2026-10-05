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

function ProductionContent({ s }: { s: Store }) {
  const rows = s.production;
  const dates = rows.map((r) => fmtDate(r.Date));

  return (
    <>
      <PageHeader
        icon="factory"
        title="Production Input"
        desc="Monthly kiln clinker output, finished cement production, clinker-to-cement ratios, and additive mass balances."
        actions={<Chip status={`${rows.length} reporting months`} />}
      />

      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="trending-up" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Clinker & Cement Production Trend</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 220 }}>
            <LineChart
              labels={dates}
              yUnit="t"
              datasets={[
                { label: "Clinker Produced (t)", data: rows.map((r) => n(r["Clinker Produced t"])), color: "#00d4aa" },
                { label: "Cement Produced (t)", data: rows.map((r) => n(r["Cement Produced t"])), color: "#4facfe" },
              ]}
            />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="sliders" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Clinker Factor Trend</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 220 }}>
            <LineChart labels={dates} yUnit="ratio" datasets={[{ label: "Clinker Factor", data: rows.map((r) => n(r["Clinker Factor"])), color: "#f59e0b" }]} />
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="file-text" title="Monthly Production Register" />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Quarter</th>
                  <th>Kiln</th>
                  <th>Type</th>
                  <th className="num">Clinker Produced</th>
                  <th className="num">Cement Produced</th>
                  <th className="num">Clinker Used</th>
                  <th className="num">Gypsum</th>
                  <th className="num">Limestone Add.</th>
                  <th className="num">Other Add.</th>
                  <th className="num">Clinker Factor</th>
                  <th>Evidence ID</th>
                  <th>QA Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${fmtDate(r.Date)}-${String(r["Kiln Line"])}-${i}`}>
                    <td>{fmtDate(r.Date)}</td>
                    <td>{String(r.Quarter || "—")}</td>
                    <td>{String(r["Kiln Line"] || "—")}</td>
                    <td style={{ fontSize: 12 }}>{String(r["Cement Type"] || "—")}</td>
                    <td className="num">
                      <Fmt value={r["Clinker Produced t"]} unit="t" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Cement Produced t"]} unit="t" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Clinker Used t"]} unit="t" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Gypsum t"]} unit="t" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Limestone Additive t"]} unit="t" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Other Additives t"]} unit="t" />
                    </td>
                    <td className="num mono" style={{ color: "var(--accent)" }}>
                      <Fmt value={r["Clinker Factor"]} unit="ratio" />
                    </td>
                    <td>
                      <EvidenceLink id={r["Evidence ID"]} />
                    </td>
                    <td>
                      <QaBadge status={r["QA Status"]} />
                    </td>
                    <td style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 200 }}>{String(r.Notes || "")}</td>
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

export default function ProductionPage() {
  return <RequireWorkbook title="Production Input">{(s) => <ProductionContent s={s} />}</RequireWorkbook>;
}
