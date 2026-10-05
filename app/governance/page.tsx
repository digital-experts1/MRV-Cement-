"use client";

import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { Store } from "@/lib/types";

function GovernanceContent({ s }: { s: Store }) {
  return (
    <>
      <PageHeader icon="shield" title="Governance & Control" desc="Workbook versioning, operational status, sector classification, and MRV data governance rules." />

      <div className="section-card mb-lg">
        <SectionHeader icon="file-text" title="Control Parameters" />
        <div className="section-card-body no-pad">
          <table className="gov-table">
            <tbody>
              {s.readme.map((r) => (
                <tr key={String(r.Control)}>
                  <td className="gov-key">{String(r.Control || "")}</td>
                  <td className="gov-val">
                    <strong>{String(r.Value || "")}</strong>
                  </td>
                  <td className="gov-note">{String(r["Governance note"] || r.Value || "")}</td>
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
