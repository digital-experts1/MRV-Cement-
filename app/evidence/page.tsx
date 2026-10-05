"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MappedBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { SheetRow, Store } from "@/lib/types";

function uniqueField(rows: SheetRow[], key: string): string[] {
  return [...new Set(rows.map((r) => String(r[key] || "")).filter(Boolean))];
}

function EvidenceContent({ s }: { s: Store }) {
  const searchParams = useSearchParams();
  const idParam = searchParams.get("id") || "";
  const rows = s.evidence;
  const sheets = uniqueField(rows, "Mapped Sheet");
  const owners = uniqueField(rows, "Owner");
  const mapped = rows.filter((r) => r.Status === "Mapped").length;
  const pending = rows.length - mapped;

  const [search, setSearch] = useState(idParam);
  const [status, setStatus] = useState("");
  const [sheet, setSheet] = useState("");
  const [owner, setOwner] = useState("");

  useEffect(() => {
    if (idParam) setSearch(idParam);
  }, [idParam]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const evId = String(r.evidenceId || r["Evidence ID"] || "");
      const text = [
        evId,
        r["Evidence Type"],
        r.Description,
        r["Source System"],
        r["Mapped Sheet"],
        r.Status,
        r.Owner,
        r.Reviewer,
        r.Frequency,
        r.Notes,
      ]
        .map((v) => String(v ?? ""))
        .join(" ")
        .toLowerCase();
      return (
        (!q || text.includes(q) || evId.toLowerCase().includes(q)) &&
        (!status || String(r.Status || "") === status) &&
        (!sheet || String(r["Mapped Sheet"] || "") === sheet) &&
        (!owner || String(r.Owner || "") === owner)
      );
    });
  }, [rows, search, status, sheet, owner]);

  return (
    <>
      <PageHeader
        icon="folder"
        title="Evidence Register"
        desc="Comprehensive audit-trail registry linking activity data, lab certificates, invoices, and weighbridge records."
        actions={
          <>
            <span className="badge badge-pass">
              <span className="qa-dot qa-dot-pass" /> {mapped} Mapped
            </span>
            {pending > 0 ? (
              <span className="badge badge-warn">
                <span className="qa-dot qa-dot-warn" /> {pending} Pending
              </span>
            ) : null}
          </>
        }
      />

      <div className="filter-row mb-md">
        <input className="filter-input" placeholder="Search by evidence ID, description..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Mapped">Mapped</option>
          <option value="Pending">Pending</option>
        </select>
        <select className="filter-select" value={sheet} onChange={(e) => setSheet(e.target.value)}>
          <option value="">All Sheets</option>
          {sheets.map((sh) => (
            <option key={sh} value={sh}>
              {sh}
            </option>
          ))}
        </select>
        <select className="filter-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">All Owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>

      <div className="section-card">
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Evidence ID</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Source System</th>
                  <th>Mapped Sheet</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Reviewer</th>
                  <th>Frequency</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const isMapped = r.Status === "Mapped";
                  const evId = String(r.evidenceId || r["Evidence ID"] || "");
                  return (
                    <tr key={`${evId}-${i}`} className={isMapped ? undefined : "pending-row"}>
                      <td className="mono" style={{ color: "var(--accent-2)", fontWeight: 600 }}>
                        {evId}
                      </td>
                      <td style={{ fontSize: 12 }}>{String(r["Evidence Type"] || "—")}</td>
                      <td style={{ maxWidth: 220, fontSize: 12 }}>{String(r.Description || "—")}</td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{String(r["Source System"] || "—")}</td>
                      <td style={{ fontSize: 12, color: "var(--accent-2)" }}>{String(r["Mapped Sheet"] || "—")}</td>
                      <td>
                        <MappedBadge mapped={isMapped} />
                      </td>
                      <td style={{ fontSize: 12 }}>{String(r.Owner || "—")}</td>
                      <td style={{ fontSize: 12 }}>{String(r.Reviewer || "—")}</td>
                      <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{String(r.Frequency || "—")}</td>
                      <td style={{ fontSize: 11.5, color: "var(--text-muted)", maxWidth: 180 }}>{String(r.Notes || "—")}</td>
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

export default function EvidencePage() {
  return (
    <Suspense fallback={null}>
      <RequireWorkbook title="Evidence Register">{(s) => <EvidenceContent s={s} />}</RequireWorkbook>
    </Suspense>
  );
}
