"use client";

import { Chip } from "@/components/ui/Chip";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { SheetRow, Store } from "@/lib/types";

const GROUP_ORDER = ["Plant", "EgyTrace", "Production", "Sustainability", "Other"];

function groupSetup(rows: SheetRow[]): [string, SheetRow[]][] {
  const groups: Record<string, SheetRow[]> = {};
  for (const r of rows) {
    const owner = String(r["Governance owner"] || "Other");
    if (!groups[owner]) groups[owner] = [];
    groups[owner].push(r);
  }
  const ordered = [...GROUP_ORDER.filter((g) => groups[g]), ...Object.keys(groups).filter((g) => !GROUP_ORDER.includes(g))];
  return ordered.map((k) => [k, groups[k]]);
}

function SetupContent({ s }: { s: Store }) {
  const orderedGroups = groupSetup(s.setupRows);

  return (
    <>
      <PageHeader icon="settings" title="Setup & Reporting Period" desc="Facility boundaries, reporting period timeframe, calcination methodology, and governance owners." />

      {orderedGroups.map(([owner, rows]) => (
        <div className="section-card mb-lg" key={owner}>
          <SectionHeader icon="sliders" title={`${owner} Parameters`} actions={<Chip status={`${rows.length} items`} />} />
          <div className="section-card-body no-pad">
            <table className="gov-table">
              <thead style={{ borderBottom: "1px solid var(--border)" }}>
                <tr>
                  <td className="gov-key" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)" }}>
                    Parameter
                  </td>
                  <td className="gov-val" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)" }}>
                    Value
                  </td>
                  <td style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)" }}>Unit</td>
                  <td style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)" }}>Required</td>
                  <td className="gov-note" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-muted)" }}>
                    Notes
                  </td>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${String(r.Parameter)}-${i}`}>
                    <td className="gov-key">{String(r.Parameter || "")}</td>
                    <td className="gov-val">
                      <strong>{String(r.Value || "—")}</strong>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(r.Unit || "")}</td>
                    <td>
                      {r["Required?"] === "Yes" ? (
                        <span className="badge badge-pass" style={{ fontSize: 10 }}>
                          Required
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Optional</span>
                      )}
                    </td>
                    <td className="gov-note">{String(r.Notes || "")}</td>
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

export default function SetupPage() {
  return <RequireWorkbook title="Setup">{(s) => <SetupContent s={s} />}</RequireWorkbook>;
}
