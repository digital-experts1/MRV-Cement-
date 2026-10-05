"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { MissingBadge } from "@/components/ui/Badge";
import { Chip } from "@/components/ui/Chip";
import { Fmt } from "@/components/ui/Fmt";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { fmtDec, fmtInt } from "@/lib/formatter";
import type { Store } from "@/lib/types";

const HIGHLIGHT = new Set(["Direct Embedded CO2", "Total Embedded CO2", "Specific Embedded Emissions Cement", "SEE Clinker"]);

function FlowNode({ metric, unit, dp, highlight, calcs }: { metric: string; unit: string; dp?: number; highlight?: boolean; calcs: Store["calculations"] }) {
  const row = calcs[metric];
  const v = row?.Value;
  let val: ReactNode = "—";
  if (row && (v === null || v === undefined)) val = <MissingBadge />;
  else if (row) {
    const num = parseFloat(String(v));
    val = Number.isNaN(num) ? String(v) : dp !== undefined ? fmtDec(num, dp) : fmtInt(num);
  }
  return (
    <div className={`flow-node${highlight ? " highlight" : ""}`}>
      <div className="fn-label">{metric}</div>
      <div className="fn-val">{val}</div>
      <div className="fn-unit">{unit || String(row?.Unit || "")}</div>
    </div>
  );
}

function FlowConnector({ symbol }: { symbol: string }) {
  return <div className={`flow-connector${symbol === "→" ? " arrow" : ""}`}>{symbol}</div>;
}

function CalculationsContent({ s }: { s: Store }) {
  const c = s.calculations;
  const biogenic = parseFloat(String(c["Biogenic CO2 Memo"]?.Value)) || 0;

  return (
    <>
      <PageHeader
        icon="calculator"
        title="Calculations"
        desc="Complete MRV mathematical chain: process calcination, fuel combustion, grid Scope 2, and specific emissions intensity."
        actions={<Chip status={`${s.calcRows.length} certified metrics`} />}
      />

      <div className="section-card mb-lg">
        <SectionHeader icon="network" title="Calculation Flow Diagram" />
        <div className="section-card-body">
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
              Step 1 — Direct Embedded CO₂ (Process + Fuel)
            </div>
            <div className="flow-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <FlowNode metric="Selected Process CO2" unit="tCO₂" dp={0} calcs={c} />
              <FlowConnector symbol="+" />
              <FlowNode metric="Fuel Combustion CO2" unit="tCO₂" dp={2} calcs={c} />
              <FlowConnector symbol="=" />
              <FlowNode metric="Direct Embedded CO2" unit="tCO₂" dp={2} highlight calcs={c} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
              Step 2 — Total Embedded CO₂ (Direct + Indirect Grid)
            </div>
            <div className="flow-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <FlowNode metric="Direct Embedded CO2" unit="tCO₂" dp={2} calcs={c} />
              <FlowConnector symbol="+" />
              <FlowNode metric="Indirect Grid CO2" unit="tCO₂" dp={0} calcs={c} />
              <FlowConnector symbol="=" />
              <FlowNode metric="Total Embedded CO2" unit="tCO₂" dp={2} highlight calcs={c} />
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
              Step 3 — Specific Embedded Emissions (SEE Cement)
            </div>
            <div className="flow-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <FlowNode metric="Total Embedded CO2" unit="tCO₂" dp={2} calcs={c} />
              <FlowConnector symbol="÷" />
              <FlowNode metric="Cement Produced" unit="t" dp={0} calcs={c} />
              <FlowConnector symbol="=" />
              <FlowNode metric="Specific Embedded Emissions Cement" unit="tCO₂/t cement" dp={4} highlight calcs={c} />
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10 }}>
              Step 4 — Specific Embedded Emissions (SEE Clinker)
            </div>
            <div className="flow-row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <FlowNode metric="Direct Embedded CO2" unit="tCO₂" dp={2} calcs={c} />
              <FlowConnector symbol="÷" />
              <FlowNode metric="Clinker Produced" unit="t" dp={0} calcs={c} />
              <FlowConnector symbol="=" />
              <FlowNode metric="SEE Clinker" unit="tCO₂/t clinker" dp={4} highlight calcs={c} />
            </div>
          </div>

          <div style={{ marginTop: 16, padding: "12px 16px", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.25)", borderRadius: "var(--r)", fontSize: 12, color: "var(--accent-3)", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="info" size={15} />
            <div>
              <strong>Biogenic CO₂ Memo:</strong> {fmtDec(biogenic, 2)} tCO₂ — reported separately, not counted in embedded emissions per CBAM rules.
            </div>
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="file-text" title="Full Calculation Chain" />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Formula / Link</th>
                  <th className="num">Value</th>
                  <th>Unit</th>
                  <th>Governance Note</th>
                  <th>QA Source</th>
                </tr>
              </thead>
              <tbody>
                {s.calcRows.map((r, i) => {
                  const isHighlight = HIGHLIGHT.has(String(r.Metric));
                  return (
                    <tr key={`${String(r.Metric)}-${i}`} style={isHighlight ? { background: "rgba(0,212,170,0.04)" } : undefined}>
                      <td>
                        <strong style={isHighlight ? { color: "var(--accent)" } : undefined}>{String(r.Metric || "")}</strong>
                      </td>
                      <td className="mono" style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 200 }}>
                        {String(r["Formula / Link"] || "")}
                      </td>
                      <td className="num mono" style={isHighlight ? { color: "var(--accent)", fontWeight: 700 } : undefined}>
                        {r.Value !== null && r.Value !== undefined ? <Fmt value={r.Value} unit={String(r.Unit || "")} /> : <MissingBadge />}
                      </td>
                      <td className="unit-col">{String(r.Unit || "")}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 280 }}>{String(r["Governance note"] || "")}</td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(r["QA Source"] || "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default function CalculationsPage() {
  return <RequireWorkbook title="Calculations">{(s) => <CalculationsContent s={s} />}</RequireWorkbook>;
}
