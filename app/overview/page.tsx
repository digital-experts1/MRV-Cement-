"use client";

import Link from "next/link";
import "./overview.css";
import { BreakdownVisual } from "@/components/overview/BreakdownVisual";
import { Icon } from "@/components/icons/Icon";
import { QaDot } from "@/components/ui/Badge";
import { Fmt } from "@/components/ui/Fmt";
import { KpiCard } from "@/components/ui/KpiCard";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { useExplainer } from "@/context/ExplainerContext";
import { useScope } from "@/context/ScopeContext";
import { SECTION_LABELS_CLIENT } from "@/lib/mrv/sectionLabels";
import { CO2_COLORS } from "@/lib/charts";
import { buildFallbackBreakdown } from "@/lib/breakdown";
import { fmtDec, fmtInt, fmtRaw } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function OverviewContent({ s }: { s: Store }) {
  const { showExplanation } = useExplainer();
  const scope = useScope();
  const coverage = scope.coverage;
  const discrepancies = coverage?.reconciliations?.filter((r) => r.status === "discrepancy") ?? [];
  const conflictGroups = Object.entries(Object.groupBy(discrepancies, (r) => r.section));
  const missingGroups = Object.entries(coverage?.missing ?? {}).filter(([, months]) => months.length > 0);
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
  const notEvaluated = s.qaqc.filter((r) => r.Status === "NOT_EVALUATED").length;
  const warnings = s.qaqc.filter((r) => r.Status === "WARNING").length;
  const qaPct = s.qaPassPct;

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
  const version = String(s.readme.find((r) => r.Control === "Workbook Version")?.Value || "—").replace(/^v/i, "");

  const qaColor = qaStatus === "PASS" ? "pass" : qaStatus === "FAIL" ? "fail" : "warn";
  const tsrVal = tsr !== null && tsr !== undefined ? fmtDec(parseFloat(String(tsr)), 2) : "—";

  const cats: Record<string, { pass: number; total: number }> = {};
  s.qaqc.forEach((r) => {
    const cat = String(r.Category || "Other");
    if (!cats[cat]) cats[cat] = { pass: 0, total: 0 };
    cats[cat].total++;
    if (String(r.Status).toUpperCase() === "PASS") cats[cat].pass++;
  });

  return (
    <div className="overview-results">
      <PageHeader
        icon="home"
        title="Overview"
        desc={`Here's your plant at a glance — ${site}, ${country} · ${quarter} · ${product}`}
        actions={
          <>
            <button type="button" className={`badge badge-${qaColor} overview-status-action`} onClick={() => showExplanation("kpi-qaqc-status")}>
              <QaDot status={qaStatus} /> QA/QC {qaStatus} <Icon name="info" size={16} />
            </button>
            <span className="badge badge-accent">v{version}</span>
          </>
        }
      />

      <section className="overview-period mb-lg" aria-label="Reporting period coverage">
        <div className="overview-period-top">
          <div>
            <h3>Reporting period</h3>
            <p className="overview-dates">{pStart} <span>to</span> {pEnd}</p>
            <p className="overview-period-caption">{scope.range?.timezone ?? "Factory reporting dates"} · {product}</p>
          </div>
          <div className="overview-period-actions">
            <span className={`badge ${coverage?.complete && !scope.run?.stale ? "badge-pass" : "badge-warn"}`}>
              {scope.run?.stale ? "Results out of date" : coverage?.complete ? "Full period covered" : "Results need reconciliation"}
            </span>
            {scope.canCalculate && <button type="button" className="btn btn-primary btn-sm" disabled={scope.calculating} aria-busy={scope.calculating} onClick={scope.recalculate}>
              <Icon name="calculator" size={18} />
              {scope.calculating ? "Calculating…" : "Recalculate selected period"}
            </button>}
          </div>
        </div>
        <dl className="overview-health">
          <div><dt>Readings used</dt><dd>{fmtRaw(scope.run?.readings, 0)}</dd></div>
          <div><dt>Excluded readings</dt><dd>{coverage ? fmtInt(coverage.excluded.length) : "—"}</dd></div>
          <div><dt>Input fields complete</dt><dd>{s.completeness.pct}%</dd></div>
          <div><dt>Conflicting totals</dt><dd>{coverage ? fmtInt(discrepancies.length) : "—"}</dd></div>
        </dl>
        {(!coverage?.complete || scope.run?.stale) && <div className="overview-review-note">
          <Icon name="info" size={18} />
          <div><strong>{scope.run?.stale ? "Readings or factors changed. Recalculate this period." : "Review data quality before using these results."}</strong><p>{scope.run?.stale ? "These are historical results and do not reflect the latest inputs." : "Totals may combine overlapping sources or incomplete coverage. Field completeness does not establish period coverage or verification."}</p></div>
          <Link className="btn btn-secondary btn-sm" href="/dataentry"><Icon name="file-text" size={18} /> Review inputs</Link>
        </div>}
        <details className="overview-issues">
          <summary>Coverage and reconciliation details <span>{conflictGroups.length} input sections with conflicting totals · {missingGroups.length} with coverage gaps</span></summary>
          <div className="overview-issue-content">
            {missingGroups.map(([section, months]) => <div className="overview-gap" key={section}>
              <strong>{SECTION_LABELS_CLIENT[section] ?? section}: incomplete coverage</strong>
              <div className="overview-months">{months.map(month => <span key={month}>{month}</span>)}</div>
            </div>)}
            {conflictGroups.map(([section, records]) => <details className="overview-conflict-group" key={section}>
              <summary><strong>{SECTION_LABELS_CLIENT[section] ?? section}</strong><span>{records?.length ?? 0} conflicting totals · {new Set(records?.map(r => r.coarse.interval)).size} periods</span></summary>
              <p>The saved calculation uses the broader period total where the finer readings disagree. Reconcile the source values before relying on these results.</p>
              <div className="table-wrapper"><table className="data-table"><thead><tr><th>Period</th><th>Source series</th><th>Fields requiring review</th></tr></thead><tbody>
                {records?.map(r => <tr key={r.coarse.id}><td>{r.coarse.interval}</td><td className="overview-source">{r.series_key}</td><td>{r.fields.filter(f => f.diff !== null && Number(f.diff) !== 0).map(f => f.field).join(", ") || "Source totals disagree"}</td></tr>)}
              </tbody></table></div>
            </details>)}
            {coverage?.configGaps?.map((gap, i) => <p key={i}>{gap}</p>)}
            {!!coverage?.conflicts?.length && <p>{coverage.conflicts.length} overlapping source conflicts. Open Run details above to inspect the affected records.</p>}
            {!!coverage?.anchorIssues?.length && <p>{coverage.anchorIssues.length} meter boundary issues. Open Run details above for the affected sources.</p>}
            {coverage?.extendsIntoFuture && <p>This reporting period includes future dates.</p>}
            {!!coverage?.excluded.length && <p>{fmtInt(coverage.excluded.length)} readings excluded. Run details above contains the exclusion reasons and record history.</p>}
            {coverage?.complete && <p>Required period coverage is complete. QA/QC and evidence review remain separate checks.</p>}
            {!coverage && <p>Coverage information is unavailable for this saved result. Recalculate the selected period to check it.</p>}
            <Link className="btn btn-secondary btn-sm" href="/dataentry"><Icon name="file-text" size={18} /> Review stored inputs</Link>
          </div>
        </details>
      </section>

      <div className="overview-section-title"><h3>Production & energy</h3><span>Selected reporting period</span></div>
      <div className="grid-4 mb-lg">
        <KpiCard label="Clinker Production" value={fmtRaw(clinkerProd, 0)} unit="t" desc="Total kiln clinker produced in period" explainKey="kpi-clinker-prod" className="accent-card" />
        <KpiCard label="Cement Production" value={fmtRaw(cementProd, 0)} unit="t" desc="Total finished cement dispatched" explainKey="kpi-cement-prod" className="accent-card" />
        <KpiCard label="Clinker Factor" value={fmtRaw(clinkerFactor, 3)} unit="ratio" desc="Proportion of clinker per ton of cement" explainKey="kpi-clinker-factor" />
        <KpiCard label="Specific Heat" value={fmtRaw(shc, 3)} unit="GJ/t clinker" desc="Thermal energy consumed per ton clinker" explainKey="kpi-specific-heat" />
      </div>

      <div className="overview-section-title"><h3>Emissions performance</h3><span>Calculated from selected readings and factors</span></div>
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
          <BreakdownVisual label="Emissions by source" unit="tCO₂" total={fmtRaw(totalCO2, 0) ?? "—"} items={breakdown.map(d => ({ label: d.component, value: d.tCO2, color: CO2_COLORS[d.component] || "#52647a" }))} />
          <p className="overview-chart-footnote">Process + fossil fuel combustion + grid electricity. Biogenic CO₂ is reported separately. Values reflect the selected period; review any reconciliation warnings above.</p>
        </div>

        <div className="section-card">
          <SectionHeader icon="file-text" title="Plant & calculation context" actions={<span className="chip chip-controlled">v{version}</span>} />
          <div className="section-card-body" style={{ padding: 0 }}>
            <div className="kv-panel">
              {[
                ["Site", site],
                ["Country", country],
                ["Reporting Period", quarter],
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
            <BreakdownVisual label="QA/QC check status" unit="checks" total={String(total)} items={[
              { label: "Passed", value: passed, color: "#14836d" },
              { label: "Failed", value: failed, color: "#c43d48" },
              { label: "Warnings", value: warnings, color: "#cf8716" },
              { label: "Not evaluated", value: notEvaluated, color: "#8494a8" },
            ]} />
            <p className="overview-chart-footnote">QA pass rate: {qaPct}%. Input fields complete: {s.completeness.pct}%. These checks do not establish external verification.</p>
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
              {evTotal === 0 ? (
                <span className="badge badge-warn">No evidence references supplied</span>
              ) : evPending > 0 ? (
                <span className="badge badge-warn">
                  <span className="qa-dot qa-dot-warn" /> {evPending} evidence item{evPending > 1 ? "s" : ""} pending review
                </span>
              ) : (
                <span className="badge badge-pass">
                  <span className="qa-dot qa-dot-pass" /> All evidence references mapped (not externally verified)
                </span>
              )}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-muted)" }}>
              &quot;Mapped&quot; means a document reference is linked in the register. External verification is not recorded in this application.
            </div>
          </div>
        </div>
      </div>

      <div className="section-card">
        <SectionHeader
          icon="calculator"
          title="All Calculated Metrics"
          actions={<span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Computed by the platform engine</span>}
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
                {s.calcRows.map((r) => (
                    <tr key={String(r.Metric)}>
                      <td>
                        <strong>{String(r.Metric)}</strong>
                      </td>
                      <td className="num mono">
                        {r.Value === null || r.Value === undefined ? <span className="badge badge-missing">Not calculated</span> : <Fmt value={r.Value} unit={String(r.Unit || "")} />}
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
    </div>
  );
}

export default function OverviewPage() {
  return <RequireWorkbook title="Overview">{(s) => <OverviewContent s={s} />}</RequireWorkbook>;
}
