import { SectionHeader } from "@/components/ui/PageHeader";
import type { Store } from "@/lib/types";

function cellText(v: unknown): string {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

/** Workbook-claimed totals/statuses vs. platform-computed values, plus rejected input values. */
export function AssertionsPanel({ s }: { s: Store }) {
  const mismatches = s.assertions.filter((a) => a.outcome === "MISMATCH");
  const matches = s.assertions.filter((a) => a.outcome === "MATCH").length;
  const notComparable = s.assertions.length - mismatches.length - matches;

  return (
    <div className="section-card mb-lg">
      <SectionHeader icon="check-circle" title="Workbook Comparison & Input Issues" />
      <div className="section-card-body">
        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 0 }}>
          Workbook totals and statuses are comparison assertions only. Platform-computed values are authoritative and are never
          overridden by imported results.
        </p>
        {s.assertions.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>No workbook claims to compare (manual entry, demo or data export).</p>
        ) : (
          <p style={{ fontSize: 12 }}>
            <strong>{matches}</strong> match · <strong style={{ color: mismatches.length ? "var(--qa-fail)" : undefined }}>{mismatches.length}</strong> mismatch ·{" "}
            <strong>{notComparable}</strong> not comparable
          </p>
        )}
        {mismatches.length > 0 ? (
          <div className="table-wrapper">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Field</th>
                  <th>Workbook claims</th>
                  <th>Platform computed</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {mismatches.map((a, i) => (
                  <tr key={`${a.sheet}-${a.field}-${i}`}>
                    <td className="mono" style={{ fontSize: 11 }}>{a.sheet}</td>
                    <td>{a.field}</td>
                    <td className="mono">{cellText(a.workbookValue)}</td>
                    <td className="mono">{cellText(a.computedValue)}</td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{a.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {s.inputIssues.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 12, color: "var(--qa-fail)" }}>{s.inputIssues.length} input value(s) rejected (kept in provenance, not used):</strong>
            <ul style={{ fontSize: 12, margin: "6px 0 0 18px" }}>
              {s.inputIssues.slice(0, 50).map((i, k) => (
                <li key={k}>
                  {i.section} row {cellText(i.row)} · {i.field} = &quot;{cellText(i.raw)}&quot; — {i.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
