"use client";

import { Chip } from "@/components/ui/Chip";
import { Fmt } from "@/components/ui/Fmt";
import { MissingBadge } from "@/components/ui/Badge";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { SheetRow, Store } from "@/lib/types";

function groupReports(rows: SheetRow[]): [string, SheetRow[]][] {
  const groups: Record<string, SheetRow[]> = {};
  const order: string[] = [];
  for (const r of rows) {
    const ui = String(r["Mapped to Cement UI"] || "Other");
    const key = ui.split("/")[0]?.trim() || "Other";
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(r);
  }
  return order.map((k) => [k, groups[k]]);
}

function ReportValue({ r }: { r: SheetRow }) {
  const rawVal = r._valueNum !== undefined ? r._valueNum : r.Value;
  if (rawVal === null || rawVal === undefined || rawVal === "") return <MissingBadge />;
  if (r.Unit === "date") return <span className="mono">{String(r.Value || "")}</span>;
  if (typeof rawVal === "number") {
    return (
      <span className="mono" style={{ color: "var(--accent)" }}>
        <Fmt value={rawVal} unit={String(r.Unit || "")} />
      </span>
    );
  }
  return <strong>{String(rawVal)}</strong>;
}

function ReportOutputsContent({ s }: { s: Store }) {
  const grouped = groupReports(s.reportOutputs);

  return (
    <>
      <PageHeader
        icon="file-text"
        title="Report Outputs"
        desc="Aggregated regulatory reporting schedule aligned with CBAM, EU ETS, and third-party verification templates."
        actions={<Chip status={`${s.reportOutputs.length} verified fields`} />}
      />

      <div style={{ display: "flex", gap: "var(--sp-sm)", flexWrap: "wrap", marginBottom: "var(--sp-lg)" }}>
        {grouped.map(([group, rows]) => (
          <a key={group} href={`#group-${group.replace(/\s/g, "")}`} style={{ textDecoration: "none" }}>
            <Chip status={`${group} (${rows.length})`} />
          </a>
        ))}
      </div>

      {grouped.map(([group, groupRows]) => (
        <div className="section-card mb-lg" id={`group-${group.replace(/\s/g, "")}`} key={group}>
          <SectionHeader icon="file-text" title={group} actions={<Chip status={`${groupRows.length} fields`} />} />
          <div className="section-card-body no-pad">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Output Field</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Source</th>
                  <th>Report Label</th>
                  <th>Governance Position</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((r, i) => (
                  <tr key={`${String(r["Output Field"])}-${i}`}>
                    <td>
                      <strong>{String(r["Output Field"] || "")}</strong>
                    </td>
                    <td>
                      <ReportValue r={r} />
                    </td>
                    <td className="unit-col">{String(r.Unit || "")}</td>
                    <td style={{ fontSize: 12, color: "var(--accent-2)" }}>{String(r.Source || "—")}</td>
                    <td style={{ fontSize: 12 }}>{String(r["Report Label"] || "—")}</td>
                    <td style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 200 }}>{String(r["Governance Position"] || "—")}</td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(r.Notes || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

export default function ReportOutputsPage() {
  return <RequireWorkbook title="Report Outputs">{(s) => <ReportOutputsContent s={s} />}</RequireWorkbook>;
}
