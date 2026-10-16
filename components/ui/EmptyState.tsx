"use client";

import { Icon } from "@/components/icons/Icon";
import { useStore } from "@/context/StoreContext";

export function EmptyState({ title }: { title: string }) {
  const { openUpload } = useStore();

  return (
    <div className="state-box">
      <div className="state-icon" style={{ color: "var(--accent)" }}>
        <Icon name="upload" size={40} />
      </div>
      <div className="state-title">No data loaded yet</div>
      <div className="state-sub">Upload your TRACE FORCE MRV workbook to view {title.toLowerCase()}.</div>
      <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={openUpload} aria-haspopup="dialog">
        <Icon name="upload" size={14} /> Upload Readings File
      </button>
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
