"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { strictNumberOrNull } from "@/lib/numeric";
import { DemoElectricity } from "@/components/dcs/DemoElectricity";
import { LineChart } from "@/components/charts/ChartCanvas";
import { Icon } from "@/components/icons/Icon";
import { QaBadge } from "@/components/ui/Badge";
import { EvidenceLink } from "@/components/ui/EvidenceLink";
import { Fmt } from "@/components/ui/Fmt";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { fmtDateFull, fmtDec, fmtInt } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function n(v: unknown): number | null { return strictNumberOrNull(v); }
function total(rows: Store["electricity"],field:string):number|null {
  if(!rows.length || rows.some(r=>n(r[field])===null))return null;
  return rows.reduce((sum,r)=>sum.plus(n(r[field])!),new Decimal(0)).toNumber();
}

function ElectricityContent({ s }: { s: Store }) {
  const [meter,setMeter]=useState("");
  const rows = s.electricity.filter(r=>!meter||String(r["Meter / Source"])===meter).slice().sort((a,b)=>String(a.Date).localeCompare(String(b.Date)));
  const dates = rows.map((r) => fmtDateFull(r.Date));
  const totalMWh = total(rows,"Grid MWh");
  const totalCO2 = total(rows,"Grid CO2 t");

  return (
    <>
      <PageHeader
        icon="zap"
        title="Electricity Input"
        desc="Purchased grid electricity, on-site generation, grid emission factors, and Scope 2 indirect carbon accounting."
        actions={
          <>
            <span className="badge badge-info">{totalMWh === null ? "Missing" : fmtInt(totalMWh)} MWh imported</span>
            <span className="badge badge-accent">{totalCO2 === null ? "Missing" : fmtDec(totalCO2, 2)} tCO₂ indirect</span>
          </>
        }
      />

      <DemoElectricity key={`${s.meta.revision}:${s.meta.run?.id}`} s={s} />
      <label className="dcs-filter">Meter / source<select value={meter} onChange={e=>setMeter(e.target.value)}><option value="">All meters (individual source rows)</option>{[...new Set(s.electricity.map(r=>String(r["Meter / Source"]??"")))].filter(Boolean).map(m=><option key={m}>{m}</option>)}</select></label>
      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="trending-up" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Grid Electricity Consumption Trend</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 200 }}>
            <LineChart labels={dates} yUnit="MWh" datasets={[{ label: "Grid MWh", data: rows.map((r) => n(r["Grid MWh"])), color: "#4facfe" }]} />
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bar-chart-2" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Indirect Grid CO₂ Trend</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 200 }}>
            <LineChart labels={dates} yUnit="tCO₂" datasets={[{ label: "Indirect Grid CO₂ (t)", data: rows.map((r) => n(r["Grid CO2 t"])), color: "#00d4aa" }]} />
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="file-text" title="Electricity source readings" />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Meter / Source</th>
                  <th className="num">Grid MWh</th>
                  <th className="num">Grid EF (tCO₂/MWh)</th>
                  <th className="num">Grid CO₂ (t)</th>
                  <th className="num">Self-gen MWh</th>
                  <th className="num">Self-gen EF</th>
                  <th className="num">Self-gen CO₂ (t)</th>
                  <th className="num">Renewable MWh</th>
                  <th>Evidence ID</th>
                  <th>QA Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${fmtDateFull(r.Date)}-${String(r["Meter / Source"])}-${i}`}>
                    <td>{fmtDateFull(r.Date)}</td>
                    <td style={{ fontSize: 12 }}>{String(r["Meter / Source"] || "—")}</td>
                    <td className="num">
                      <Fmt value={r["Grid MWh"]} unit="MWh" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Grid EF tCO2/MWh"]} unit="tCO2/MWh" />
                    </td>
                    <td className="num mono" style={{ color: "var(--accent)" }}>
                      <Fmt value={r["Grid CO2 t"]} unit="tCO2" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Self-generation MWh"]} unit="MWh" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Self-generation EF"]} unit="tCO2/MWh" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Self-generation CO2 t"]} unit="tCO2" />
                    </td>
                    <td className="num">
                      <Fmt value={r["Renewable MWh"]} unit="MWh" />
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
                <tr style={{ background: "var(--bg-base)" }}>
                  <td colSpan={2}>
                    <strong>TOTAL</strong>
                  </td>
                  <td className="num mono">
                    <strong>{totalMWh === null ? "Missing" : fmtInt(totalMWh)}</strong>
                  </td>
                  <td />
                  <td className="num mono" style={{ color: "var(--accent)" }}>
                    <strong>{totalCO2 === null ? "Missing" : fmtDec(totalCO2, 2)}</strong>
                  </td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ElectricityPage() {
  return <RequireWorkbook title="Electricity Input">{(s) => <ElectricityContent s={s} />}</RequireWorkbook>;
}
