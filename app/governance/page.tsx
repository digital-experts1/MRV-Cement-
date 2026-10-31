"use client";

import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { Store } from "@/lib/types";

function GovernanceContent({ s }: { s: Store }) {
  const controls: [string, unknown][] = [
    ["Installation", s.setup["Installation / site"]],
    ["Country", s.setup["Country"]],
    ["Period start", s.setup["Period start"]],
    ["Period end", s.setup["Period end"]],
    ["Product", s.setup["Primary product"]],
    ["Calcination method", s.setup["Selected calcination method"]],
    ["QA/QC status", s.calculations["QA/QC Overall Status"]?.Value],
    ["Evidence status", s.calculations["Evidence Status"]?.Value],
  ];
  return (
    <>
      <PageHeader icon="shield" title="Governance & Control" desc="Workbook versioning, operational status, sector classification, and MRV data governance rules." />

      <div className="section-card mb-lg">
        <SectionHeader icon="shield" title="Selected calculation controls" />
        <div className="section-card-body">
          <p>Values used by the selected calculation. Evidence mapping and QA checks do not establish external verification.</p>
          <table className="gov-table"><tbody>{controls.map(([label, value]) => <tr key={String(label)}><td className="gov-key">{label}</td><td className="gov-val">{value === null || value === undefined || value === "" ? "Not provided" : String(value)}</td></tr>)}</tbody></table>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}><a className="btn btn-secondary" href="/setup">Review setup</a><a className="btn btn-secondary" href="/qaqc">Review QA/QC</a><a className="btn btn-secondary" href="/evidence">Review evidence</a></div>
        </div>
      </div>
      <div className="section-card mb-lg">
        <SectionHeader icon="file-text" title="Control Parameters" />
        <div className="section-card-body no-pad">
          <table className="gov-table">
            <tbody>
              {s.readme.length === 0 && <tr><td colSpan={3}>No workbook control metadata was supplied. The calculation controls above remain available.</td></tr>}
              {s.readme.map((r) => (
                <tr key={String(r.Control)}>
                  <td className="gov-key">{String(r.Control || "")}</td>
                  <td className="gov-val">
                    <strong>{String(r.Value ?? "")}</strong>
                  </td>
                  <td className="gov-note">{String(r["Governance note"] ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function GovernancePage() {
  return <RequireWorkbook title="Governance & Control">{(s) => <GovernanceContent s={s} />}</RequireWorkbook>;
}
