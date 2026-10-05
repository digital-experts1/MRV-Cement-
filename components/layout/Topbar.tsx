"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { QaDot } from "@/components/ui/Badge";
import { useExplainer } from "@/context/ExplainerContext";
import { useStore } from "@/context/StoreContext";
import { downloadExcel, downloadPDF } from "@/lib/export";

export function Topbar() {
  const { store, toggleSidebar, handleFile } = useStore();
  const { showExplanation } = useExplainer();
  const [pdfBusy, setPdfBusy] = useState(false);

  const site = store?._valid ? String(store.setup["Installation / site"] || "Demo Cement Plant") : "TRACE FORCE MRV";
  const quarter = store?._valid ? String(store.setup["Reporting quarter"] || "—") : "No workbook loaded";
  const qaStatus = store?._valid ? String(store.calculations["QA/QC Overall Status"]?.Value || "—") : null;
  const qaColor = qaStatus === "PASS" ? "badge-pass" : qaStatus === "FAIL" ? "badge-fail" : "badge-info";

  async function onPdf() {
    if (!store) return;
    setPdfBusy(true);
    try {
      await downloadPDF(store);
    } catch (e) {
      console.error(e);
      alert("PDF generation failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <header id="topbar" role="banner">
      <button className="btn btn-secondary btn-icon" onClick={toggleSidebar} title="Toggle sidebar" aria-label="Toggle sidebar" type="button">
        <Icon name="menu" size={14} />
      </button>
      <div className="topbar-site">
        <div className="site-name">{site}</div>
        <div className="site-period">{quarter}</div>
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        {qaStatus ? (
          <span className={`badge ${qaColor}`} style={{ fontSize: 11.5, cursor: "pointer" }} onClick={() => showExplanation("kpi-qaqc-status")}>
            <QaDot status={qaStatus} /> <span className="btn-label">QA/QC</span> {qaStatus}
          </span>
        ) : null}
        <label className="btn btn-secondary btn-sm" htmlFor="file-input" title="Load Workbook" style={{ cursor: "pointer" }}>
          <Icon name="upload" size={14} /> <span className="btn-label">Load Workbook</span>
        </label>
        <input
          type="file"
          id="file-input"
          accept=".xlsx,.xlsm"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
        <button className="btn btn-primary btn-sm" id="btn-download-pdf" type="button" title={pdfBusy ? "Generating PDF" : "Get Report"} onClick={onPdf} disabled={pdfBusy} onContextMenu={(e) => { e.preventDefault(); showExplanation("btn-download-pdf"); }}>
          <Icon name="download" size={14} /> <span className="btn-label">{pdfBusy ? "Generating PDF..." : "Get Report"}</span>
        </button>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          title="Export Data"
          onClick={() => {
            if (store) downloadExcel(store);
          }}
        >
          <Icon name="file-spreadsheet" size={14} /> <span className="btn-label">Export Data</span>
        </button>
      </div>
    </header>
  );
}
