"use client";

import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { useStore } from "@/context/StoreContext";
import { downloadBlankTemplate } from "@/lib/export";
import { calculateStore, createSampleDataset } from "@/lib/calcEngine";

export function UploadPrompt() {
  const { store, handleFile, setStoreData } = useStore();
  if (store) return null;

  function loadSample() {
    const sampleData = createSampleDataset();
    const computedStore = calculateStore(sampleData);
    setStoreData(computedStore);
  }

  return (
    <div id="upload-prompt" style={{ display: "flex" }}>
      <div className="upload-card">
        <div className="uc-logo-mark">
          <Icon name="bar-chart-2" size={32} />
        </div>
        <h2>Welcome to TRACE FORCE MRV</h2>
        <p>
          Drop your cement plant workbook here and we&apos;ll take care of the rest — parsing all 14 sheets, running
          QA/QC checks, and building your compliance dashboard automatically.
        </p>

        <div style={{ margin: "18px 0 10px" }}>
          <label className="btn btn-primary" htmlFor="file-input-modal" style={{ cursor: "pointer", fontSize: 13, padding: "10px 24px" }}>
            <Icon name="upload" size={16} /> Choose your workbook (.xlsx)
          </label>
          <input
            type="file"
            id="file-input-modal"
            accept=".xlsx,.xlsm"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 14 }}>
          or drag &amp; drop anywhere on this page
        </div>

        {/* Minimal inline secondary options */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, fontSize: 12, color: "var(--text-secondary)", marginBottom: 8 }}>
          <Link href="/dataentry" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="edit-3" size={12} /> Fill online
          </Link>
          <span style={{ color: "var(--border-strong)" }}>•</span>
          <button
            type="button"
            onClick={loadSample}
            style={{ background: "none", border: "none", padding: 0, color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Icon name="play" size={11} /> Load demo data
          </button>
          <span style={{ color: "var(--border-strong)" }}>•</span>
          <button
            type="button"
            onClick={downloadBlankTemplate}
            style={{ background: "none", border: "none", padding: 0, color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <Icon name="download" size={11} /> Blank template
          </button>
        </div>

        <div className="uc-steps">
          <div className="uc-step">
            <span className="uc-step-num">1</span>
            <span>Upload workbook</span>
          </div>
          <div className="uc-step-arrow">
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="uc-step">
            <span className="uc-step-num">2</span>
            <span>Auto-parse &amp; validate</span>
          </div>
          <div className="uc-step-arrow">
            <Icon name="chevron-right" size={13} />
          </div>
          <div className="uc-step">
            <span className="uc-step-num">3</span>
            <span>Explore dashboard</span>
          </div>
        </div>

        <div style={{ marginTop: 20, fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          Supports: <strong style={{ color: "var(--text-secondary)" }}>TRACE_FORCE_MRV_Cement_QAQC_V28_Collection_Workbook</strong>
        </div>
      </div>
    </div>
  );
}
