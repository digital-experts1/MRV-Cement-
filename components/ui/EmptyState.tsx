"use client";

import { Icon } from "@/components/icons/Icon";
import { useStore } from "@/context/StoreContext";

export function EmptyState({ title }: { title: string }) {
  const { handleFile } = useStore();

  return (
    <div className="state-box">
      <div className="state-icon" style={{ color: "var(--accent)" }}>
        <Icon name="upload" size={40} />
      </div>
      <div className="state-title">No data loaded yet</div>
      <div className="state-sub">Upload your TRACE FORCE MRV workbook to view {title.toLowerCase()}.</div>
      <label className="btn btn-primary" htmlFor="file-input" style={{ cursor: "pointer", marginTop: 8 }}>
        <Icon name="upload" size={14} /> Choose Workbook
      </label>
      <input
        type="file"
        id="file-input-empty"
        accept=".xlsx,.xlsm"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function LoadingState({ filename }: { filename?: string }) {
  return (
    <div className="state-box">
      <div className="spinner" />
      <div className="state-title">Reading your workbook…</div>
      {filename ? <div className="state-sub" style={{ color: "var(--text-muted)", fontSize: 12 }}>{filename}</div> : null}
      <div className="state-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
        Parsing all 14 sheets and running QA/QC checks
      </div>
    </div>
  );
}

export function ErrorBanner({ title, errors }: { title: string; errors: string[] }) {
  return (
    <div className="error-banner">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon name="alert-triangle" size={16} />
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      <ul>
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
