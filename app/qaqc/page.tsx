"use client";

import { BarChart } from "@/components/charts/ChartCanvas";
import { Icon } from "@/components/icons/Icon";
import { QaBadge } from "@/components/ui/Badge";
import { Chip, SeverityBadge } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { SheetRow, Store } from "@/lib/types";

function groupByCategory(checks: SheetRow[]): Record<string, SheetRow[]> {
  const cats: Record<string, SheetRow[]> = {};
  for (const r of checks) {
    const cat = String(r.Category || "Other");
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(r);
  }
  return cats;
}

function isPass(r: SheetRow): boolean {
  return String(r.Status).toUpperCase() === "PASS";
}

function QaqcContent({ s }: { s: Store }) {
  const checks = s.qaqc;
  const total = checks.length;
  const passed = checks.filter(isPass).length;
  const failed = total - passed;
  const qaPct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const cats = groupByCategory(checks);
  const catLabels = Object.keys(cats);
  const catPass = catLabels.map((c) => cats[c].filter(isPass).length);
  const catColors = catLabels.map((c) => (cats[c].some((r) => !isPass(r)) ? "rgba(239,68,68,0.7)" : "rgba(34,197,94,0.7)"));

  return (
    <>
      <PageHeader
        icon="check-circle"
        title="QA/QC Checks"
        desc={`Automated checks that catch issues before they reach regulators — covering mass balances, physical limits, and completeness across ${catLabels.length} check categories.`}
        actions={
          <>
            <QaBadge status={failed > 0 ? "FAIL" : "PASS"} />
            <Chip status={`${total} checks`} />
          </>
        }
      />

      <div className="grid-2 mb-lg">
        <div className="card">
          <div className="qa-hero">
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: failed > 0 ? "var(--qa-fail)" : "var(--qa-pass)" }} className="mono">
                {passed}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".07em" }}>Passed</div>
            </div>
            <div style={{ fontSize: 28, color: "var(--text-muted)" }}>/</div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44, fontWeight: 800, color: "var(--text-secondary)" }} className="mono">
                {total}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".07em" }}>Total</div>
            </div>
            <div className="qa-hero-rate">
              <div style={{ fontSize: 28, fontWeight: 800, color: qaPct === 100 ? "var(--qa-pass)" : "var(--qa-warn)" }} className="mono">
                {qaPct}%
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Pass Rate</div>
              <div className="progress-bar mt-sm">
                <div className="progress-fill" style={{ width: `${qaPct}%`, background: qaPct === 100 ? "var(--qa-pass)" : "var(--qa-warn)" }} />
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {Object.entries(cats).map(([cat, rows]) => {
              const catFail = rows.filter((r) => !isPass(r)).length;
              return (
                <div
                  key={cat}
                  style={{
                    background: catFail > 0 ? "var(--qa-fail-dim)" : "var(--qa-pass-dim)",
                    border: `1px solid ${catFail > 0 ? "var(--qa-fail-border)" : "var(--qa-pass-border)"}`,
                    borderRadius: "var(--r-sm)",
                    padding: "5px 10px",
                  }}
                >
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>{cat}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: catFail > 0 ? "var(--qa-fail)" : "var(--qa-pass)" }}>
                    {rows.length - catFail}/{rows.length}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bar-chart-2" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Checks Passed by Category</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 180 }}>
            <BarChart labels={catLabels} data={catPass} colors={catColors} horizontal />
          </div>
        </div>
      </div>

      {Object.entries(cats).map(([cat, rows]) => {
        const catFail = rows.filter((r) => !isPass(r)).length;
        return (
          <div className="qa-category-group" key={cat}>
            <div className="qa-category-header">
              <span className={`qa-dot ${catFail > 0 ? "qa-dot-fail" : "qa-dot-pass"}`} />
              <span className="cat-name">{cat}</span>
              <span className="cat-score" style={{ color: catFail > 0 ? "var(--qa-fail)" : "var(--qa-pass)" }}>
                {rows.length - catFail}/{rows.length} PASS
              </span>
            </div>
            <div className="table-wrapper">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Check ID</th>
                    <th>Check Name</th>
                    <th>Rule</th>
                    <th className="num">Result</th>
                    <th>Status</th>
                    <th>Severity</th>
                    <th>Owner</th>
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const fail = String(r.Status).toUpperCase() === "FAIL";
                    return (
                      <tr key={`${String(r["Check ID"])}-${i}`} style={fail ? { background: "rgba(239,68,68,0.04)" } : undefined}>
                        <td className="mono" style={{ color: "var(--accent-2)", fontSize: 11 }}>
                          {String(r["Check ID"] || "")}
                        </td>
                        <td>
                          <strong>{String(r["Check Name"] || "")}</strong>
                        </td>
                        <td style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 200 }}>{String(r.Rule || "")}</td>
                        <td className="num mono" style={{ fontSize: 12 }}>
                          {String(r.Result ?? "")}
                        </td>
                        <td>
                          <QaBadge status={r.Status} />
                        </td>
                        <td>
                          <SeverityBadge severity={r.Severity} />
                        </td>
                        <td style={{ fontSize: 12 }}>{String(r.Owner || "—")}</td>
                        <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(r.Comment || "—")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

export default function QaqcPage() {
  return <RequireWorkbook title="QA/QC Checks">{(s) => <QaqcContent s={s} />}</RequireWorkbook>;
}
