"use client";

import { useMemo, useState } from "react";
import { MappedBadge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { SheetRow, Store } from "@/lib/types";

function rowText(r: SheetRow) {
  return [
    r["Boundary Area"],
    r["Source System"],
    r["DCS/ERP/Lab Tag"],
    r["MRV Field"],
    r.Unit,
    r.Frequency,
    r["Evidence Required"],
    r["Calculation Use"],
    r["Mapped Status"],
    r.Owner,
    r["QA/QC Rule"],
  ]
    .map((v) => String(v || ""))
    .join(" ")
    .toLowerCase();
}

function DcsContent({ s }: { s: Store }) {
  const rows = s.dcsMap;
  const areas = [...new Set(rows.map((r) => String(r["Boundary Area"] || "")).filter(Boolean))];
  const owners = [...new Set(rows.map((r) => String(r.Owner || "")).filter(Boolean))];
  const mapped = rows.filter((r) => r["Mapped Status"] === "Mapped").length;
  const pending = rows.filter((r) => r["Mapped Status"] !== "Mapped").length;

  const [search, setSearch] = useState("");
  const [area, setArea] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const text = rowText(r);
      const trArea = String(r["Boundary Area"] || "");
      const trOwner = String(r.Owner || "");
      const trStatus = String(r["Mapped Status"] || "");
      return (!q || text.includes(q)) && (!area || trArea === area) && (!owner || trOwner === owner) && (!status || trStatus === status);
    });
  }, [rows, search, area, owner, status]);

  return (
    <>
      <PageHeader
        icon="network"
        title="DCS / ERP / Lab Boundary Map"
        desc="Data acquisition mapping connecting plant instrumentation, DCS tags, lab analyzers, and MRV inputs."
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
        <input className="filter-input" placeholder="Search boundary, tag, or field..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="filter-select" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">All Areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
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
        <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Mapped">Mapped</option>
          <option value="Pending">Pending</option>
        </select>
      </div>

      <div className="section-card">
        <div className="section-card-body no-pad">
          <div className="table-wrapper" style={{ border: "none" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Boundary Area</th>
                  <th>Source System</th>
                  <th>DCS/ERP/Lab Tag</th>
                  <th>MRV Field</th>
                  <th>Unit</th>
                  <th>Frequency</th>
                  <th>Evidence Required</th>
                  <th>Calculation Use</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>QA/QC Rule</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${String(r["MRV Field"])}-${i}`}>
                    <td>
                      <strong>{String(r["Boundary Area"] || "—")}</strong>
                    </td>
                    <td style={{ fontSize: 12 }}>{String(r["Source System"] || "—")}</td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--accent-2)" }}>
                      {String(r["DCS/ERP/Lab Tag"] || "—")}
                    </td>
                    <td>
                      <strong>{String(r["MRV Field"] || "—")}</strong>
                    </td>
                    <td className="unit-col">{String(r.Unit || "")}</td>
                    <td style={{ fontSize: 12 }}>{String(r.Frequency || "—")}</td>
                    <td style={{ fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 160 }}>{String(r["Evidence Required"] || "—")}</td>
                    <td style={{ fontSize: 12, color: "var(--accent-2)" }}>{String(r["Calculation Use"] || "—")}</td>
                    <td>
                      <MappedBadge mapped={r["Mapped Status"] === "Mapped"} />
                    </td>
                    <td style={{ fontSize: 12 }}>{String(r.Owner || "—")}</td>
                    <td style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 160 }}>{String(r["QA/QC Rule"] || "—")}</td>
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

export default function DcsPage() {
  return <RequireWorkbook title="DCS Boundary Map">{(s) => <DcsContent s={s} />}</RequireWorkbook>;
}
