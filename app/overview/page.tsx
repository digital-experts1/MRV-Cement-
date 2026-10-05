"use client";

import Link from "next/link";
import { DonutChart } from "@/components/charts/ChartCanvas";
import { Icon } from "@/components/icons/Icon";
import { QaDot } from "@/components/ui/Badge";
import { Fmt } from "@/components/ui/Fmt";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { useExplainer } from "@/context/ExplainerContext";
import { CO2_COLORS } from "@/lib/charts";
import { buildFallbackBreakdown } from "@/lib/breakdown";
import { fmtDec, fmtInt, fmtRaw } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function OverviewContent({ s }: { s: Store }) {
  const { showExplanation } = useExplainer();
  const calcs = s.calculations;
  const dash = s.dashboard;

  const clinkerProd = calcs["Clinker Produced"]?.Value;
  const cementProd = calcs["Cement Produced"]?.Value;
  const clinkerFactor = calcs["Clinker Factor"]?.Value;
  const directCO2 = calcs["Direct Embedded CO2"]?.Value;
  const totalCO2 = calcs["Total Embedded CO2"]?.Value;
  const seeCement = calcs["Specific Embedded Emissions Cement"]?.Value;
  const tsr = calcs["Thermal Substitution Rate (TSR)"]?.Value ?? calcs["Thermal Substitution Rate"]?.Value;
  const shc = calcs["Specific Heat Consumption"]?.Value;
  const qaStatus = String(calcs["QA/QC Overall Status"]?.Value || "—");
  const evStatus = calcs["Evidence Status"]?.Value;

  const total = s.qaqc.length;
  const passed = s.qaqc.filter((r) => String(r.Status).toUpperCase() === "PASS").length;
  const failed = s.qaqc.filter((r) => String(r.Status).toUpperCase() === "FAIL").length;
  const qaPct = total > 0 ? Math.round((passed / total) * 100) : 0;

  const evTotal = s.evidence.length;
  const evMapped = s.evidence.filter((r) => String(r.Status) === "Mapped").length;
  const evPending = evTotal - evMapped;

  const breakdown = dash.co2Breakdown.length > 0 ? dash.co2Breakdown : buildFallbackBreakdown(calcs);

  const site = String(s.setup["Installation / site"] || "—");
  const country = String(s.setup["Country"] || "—");
  const quarter = String(s.setup["Reporting quarter"] || "—");
  const product = String(s.setup["Primary product"] || "—");
  const pStart = String(s.setup["Period start"] || "—");
  const pEnd = String(s.setup["Period end"] || "—");
  const method = String(s.setup["Selected calcination method"] || "—");
  const version = String(s.readme.find((r) => r.Control === "Workbook Version")?.Value || "—");

  const qaColor = qaStatus === "PASS" ? "pass" : "fail";
  const tsrVal = tsr !== null && tsr !== undefined ? fmtDec(parseFloat(String(tsr)), 2) : "—";

  const cats: Record<string, { pass: number; total: number }> = {};
  s.qaqc.forEach((r) => {
    const cat = String(r.Category || "Other");
    if (!cats[cat]) cats[cat] = { pass: 0, total: 0 };
    cats[cat].total++;
    if (String(r.Status).toUpperCase() === "PASS") cats[cat].pass++;
  });

  return (
    <>
      <PageHeader
        icon="home"
        title="Overview"
        desc={`Here's your plant at a glance — ${site}, ${country} · ${quarter} · ${product}`}
        actions={
          <>
            <span className={`badge badge-${qaColor}`} style={{ cursor: "pointer" }} onClick={() => showExplanation("kpi-qaqc-status")}>
              <QaDot status={qaStatus} /> QA/QC {qaStatus}
            </span>
            <span className="badge badge-accent">v{version}</span>
          </>
        }
      />

      <div className="grid-4 mb-lg">
        <KpiCard label="Clinker Production" value={fmtRaw(clinkerProd, 0)} unit="t" desc="Total kiln clinker produced in period" explainKey="kpi-clinker-prod" className="accent-card" />
        <KpiCard label="Cement Production" value={fmtRaw(cementProd, 0)} unit="t" desc="Total finished cement dispatched" explainKey="kpi-cement-prod" className="accent-card" />
        <KpiCard label="Clinker Factor" value={fmtRaw(clinkerFactor, 3)} unit="ratio" desc="Proportion of clinker per ton of cement" explainKey="kpi-clinker-factor" />
        <KpiCard label="Specific Heat" value={fmtRaw(shc, 3)} unit="GJ/t clinker" desc="Thermal energy consumed per ton clinker" explainKey="kpi-specific-heat" />
      </div>

      <div className="grid-4 mb-lg">
        <KpiCard label="Direct Embedded CO₂" value={fmtRaw(directCO2, 0)} unit="tCO₂" desc="Process calcination + fuel combustion" explainKey="kpi-direct-co2" />
        <KpiCard label="Total Embedded CO₂" value={fmtRaw(totalCO2, 0)} unit="tCO₂" desc="Scope 1 direct + Scope 2 grid electricity" explainKey="kpi-total-co2" />
        <KpiCard label="SEE Cement" value={fmtRaw(seeCement, 4)} unit="tCO₂/t cement" desc="Specific embedded emissions intensity" explainKey="kpi-see-cement" />
        <KpiCard label="Thermal Substitution" value={tsrVal} unit={tsrVal !== "—" ? "%" : ""} desc="Alternative fuel thermal share" explainKey="kpi-tsr" />
      </div>

      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bar-chart-2" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>CO₂ Component Breakdown</h3>
            </div>
            <span className="badge badge-accent">{fmtRaw(totalCO2, 0)} tCO₂ total</span>
          </div>
          <div className="donut-split">
            <div className="chart-container donut-chart">
              <DonutChart breakdown={breakdown} />
            </div>
            <div style={{ flex: 1 }}>
              {breakdown.map((d) => (
                <div className="metric-row" key={d.component}>
                  <span className="metric-dot" style={{ background: CO2_COLORS[d.component] || "#60a5fa" }} />
                  <span className="metric-name">{d.component}</span>
                  <span className="metric-value">{fmtInt(d.tCO2)}</span>
                  <span className="metric-share">{fmtDec((d.share || 0) * 100, 1)}%</span>
                </div>
              ))}
              <div className="divider" style={{ margin: "12px 0" }} />
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                Direct = Calcination + Fuel Combustion
                <br />
                Total = Direct + Indirect Grid CO₂
              </div>
            </div>
          </div>
        </div>

        <div className="section-card">
          <SectionHeader icon="file-text" title="Workbook Context" actions={<span className="chip chip-controlled">v{version}</span>} />
          <div className="section-card-body" style={{ padding: 0 }}>
            <div className="kv-panel">
              {[
                ["Site", site],
                ["Country", country],
                ["Reporting Quarter", quarter],
                ["Period", `${pStart} → ${pEnd}`],
                ["Product", product],
                ["Calcination Method", method],
                ["Evidence Status", String(evStatus || "—")],
              ].map(([k, v]) => (
                <div className="kv-row" key={k}>
                  <span className="kv-key">{k}</span>
                  <span className="kv-val">{v}</span>
                </div>
              ))}
              <div className="kv-row">
                <span className="kv-key">QA/QC Status</span>
                <span className="kv-val">
                  <span className={`badge badge-${qaColor}`}>
                    <QaDot status={qaStatus} /> {qaStatus}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2 mb-lg">
        <div className="section-card">
          <SectionHeader
            icon="check-circle"
            title="QA/QC Summary"
            actions={
              <Link className="btn btn-secondary btn-sm" href="/qaqc">
                View All Checks <Icon name="chevron-right" size={12} />
              </Link>
            }
          />
          <div className="section-card-body">
            <div className="scorecard" style={{ padding: 0, background: "transparent", border: "none", marginBottom: 16 }}>
              <div className="scorecard-metric" style={{ paddingRight: 24 }}>
                <div className="sc-val sc-pass">{passed}</div>
                <div className="sc-label">Passed</div>
              </div>
              <div className="scorecard-metric" style={{ padding: "0 24px" }}>
                <div className="sc-val sc-fail">{failed}</div>
                <div className="sc-label">Failed</div>
              </div>
              <div className="scorecard-metric" style={{ padding: "0 24px" }}>
                <div className="sc-val sc-info">{total}</div>
                <div className="sc-label">Total</div>
              </div>
              <div className="scorecard-metric" style={{ paddingLeft: 24, border: "none" }}>
                <div className="sc-val" style={{ color: qaPct === 100 ? "var(--qa-pass)" : "var(--qa-warn)" }}>
                  {qaPct}%
                </div>
                <div className="sc-label">Pass Rate</div>
              </div>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${qaPct}%`,
                  background: qaPct === 100 ? "linear-gradient(90deg,var(--qa-pass),#16a34a)" : "linear-gradient(90deg,var(--qa-warn),#d97706)",
                }}
              />
            </div>
            <div style={{ marginTop: 12 }}>
              {Object.entries(cats).map(([cat, v]) => (
                <div className="cat-progress" key={cat}>
                  <span className="cat-progress-label">{cat}</span>
                  <div className="progress-bar" style={{ flex: 1, height: 4 }}>
                    <div
                      className="progress-fill"
                      style={{
                        width: `${Math.round((v.pass / v.total) * 100)}%`,
                        height: 4,
                        background: v.pass === v.total ? "var(--qa-pass)" : "var(--qa-warn)",
                      }}
                    />
                  </div>
                  <span className="cat-progress-count">
                    {v.pass}/{v.total}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="section-card">
          <SectionHeader
            icon="folder"
            title="Evidence Readiness"
            actions={
              <Link className="btn btn-secondary btn-sm" href="/evidence">
                View Register <Icon name="chevron-right" size={12} />
              </Link>
            }
          />
          <div className="section-card-body">
            <div className="scorecard" style={{ padding: 0, background: "transparent", border: "none", marginBottom: 16 }}>
              <div className="scorecard-metric" style={{ paddingRight: 24 }}>
                <div className="sc-val sc-pass">{evMapped}</div>
                <div className="sc-label">Mapped</div>
              </div>
              <div className="scorecard-metric" style={{ padding: "0 24px" }}>
                <div className="sc-val" style={{ color: evPending > 0 ? "var(--qa-warn)" : "var(--qa-pass)" }}>
                  {evPending}
                </div>
                <div className="sc-label">Pending</div>
              </div>
              <div className="scorecard-metric" style={{ paddingLeft: 24, border: "none" }}>
                <div className="sc-val sc-info">{evTotal}</div>
                <div className="sc-label">Total</div>
              </div>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${evTotal > 0 ? Math.round((evMapped / evTotal) * 100) : 0}%` }} />
            </div>
            <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-secondary)" }}>
              {evPending > 0 ? (
                <span className="badge badge-warn">
                  <span className="qa-dot qa-dot-warn" /> {evPending} evidence item{evPending > 1 ? "s" : ""} pending review
                </span>
              ) : (
                <span className="badge badge-pass">
                  <span className="qa-dot qa-dot-pass" /> All evidence mapped and verified
                </span>
              )}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
              Evidence covers: Production, Raw Material, Fuel (×4), Electricity (×3), Factor Library, QA/QC
            </div>
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader
          icon="calculator"
          title="All Calculated Metrics"
          actions={<span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Sourced from 08_Calculations sheet</span>}
        />
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Governance Note</th>
                  <th>QA Source</th>
                </tr>
              </thead>
              <tbody>
                {s.calcRows
                  .filter((r) => r.Value !== null && r.Value !== undefined)
                  .map((r) => (
                    <tr key={String(r.Metric)}>
                      <td>
                        <strong>{String(r.Metric)}</strong>
                      </td>
                      <td className="num mono">
                        <Fmt value={r.Value} unit={String(r.Unit || "")} />
                      </td>
                      <td className="unit-col">{String(r.Unit || "")}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 280 }}>{String(r["Governance note"] || "")}</td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(r["QA Source"] || "")}</td>
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

export default function OverviewPage() {
  return <RequireWorkbook title="Overview">{(s) => <OverviewContent s={s} />}</RequireWorkbook>;
}
