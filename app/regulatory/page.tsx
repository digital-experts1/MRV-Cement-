"use client";

import { Chip } from "@/components/ui/Chip";
import { Icon } from "@/components/icons/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import type { SheetRow, Store } from "@/lib/types";

function RefCard({ r }: { r: SheetRow }) {
  const url = r["Official source URL"] ? String(r["Official source URL"]) : "";
  return (
    <div className="reg-card">
      <div className="reg-meta">
        <Chip status={r.Status} />
        {r["Last checked"] ? <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Checked: {String(r["Last checked"] || "")}</span> : null}
        {r["Applied sheets"] ? <span className="reg-sheets">Sheets: {String(r["Applied sheets"])}</span> : null}
      </div>
      <div className="reg-title">{String(r.Reference || "")}</div>
      <div className="reg-desc">{String(r["Workbook application"] || "")}</div>
      {r["Page / section pointer"] ? (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="tag" size={12} /> {String(r["Page / section pointer"])}
        </div>
      ) : null}
      {r.Notes ? <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 10, lineHeight: 1.5 }}>{String(r.Notes)}</div> : null}
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="reg-url-btn">
          <Icon name="external-link" size={12} /> Official Source ↗
        </a>
      ) : null}
    </div>
  );
}

function RegulatoryContent({ s }: { s: Store }) {
  const refs = s.regulatory;
  const official = refs.filter((r) => r.Status === "Official");
  const external = refs.filter((r) => r.Status !== "Official");

  return (
    <>
      <PageHeader
        icon="book-open"
        title="Regulatory References"
        desc="EU CBAM Implementing Regulations, EU ETS Monitoring & Reporting Regulation (MRR), and GCCA/ISO standards."
        actions={
          <>
            <span className="badge badge-info">{official.length} Official EU</span>
            <span className="badge badge-accent">{external.length} External Standards</span>
          </>
        }
      />

      <div
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          marginBottom: "var(--sp-lg)",
          padding: "var(--sp-sm) var(--sp-md)",
          background: "var(--bg-card)",
          borderRadius: "var(--r-sm)",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Icon name="info" size={14} />
        <div>Reference only — official standard texts are not reproduced. Always verify against the most current version of each regulation or standard.</div>
      </div>

      {official.length > 0 ? (
        <div style={{ marginBottom: "var(--sp-md)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".09em", marginBottom: "var(--sp-md)" }}>
            Official EU / CBAM References
          </div>
          <div className="grid-2">
            {official.map((r, i) => (
              <RefCard key={`${String(r.Reference)}-${i}`} r={r} />
            ))}
          </div>
        </div>
      ) : null}

      {external.length > 0 ? (
        <div style={{ marginTop: "var(--sp-xl)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".09em", marginBottom: "var(--sp-md)" }}>
            External Standards
          </div>
          <div className="grid-2">
            {external.map((r, i) => (
              <RefCard key={`${String(r.Reference)}-${i}`} r={r} />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function RegulatoryPage() {
  return <RequireWorkbook title="Regulatory References">{(s) => <RegulatoryContent s={s} />}</RequireWorkbook>;
}
