"use client";

import { BarChart } from "@/components/charts/ChartCanvas";
import { Icon } from "@/components/icons/Icon";
import { QaBadge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { EvidenceLink } from "@/components/ui/EvidenceLink";
import { Fmt } from "@/components/ui/Fmt";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { fmtDate, fmtDec, fmtInt } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}

function KilnFuelContent({ s }: { s: Store }) {
  const rows = s.kilnFuel;
  const fuels = [...new Set(rows.map((r) => String(r["Fuel Type"] || "")).filter(Boolean))];
  const fossilData = fuels.map((f) => rows.filter((r) => String(r["Fuel Type"]) === f).reduce((a, r) => a + n(r["Fossil CO2 t"]), 0));
  const biogenicData = fuels.map((f) => rows.filter((r) => String(r["Fuel Type"]) === f).reduce((a, r) => a + n(r["Biogenic CO2 Memo t"]), 0));
  const energyData = fuels.map((f) => rows.filter((r) => String(r["Fuel Type"]) === f).reduce((a, r) => a + n(r["Energy GJ"]), 0));
  const totalFossil = rows.reduce((a, r) => a + n(r["Fossil CO2 t"]), 0);
  const totalBiogenic = rows.reduce((a, r) => a + n(r["Biogenic CO2 Memo t"]), 0);
  const totalEnergy = rows.reduce((a, r) => a + n(r["Energy GJ"]), 0);
  const totalEnergyTj = rows.reduce((a, r) => a + n(r["Energy TJ"]), 0);

  return (
    <>
      <PageHeader
        icon="flame"
        title="Kiln Fuel Input"
        desc="Fuel quantities, net calorific values (NCV), emission factors, biomass fractions, and combustion CO₂ balances."
        actions={
          <>
            <span className="badge badge-accent">{fmtInt(totalFossil)} tCO₂ fossil</span>
            <span className="badge badge-purple">{fmtDec(totalBiogenic, 2)} tCO₂ biogenic</span>
            <span className="badge badge-info">{fmtInt(totalEnergy)} GJ energy</span>
          </>
        }
      />

      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bar-chart-2" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Fossil vs Biogenic CO₂ by Fuel Type</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 220 }}>
            <BarChart
              labels={fuels}
              yUnit="tCO₂"
              datasets={[
                { label: "Fossil CO₂ (t)", data: fossilData, color: "#f59e0b" },
                { label: "Biogenic CO₂ Memo (t)", data: biogenicData, color: "#a78bfa" },
              ]}
            />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="flame" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Energy by Fuel Type (GJ)</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 220 }}>
            <BarChart labels={fuels} yUnit="GJ" stacked datasets={[{ label: "Energy (GJ)", data: energyData, color: "#00d4aa" }]} />
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="file-text" title="Fuel Activity Register" actions={<Chip status={`${rows.length} rows`} />} />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Fuel Type</th>
                  <th className="num">Quantity</th>
                  <th>Unit</th>
                  <th className="num">NCV (GJ/unit)</th>
                  <th className="num">EF (tCO₂/TJ)</th>
                  <th className="num">Ox. Factor</th>
                  <th className="num">Biomass Frac.</th>
                  <th className="num">Fossil Frac.</th>
                  <th className="num">Energy (GJ)</th>
                  <th className="num">Energy (TJ)</th>
                  <th className="num">Fossil CO₂ (t)</th>
                  <th className="num">Biogenic CO₂ Memo (t)</th>
                  <th>Evidence ID</th>
                  <th>QA Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${fmtDate(r.Date)}-${String(r["Fuel Type"])}-${i}`}>
                    <td>{fmtDate(r.Date)}</td>
                    <td>
                      <strong>{String(r["Fuel Type"] || "—")}</strong>
                    </td>
                    <td className="num">
                      <Fmt value={r.Quantity} unit="t" />
                    </td>
                    <td className="unit-col">{String(r.Unit || "")}</td>
                    <td className="num">
                      <Fmt value={r["NCV GJ/unit"]} unit="GJ/t clinker" />
                    </td>
                    <td className="num">
                      <Fmt value={r["EF tCO2/TJ"]} unit="tCO2/TJ" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Oxidation Factor"]} unit="ratio" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Biomass Fraction"]} unit="ratio" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Fossil Fraction"]} unit="ratio" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Energy GJ"]} unit="GJ" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Energy TJ"]} unit="TJ" />
                    </td>
                    <td className="num mono" style={{ color: "var(--qa-warn)" }}>
                      <Fmt value={r["Fossil CO2 t"]} unit="tCO2" />
                    </td>
                    <td className="num mono" style={{ color: "var(--accent-3)" }}>
                      <Fmt value={r["Biogenic CO2 Memo t"]} unit="tCO2" />
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
              <tfoot style={{ borderTop: "2px solid var(--border-strong)" }}>
                <tr style={{ background: "rgba(15,31,61,0.6)" }}>
                  <td colSpan={2}>
                    <strong>TOTAL</strong>
                  </td>
                  <td /><td /><td /><td /><td /><td /><td />
                  <td className="num mono">
                    <strong>{fmtInt(totalEnergy)}</strong>
                  </td>
                  <td className="num mono">
                    <strong>{fmtDec(totalEnergyTj, 2)}</strong>
                  </td>
                  <td className="num mono" style={{ color: "var(--qa-warn)" }}>
                    <strong>{fmtDec(totalFossil, 2)}</strong>
                  </td>
                  <td className="num mono" style={{ color: "var(--accent-3)" }}>
                    <strong>{fmtDec(totalBiogenic, 2)}</strong>
                  </td>
                  <td /><td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default function KilnFuelPage() {
  return <RequireWorkbook title="Kiln Fuel Input">{(s) => <KilnFuelContent s={s} />}</RequireWorkbook>;
}
