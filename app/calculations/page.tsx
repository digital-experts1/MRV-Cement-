"use client";

import { useState, type ReactNode } from "react";
import { useScope } from "@/context/ScopeContext";
import { Icon } from "@/components/icons/Icon";
import { AssertionsPanel } from "@/components/ui/AssertionsPanel";
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

function metricNumber(s: Store, key: string): number | null {
  const raw = s.calculations[key]?.Value;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function MetricCard({ label, value, unit, digits = 0 }: { label: string; value: number | null; unit: string; digits?: number }) {
  return (
    <div style={{ padding: "20px", border: "1px solid var(--border)", borderRadius: 14, background: "var(--surface, var(--bg-card, transparent))", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}>{label}</div>
      <div className="mono" style={{ fontSize: "clamp(22px, 2.4vw, 32px)", fontWeight: 750, lineHeight: 1.2, overflowWrap: "anywhere" }}>
        {value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{unit}</div>
    </div>
  );
}

function EmissionsComposition({ s }: { s: Store }) {
  const entries = [
    { name: "Process calcination", value: metricNumber(s, "Selected Process CO2"), color: "#0ea5a4" },
    { name: "Fuel combustion", value: metricNumber(s, "Fuel Combustion CO2"), color: "#f59e0b" },
    { name: "Indirect grid", value: metricNumber(s, "Indirect Grid CO2"), color: "#818cf8" },
  ];
  const complete = entries.every((e) => e.value !== null && e.value >= 0);
  const total = complete ? entries.reduce((sum, e) => sum + (e.value ?? 0), 0) : 0;
  return (
    <div className="section-card mb-lg">
      <SectionHeader icon="activity" title="Emissions composition" />
      <div className="section-card-body">
        {!complete || total <= 0 ? (
          <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: 0 }}>A complete, positive emissions breakdown is not available for this calculation run. Missing values are not treated as zero.</p>
        ) : (
          <>
            <div role="img" aria-label={entries.map(e => `${e.name}: ${((e.value ?? 0) / total * 100).toFixed(1)} percent`).join("; ")}
              style={{ display: "flex", width: "100%", height: 24, overflow: "hidden", borderRadius: 8, marginBottom: 18 }}>
              {entries.map(e => <div key={e.name} style={{ width: `${(e.value ?? 0) / total * 100}%`, background: e.color }} />)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
              {entries.map(e => (
                <div key={e.name} style={{ fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--text-secondary)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: e.color }} />{e.name}
                  </div>
                  <strong className="mono" style={{ display: "block", marginTop: 7, fontSize: 17 }}>{((e.value ?? 0) / total * 100).toFixed(1)}%</strong>
                  <span style={{ color: "var(--text-muted)" }}>{(e.value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} tCO₂</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CalculationsContent({ s }: { s: Store }) {
  const c = s.calculations;
  const scope = useScope();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const biogenicRaw = c["Biogenic CO2 Memo"]?.Value;
  const biogenic = typeof biogenicRaw === "number" ? `${fmtDec(biogenicRaw, 2)} tCO₂` : "not calculated";

  return (
    <>
      <PageHeader
        icon="calculator"
        title="Calculations"
        desc="Complete MRV mathematical chain: process calcination, fuel combustion, grid Scope 2, and specific emissions intensity."
        actions={<Chip status={`${s.calcRows.length} computed metrics`} />}
      />

      <div className="section-card mb-lg">
        <div className="section-card-body" style={{ display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)" }}>Reporting scope</div>
            <strong>{scope.facility?.name ?? "Selected facility"}</strong>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
              {scope.range ? `${scope.range.start} to ${scope.range.end} · ${scope.range.timezone}` : "No reporting range selected"}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            {s.meta.run?.stale ? "Stale saved calculation" : s.meta.run ? "Saved calculation run" : "Unpersisted calculation"}
            <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>{s.meta.run?.id ? `Run ${s.meta.run.id.slice(0, 8)}` : "No run ID"}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 20 }}>
        <MetricCard label="Total embedded emissions" value={metricNumber(s, "Total Embedded CO2")} unit="tCO₂" digits={2} />
        <MetricCard label="Cement emissions intensity" value={metricNumber(s, "Specific Embedded Emissions Cement")} unit="tCO₂ / t cement" digits={4} />
        <MetricCard label="Cement produced" value={metricNumber(s, "Cement Produced")} unit="tonnes" />
        <MetricCard label="Required data completeness" value={Number.isFinite(s.completeness.pct) ? s.completeness.pct : null} unit="% of required inputs" digits={1} />
      </div>
      <EmissionsComposition s={s} />
      <div style={{ marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 12 }}>
        <span className="badge">{s.readiness.status === "READY_FOR_INTERNAL_REVIEW" ? "Ready for internal review" : "Not ready for review"}</span>
        <span style={{ color: "var(--text-secondary)" }}>{s.inputIssues.length} rejected inputs · {s.assertions.filter(a => a.outcome === "MISMATCH").length} workbook mismatches</span>
      </div>
      <AssertionsPanel s={s} />

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
              <strong>Biogenic CO₂ Memo:</strong> {biogenic} — reported separately, not counted in direct embedded emissions.
            </div>
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader icon="file-text" title="Full Calculation Chain" />
        {detailsOpen ? <div className="section-card-body no-pad">
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
        </div> : null}
      </div>
    </>
  );
}

export default function CalculationsPage() {
  return <RequireWorkbook title="Calculations">{(s) => <CalculationsContent s={s} />}</RequireWorkbook>;
}
