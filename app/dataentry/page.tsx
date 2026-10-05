"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { QaDot } from "@/components/ui/Badge";
import { useStore } from "@/context/StoreContext";
import {
  calculateStore,
  createSampleDataset,
  DEFAULT_FUEL_FACTORS,
  DEFAULT_CONSTANTS,
  toNum,
} from "@/lib/calcEngine";
import { downloadExcel, downloadBlankTemplate } from "@/lib/export";
import type { SheetRow } from "@/lib/types";

type TabKey =
  | "setup"
  | "production"
  | "rawmaterial"
  | "kilnfuel"
  | "electricity"
  | "constants"
  | "evidence"
  | "review";

const DRAFT_KEY = "EGYTRACE_DATAENTRY_DRAFT_V1";

const BLANK_FORM = {
  setup: {
    "Workbook mode": "Cement_QAQC_V28",
    "Installation / site": "",
    Country: "Egypt",
    "Reporting quarter": "Q1 2025",
    "Period start": "2025-01-01",
    "Period end": "2025-03-31",
    "Primary product": "CEM II/A-L 42.5N",
    "Boundary approach": "Operational control",
    "Selected calcination method": "Method B - clinker output",
    "Assurance status": "Prepared for internal review - not externally verified",
    "Submission status": "Draft / Online Studio",
    "CKD correction applied": "No",
  },
  production: [
    {
      Date: "2025-01-31",
      Quarter: "Q1 2025",
      "Kiln Line": "Kiln 1",
      "Cement Type": "CEM II/A-L 42.5N",
      "Clinker Produced t": 175000,
      "Cement Produced t": 230000,
      "Clinker Used t": 175100,
      "Gypsum t": 11500,
      "Limestone Additive t": 43400,
      "Other Additives t": 0,
      "Evidence ID": "EV-PROD-01",
      Notes: "Month 1 production",
    },
  ] as SheetRow[],
  rawMaterial: [
    {
      Date: "2025-01-31",
      Material: "Raw Meal",
      "Quantity t": 275000,
      "CaCO3 %": 78.5,
      "MgCO3 %": 2.1,
      "Moisture %": 0.8,
      "Calcination Conversion": 1.0,
      "Evidence ID": "EV-RAW-01",
    },
  ] as SheetRow[],
  kilnFuel: [
    {
      Date: "2025-01-31",
      "Fuel Type": "Petcoke",
      Quantity: 38000,
      Unit: "t",
      "NCV GJ/unit": 32.5,
      "EF tCO2/TJ": 97.5,
      "Oxidation Factor": 0.99,
      "Biomass Fraction": 0.0,
      "Evidence ID": "EV-FUEL-01",
    },
  ] as SheetRow[],
  electricity: [
    {
      Date: "2025-01-31",
      "Meter / Source": "Main Substation M-01",
      "Grid MWh": 32000,
      "Grid EF tCO2/MWh": 0.4878,
      "Self-generation MWh": 0,
      "Self-generation EF": 0,
      "Renewable MWh": 0,
      "Evidence ID": "EV-ELEC-01",
    },
  ] as SheetRow[],
  constants: [...DEFAULT_CONSTANTS] as SheetRow[],
  evidence: [
    {
      "Evidence ID": "EV-PROD-01",
      "Evidence Type": "Production log",
      Description: "Monthly weighbridge production logs",
      "Source System": "Kiln DCS / ERP",
      "Mapped Sheet": "03_Production_Input",
      Status: "Mapped",
      Owner: "Production",
      Reviewer: "MRV Team",
      Frequency: "Monthly",
      Notes: "Calibrated scales",
    },
    {
      "Evidence ID": "EV-RAW-01",
      "Evidence Type": "Lab certificate",
      Description: "Raw meal carbonate titration analysis",
      "Source System": "LIMS",
      "Mapped Sheet": "04_Raw_Material_Input",
      Status: "Mapped",
      Owner: "Lab",
      Reviewer: "MRV Team",
      Frequency: "Monthly",
      Notes: "ISO 17025 accredited",
    },
    {
      "Evidence ID": "EV-FUEL-01",
      "Evidence Type": "Fuel record",
      Description: "Fuel delivery weigh tickets and lab NCV certificates",
      "Source System": "Fuel ERP",
      "Mapped Sheet": "05_Kiln_Fuel_Input",
      Status: "Mapped",
      Owner: "Energy",
      Reviewer: "MRV Team",
      Frequency: "Monthly",
      Notes: "Calibrated weigh feeder",
    },
    {
      "Evidence ID": "EV-ELEC-01",
      "Evidence Type": "Electricity bill",
      Description: "Fiscal electricity meter utility invoices",
      "Source System": "Electricity Meter",
      "Mapped Sheet": "06_Electricity_Input",
      Status: "Mapped",
      Owner: "Utilities",
      Reviewer: "MRV Team",
      Frequency: "Monthly",
      Notes: "Utility grid meter",
    },
  ] as SheetRow[],
};

export default function DataEntryPage() {
  const router = useRouter();
  const { store, setStoreData } = useStore();
  const [activeTab, setActiveTab] = useState<TabKey>("setup");
  const [formData, setFormData] = useState(BLANK_FORM);
  const [isSaved, setIsSaved] = useState(false);
  const [submittedAlert, setSubmittedAlert] = useState(false);

  // Initialize draft: prioritize localStorage, else if store exists populate from store, else blank
  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsed = JSON.parse(draft);
        if (parsed && parsed.setup) {
          setFormData(parsed);
          return;
        }
      }
      if (store && store._valid) {
        setFormData({
          setup: { ...BLANK_FORM.setup, ...store.setup } as any,
          production: [...store.production],
          rawMaterial: [...store.rawMaterial],
          kilnFuel: [...store.kilnFuel],
          electricity: [...store.electricity],
          constants: store.constants.length ? [...store.constants] : [...DEFAULT_CONSTANTS],
          evidence: [...store.evidence],
        });
      }
    } catch (e) {
      console.error("Failed to load draft:", e);
    }
  }, [store]);

  // Auto-save draft on changes
  const saveDraft = useCallback(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (e) {
      console.error("Draft save error:", e);
    }
  }, [formData]);

  // Real-time calculation engine evaluation
  const computedStore = useMemo(() => {
    return calculateStore(formData);
  }, [formData]);

  // Section completeness computation
  const sectionStatus = useMemo(() => {
    const s = formData.setup;
    const setupValid = Boolean(s["Installation / site"] && s["Reporting quarter"] && s["Period start"] && s["Period end"]);
    const prodValid = formData.production.length > 0 && formData.production.every((r) => toNum(r["Cement Produced t"]) > 0);
    const rawValid = formData.rawMaterial.length > 0 && formData.rawMaterial.every((r) => toNum(r["Quantity t"]) > 0);
    const fuelValid = formData.kilnFuel.length > 0 && formData.kilnFuel.every((r) => toNum(r["Quantity"]) > 0 && toNum(r["NCV GJ/unit"]) > 0);
    const elecValid = formData.electricity.length > 0 && formData.electricity.every((r) => toNum(r["Grid MWh"]) > 0);
    const constValid = formData.constants.length > 0;
    const evidValid = formData.evidence.length > 0;

    const sections = [setupValid, prodValid, rawValid, fuelValid, elecValid, constValid, evidValid];
    const completedCount = sections.filter(Boolean).length;
    const progressPct = Math.round((completedCount / sections.length) * 100);

    return {
      setup: setupValid,
      production: prodValid,
      rawmaterial: rawValid,
      kilnfuel: fuelValid,
      electricity: elecValid,
      constants: constValid,
      evidence: evidValid,
      progressPct,
      completedCount,
      totalCount: sections.length,
    };
  }, [formData]);

  // Form field update helpers
  function updateSetup(key: string, val: string) {
    setFormData((prev) => ({
      ...prev,
      setup: { ...prev.setup, [key]: val },
    }));
  }

  function updateRow(section: "production" | "rawMaterial" | "kilnFuel" | "electricity" | "evidence" | "constants", idx: number, key: string, val: any) {
    setFormData((prev) => {
      const list = [...prev[section]];
      const updated = { ...list[idx], [key]: val };

      // If updating fuel type, auto-populate default NCV, EF, biomass, ox
      if (section === "kilnFuel" && key === "Fuel Type") {
        const factor = DEFAULT_FUEL_FACTORS[val];
        if (factor) {
          updated["NCV GJ/unit"] = factor.ncv;
          updated["Unit"] = factor.ncvUnit.includes("Nm3") ? "Nm3" : "t";
          updated["EF tCO2/TJ"] = factor.ef;
          updated["Oxidation Factor"] = factor.ox;
          updated["Biomass Fraction"] = factor.biomass;
        }
      }

      list[idx] = updated;
      return { ...prev, [section]: list };
    });
  }

  function addRow(section: "production" | "rawMaterial" | "kilnFuel" | "electricity" | "evidence") {
    setFormData((prev) => {
      let newRow: SheetRow = {};
      const q = prev.setup["Reporting quarter"] || "Q1 2025";
      const date = prev.setup["Period end"] || "2025-03-31";

      if (section === "production") {
        newRow = { Date: date, Quarter: q, "Kiln Line": "Kiln 1", "Cement Type": prev.setup["Primary product"] || "CEM II/A-L 42.5N", "Clinker Produced t": 0, "Cement Produced t": 0, "Clinker Used t": 0, "Gypsum t": 0, "Limestone Additive t": 0, "Other Additives t": 0, "Evidence ID": `EV-PROD-0${prev.production.length + 1}`, Notes: "" };
      } else if (section === "rawMaterial") {
        newRow = { Date: date, Material: "Raw Meal", "Quantity t": 0, "CaCO3 %": 78.5, "MgCO3 %": 2.0, "Moisture %": 0.8, "Calcination Conversion": 1.0, "Evidence ID": `EV-RAW-0${prev.rawMaterial.length + 1}` };
      } else if (section === "kilnFuel") {
        newRow = { Date: date, "Fuel Type": "Petcoke", Quantity: 0, Unit: "t", "NCV GJ/unit": 32.5, "EF tCO2/TJ": 97.5, "Oxidation Factor": 0.99, "Biomass Fraction": 0.0, "Evidence ID": `EV-FUEL-0${prev.kilnFuel.length + 1}` };
      } else if (section === "electricity") {
        newRow = { Date: date, "Meter / Source": "Main Substation M-01", "Grid MWh": 0, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": `EV-ELEC-0${prev.electricity.length + 1}` };
      } else if (section === "evidence") {
        newRow = { "Evidence ID": `EV-NEW-0${prev.evidence.length + 1}`, "Evidence Type": "Calibration log", Description: "New document traceability record", "Source System": "ERP", "Mapped Sheet": "03_Production_Input", Status: "Mapped", Owner: "MRV Team", Reviewer: "QA/QC", Frequency: "Quarterly", Notes: "" };
      }

      return {
        ...prev,
        [section]: [...prev[section], newRow],
      };
    });
  }

  function removeRow(section: "production" | "rawMaterial" | "kilnFuel" | "electricity" | "evidence", idx: number) {
    setFormData((prev) => {
      const list = prev[section].filter((_, i) => i !== idx);
      return { ...prev, [section]: list };
    });
  }

  function handleLoadSample() {
    const sample = createSampleDataset();
    setFormData(sample);
    saveDraft();
  }

  function handleReset() {
    if (confirm("Reset online template? Any unsaved inputs will be cleared.")) {
      setFormData(BLANK_FORM);
      localStorage.removeItem(DRAFT_KEY);
    }
  }

  function handleSubmit() {
    const finalStore = calculateStore(formData);
    setStoreData(finalStore);
    saveDraft();
    setSubmittedAlert(true);
    setTimeout(() => {
      router.push("/overview");
    }, 1200);
  }

  const qaOverall = computedStore.calculations["QA/QC Overall Status"]?.Value || "PASS";
  const qaBadgeClass = qaOverall === "PASS" ? "badge-pass" : qaOverall === "FAIL" ? "badge-fail" : "badge-warn";

  return (
    <div className="page-container" style={{ paddingBottom: 60 }}>
      {/* ── Studio Header ── */}
      <div className="studio-header">
        <div className="studio-header-top">
          <div className="studio-title-group">
            <h1>
              <Icon name="edit-3" size={22} className="text-accent" />
              Online Data Entry Studio
            </h1>
            <p className="studio-subtitle">
              Create, calculate, and verify cement plant MRV datasets directly through the browser. 100% compliant with the official 14-sheet collection schema.
            </p>
          </div>

          <div className="studio-actions-bar">
            {isSaved && (
              <span className="badge badge-pass" style={{ fontSize: 11 }}>
                <Icon name="check" size={12} /> Draft Saved
              </span>
            )}
            <span className={`badge ${qaBadgeClass}`} style={{ fontSize: 11 }}>
              <QaDot status={String(qaOverall)} /> QA/QC {String(qaOverall)}
            </span>

            <button type="button" className="btn btn-secondary btn-sm" onClick={handleLoadSample} title="Pre-fill with validated Helwan Q1 dataset">
              <Icon name="play" size={13} /> Load Demo Dataset
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={saveDraft} title="Save to local browser cache">
              <Icon name="save" size={13} /> Save Draft
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={downloadBlankTemplate} title="Download blank 14-sheet Excel template">
              <Icon name="download" size={13} /> Blank Template (.xlsx)
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadExcel(computedStore)} title="Export current data as Excel">
              <Icon name="file-spreadsheet" size={13} /> Export Excel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit} title="Apply dataset to active platform dashboard">
              <Icon name="check-circle" size={13} /> Submit & Apply
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="studio-progress-wrap">
          <div className="studio-progress-bar">
            <div className="studio-progress-fill" style={{ width: `${sectionStatus.progressPct}%` }} />
          </div>
          <div className="studio-progress-text">
            {sectionStatus.completedCount} of {sectionStatus.totalCount} Sections Configured ({sectionStatus.progressPct}%)
          </div>
        </div>
      </div>

      {submittedAlert && (
        <div className="card card-accent mb-lg" style={{ background: "var(--qa-pass-dim)", borderColor: "var(--qa-pass-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--qa-pass)" }}>
            <Icon name="check-circle" size={20} />
            <div>
              <strong>Submission Successful!</strong>
              <div style={{ fontSize: 12 }}>Emissions calculations and 18 QA/QC rules verified. Redirecting to Overview dashboard...</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Section Navigation Tabs ── */}
      <div className="studio-tabs-bar">
        {[
          { key: "setup", label: "01 Setup & Facility", valid: sectionStatus.setup },
          { key: "production", label: "03 Production", valid: sectionStatus.production },
          { key: "rawmaterial", label: "04 Raw Materials", valid: sectionStatus.rawmaterial },
          { key: "kilnfuel", label: "05 Kiln Fuels", valid: sectionStatus.kilnfuel },
          { key: "electricity", label: "06 Electricity", valid: sectionStatus.electricity },
          { key: "constants", label: "07 Factors & Bounds", valid: sectionStatus.constants },
          { key: "evidence", label: "11 Evidence Register", valid: sectionStatus.evidence },
          { key: "review", label: "Review & Validate", valid: qaOverall === "PASS" },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              className={`studio-tab-btn${isActive ? " active" : ""}`}
              onClick={() => setActiveTab(tab.key as TabKey)}
            >
              <span>{tab.label}</span>
              <span className="studio-tab-badge">
                {tab.valid ? "✓" : "•"}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── TAB 1: Setup & Governance ── */}
      {activeTab === "setup" && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 16 }}>
            <div className="section-title">01 Setup and Facility Parameters</div>
            <div className="section-sub">Facility identifiers, accounting boundary, and methodology control lock.</div>
          </div>

          <div className="form-grid-2">
            <div className="form-field">
              <label>
                Installation / Site Name <span className="required">*</span>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Helwan Cement Plant"
                value={formData.setup["Installation / site"] || ""}
                onChange={(e) => updateSetup("Installation / site", e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Country Jurisdiction <span className="required">*</span></label>
              <input
                type="text"
                className="form-input"
                value={formData.setup.Country || "Egypt"}
                onChange={(e) => updateSetup("Country", e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Reporting Quarter <span className="required">*</span></label>
              <select
                className="form-select"
                value={formData.setup["Reporting quarter"] || "Q1 2025"}
                onChange={(e) => updateSetup("Reporting quarter", e.target.value)}
              >
                <option value="Q1 2025">Q1 2025 (Jan - Mar)</option>
                <option value="Q2 2025">Q2 2025 (Apr - Jun)</option>
                <option value="Q3 2025">Q3 2025 (Jul - Sep)</option>
                <option value="Q4 2025">Q4 2025 (Oct - Dec)</option>
                <option value="Annual 2025">Full Year 2025</option>
              </select>
            </div>

            <div className="form-field">
              <label>Primary Cement Product <span className="required">*</span></label>
              <select
                className="form-select"
                value={formData.setup["Primary product"] || "CEM II/A-L 42.5N"}
                onChange={(e) => updateSetup("Primary product", e.target.value)}
              >
                <option value="CEM I 42.5R">CEM I 42.5R (Pure Portland)</option>
                <option value="CEM II/A-L 42.5N">CEM II/A-L 42.5N (Portland Limestone)</option>
                <option value="CEM II/B-L 32.5R">CEM II/B-L 32.5R (Composite)</option>
                <option value="CEM III/A 42.5N">CEM III/A 42.5N (Blast Furnace)</option>
                <option value="CEM IV/B (P) 32.5N">CEM IV/B (P) 32.5N (Pozzolanic)</option>
              </select>
            </div>

            <div className="form-field">
              <label>Period Start Date</label>
              <input
                type="date"
                className="form-input"
                value={formData.setup["Period start"] || "2025-01-01"}
                onChange={(e) => updateSetup("Period start", e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Period End Date</label>
              <input
                type="date"
                className="form-input"
                value={formData.setup["Period end"] || "2025-03-31"}
                onChange={(e) => updateSetup("Period end", e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>Boundary Approach</label>
              <select
                className="form-select"
                value={formData.setup["Boundary approach"] || "Operational control"}
                onChange={(e) => updateSetup("Boundary approach", e.target.value)}
              >
                <option value="Operational control">Operational control (Recommended)</option>
                <option value="Financial control">Financial control</option>
                <option value="Equity share">Equity share</option>
              </select>
            </div>

            <div className="form-field">
              <label>Selected Calcination Method</label>
              <select
                className="form-select"
                value={formData.setup["Selected calcination method"] || "Method B - clinker output"}
                onChange={(e) => updateSetup("Selected calcination method", e.target.value)}
              >
                <option value="Method B - clinker output">Method B — Clinker Output Factor (0.5325 tCO2/t)</option>
                <option value="Method A - raw material input">Method A — Raw Material Carbonates Stoichiometry</option>
              </select>
            </div>

            <div className="form-field">
              <label>Assurance Status</label>
              <input
                type="text"
                className="form-input"
                value={formData.setup["Assurance status"] || ""}
                onChange={(e) => updateSetup("Assurance status", e.target.value)}
              />
            </div>

            <div className="form-field">
              <label>CKD Correction Applied?</label>
              <select
                className="form-select"
                value={formData.setup["CKD correction applied"] || "No"}
                onChange={(e) => updateSetup("CKD correction applied", e.target.value)}
              >
                <option value="No">No (Standard kiln dust recirculation)</option>
                <option value="Yes">Yes (Calcined dust wasted off-site)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: Production Data ── */}
      {activeTab === "production" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">03 Production Activity Data</div>
              <div className="section-sub">Monthly clinker and cement quantities with automated clinker factor calculation.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("production")}>
              <Icon name="plus" size={13} /> Add Production Record
            </button>
          </div>

          <div className="entry-table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Kiln Line</th>
                  <th>Cement Type</th>
                  <th>Clinker Produced (t)</th>
                  <th>Cement Produced (t)</th>
                  <th>Clinker Used (t)</th>
                  <th>Gypsum (t)</th>
                  <th>Limestone Additive (t)</th>
                  <th>Clinker Factor</th>
                  <th>QA</th>
                  <th>Evidence</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {formData.production.map((row, idx) => {
                  const clkProd = toNum(row["Clinker Produced t"]);
                  const cmtProd = toNum(row["Cement Produced t"]);
                  const clkUsed = toNum(row["Clinker Used t"]);
                  const factor = cmtProd > 0 ? (clkUsed / cmtProd).toFixed(3) : "—";
                  const pass = cmtProd > 0 && clkUsed / cmtProd >= 0.25 && clkUsed / cmtProd <= 1.0;

                  return (
                    <tr key={idx}>
                      <td>
                        <input
                          type="date"
                          className="table-input"
                          value={String(row.Date || "")}
                          onChange={(e) => updateRow("production", idx, "Date", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ minWidth: 65 }}
                          value={String(row["Kiln Line"] || "Kiln 1")}
                          onChange={(e) => updateRow("production", idx, "Kiln Line", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ minWidth: 120 }}
                          value={String(row["Cement Type"] || "")}
                          onChange={(e) => updateRow("production", idx, "Cement Type", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={clkProd || ""}
                          onChange={(e) => updateRow("production", idx, "Clinker Produced t", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={cmtProd || ""}
                          onChange={(e) => updateRow("production", idx, "Cement Produced t", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={clkUsed || ""}
                          onChange={(e) => updateRow("production", idx, "Clinker Used t", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={toNum(row["Gypsum t"]) || ""}
                          onChange={(e) => updateRow("production", idx, "Gypsum t", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={toNum(row["Limestone Additive t"]) || ""}
                          onChange={(e) => updateRow("production", idx, "Limestone Additive t", e.target.value)}
                        />
                      </td>
                      <td>
                        <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                          {factor}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${pass ? "badge-pass" : "badge-warn"}`} style={{ fontSize: 10 }}>
                          {pass ? "PASS" : "WARN"}
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ minWidth: 90 }}
                          value={String(row["Evidence ID"] || "")}
                          onChange={(e) => updateRow("production", idx, "Evidence ID", e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-delete-row"
                          onClick={() => removeRow("production", idx)}
                          title="Delete row"
                        >
                          <Icon name="trash-2" size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-label">Total Clinker Produced</div>
              <div className="kpi-value">
                {computedStore.calculations["Clinker Produced"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">t</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Total Cement Produced</div>
              <div className="kpi-value">
                {computedStore.calculations["Cement Produced"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">t</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Weighted Clinker Factor</div>
              <div className="kpi-value">
                {String(computedStore.calculations["Clinker Factor"]?.Value ?? "—")}
                <span className="kpi-unit">ratio</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Stockpile Delta</div>
              <div className="kpi-value">
                {computedStore.calculations["Clinker Stockpile Delta"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">t</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: Raw Materials (Method A) ── */}
      {activeTab === "rawmaterial" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">04 Raw Material Carbonate Input</div>
              <div className="section-sub">Raw meal consumption and lab titration stoichiometry for Method A calcination calculation.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("rawMaterial")}>
              <Icon name="plus" size={13} /> Add Raw Material Record
            </button>
          </div>

          <div className="entry-table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Material</th>
                  <th>Quantity (t)</th>
                  <th>CaCO3 %</th>
                  <th>MgCO3 %</th>
                  <th>Moisture %</th>
                  <th>Calcination Conv</th>
                  <th>Method A CO2 (t)</th>
                  <th>Evidence</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {formData.rawMaterial.map((row, idx) => {
                  const qty = toNum(row["Quantity t"]);
                  const caco3 = toNum(row["CaCO3 %"]);
                  const mgco3 = toNum(row["MgCO3 %"]);
                  const conv = toNum(row["Calcination Conversion"], 1.0);
                  const calcCO2 = qty * (caco3 / 100) * (44.01 / 100.09) * conv + qty * (mgco3 / 100) * (44.01 / 84.31) * conv;

                  return (
                    <tr key={idx}>
                      <td>
                        <input
                          type="date"
                          className="table-input"
                          value={String(row.Date || "")}
                          onChange={(e) => updateRow("rawMaterial", idx, "Date", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          value={String(row.Material || "Raw Meal")}
                          onChange={(e) => updateRow("rawMaterial", idx, "Material", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={qty || ""}
                          onChange={(e) => updateRow("rawMaterial", idx, "Quantity t", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          className="table-input"
                          value={caco3 || ""}
                          onChange={(e) => updateRow("rawMaterial", idx, "CaCO3 %", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          className="table-input"
                          value={mgco3 || ""}
                          onChange={(e) => updateRow("rawMaterial", idx, "MgCO3 %", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          className="table-input"
                          value={toNum(row["Moisture %"]) || ""}
                          onChange={(e) => updateRow("rawMaterial", idx, "Moisture %", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="table-input"
                          value={conv}
                          onChange={(e) => updateRow("rawMaterial", idx, "Calcination Conversion", e.target.value)}
                        />
                      </td>
                      <td>
                        <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                          {calcCO2.toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ minWidth: 90 }}
                          value={String(row["Evidence ID"] || "")}
                          onChange={(e) => updateRow("rawMaterial", idx, "Evidence ID", e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-delete-row"
                          onClick={() => removeRow("rawMaterial", idx)}
                          title="Delete row"
                        >
                          <Icon name="trash-2" size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-label">Method A Process CO2</div>
              <div className="kpi-value">
                {computedStore.calculations["Process CO2 Method A"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Method B Process CO2 (Clinker EF)</div>
              <div className="kpi-value">
                {computedStore.calculations["Process CO2 Method B"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Active Selected Process CO2</div>
              <div className="kpi-value">
                {computedStore.calculations["Selected Process CO2"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 4: Kiln Fuels ── */}
      {activeTab === "kilnfuel" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">05 Kiln Fuel Combustion Activity</div>
              <div className="section-sub">Thermal energy and fossil vs biogenic emissions. Selecting a preset fuel auto-populates standard NCV, EF, and biomass factors.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("kilnFuel")}>
              <Icon name="plus" size={13} /> Add Fuel Line
            </button>
          </div>

          <div className="entry-table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Fuel Type</th>
                  <th>Quantity</th>
                  <th>Unit</th>
                  <th>NCV (GJ/unit)</th>
                  <th>EF (tCO2/TJ)</th>
                  <th>Oxidation</th>
                  <th>Biomass %</th>
                  <th>Energy (GJ)</th>
                  <th>Fossil CO2 (t)</th>
                  <th>Biogenic (t)</th>
                  <th>Evidence</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {formData.kilnFuel.map((row, idx) => {
                  const qty = toNum(row["Quantity"]);
                  const ncv = toNum(row["NCV GJ/unit"]);
                  const ef = toNum(row["EF tCO2/TJ"]);
                  const ox = toNum(row["Oxidation Factor"], 1.0);
                  const bio = toNum(row["Biomass Fraction"], 0.0);
                  const fossilFrac = Math.max(0, 1.0 - bio);

                  const energyGJ = qty * ncv;
                  const energyTJ = energyGJ / 1000.0;
                  const fossilCO2 = energyTJ * ef * ox * fossilFrac;
                  const biogenicCO2 = energyTJ * ef * ox * bio;

                  return (
                    <tr key={idx}>
                      <td>
                        <input
                          type="date"
                          className="table-input"
                          value={String(row.Date || "")}
                          onChange={(e) => updateRow("kilnFuel", idx, "Date", e.target.value)}
                        />
                      </td>
                      <td>
                        <select
                          className="table-select"
                          value={String(row["Fuel Type"] || "Petcoke")}
                          onChange={(e) => updateRow("kilnFuel", idx, "Fuel Type", e.target.value)}
                        >
                          <option value="Petcoke">Petcoke (Fossil)</option>
                          <option value="Coal">Coal (Fossil)</option>
                          <option value="RDF">RDF (50% Biomass)</option>
                          <option value="Tyre Chips">Tyre Chips (27% Biomass)</option>
                          <option value="Natural Gas">Natural Gas (Gaseous)</option>
                          <option value="Diesel">Diesel (Liquid)</option>
                          <option value="Custom">Custom Fuel</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={qty || ""}
                          onChange={(e) => updateRow("kilnFuel", idx, "Quantity", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ width: 45 }}
                          value={String(row.Unit || "t")}
                          onChange={(e) => updateRow("kilnFuel", idx, "Unit", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="table-input"
                          value={ncv || ""}
                          onChange={(e) => updateRow("kilnFuel", idx, "NCV GJ/unit", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.1"
                          className="table-input"
                          value={ef || ""}
                          onChange={(e) => updateRow("kilnFuel", idx, "EF tCO2/TJ", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.005"
                          className="table-input"
                          value={ox}
                          onChange={(e) => updateRow("kilnFuel", idx, "Oxidation Factor", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.05"
                          className="table-input"
                          value={bio}
                          onChange={(e) => updateRow("kilnFuel", idx, "Biomass Fraction", e.target.value)}
                        />
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                          {energyGJ.toFixed(0)}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                          {fossilCO2.toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
                          {biogenicCO2.toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ minWidth: 90 }}
                          value={String(row["Evidence ID"] || "")}
                          onChange={(e) => updateRow("kilnFuel", idx, "Evidence ID", e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-delete-row"
                          onClick={() => removeRow("kilnFuel", idx)}
                          title="Delete row"
                        >
                          <Icon name="trash-2" size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-label">Total Fuel Energy</div>
              <div className="kpi-value">
                {computedStore.calculations["Total Fuel Energy"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">GJ</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Fossil Combustion CO2</div>
              <div className="kpi-value">
                {computedStore.calculations["Fuel Combustion CO2"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Biogenic CO2 Memo</div>
              <div className="kpi-value">
                {computedStore.calculations["Biogenic CO2 Memo"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Thermal Substitution (TSR)</div>
              <div className="kpi-value">
                {String(computedStore.calculations["Thermal Substitution Rate (TSR)"]?.Value ?? 0)}
                <span className="kpi-unit">%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 5: Electricity ── */}
      {activeTab === "electricity" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">06 Purchased Electricity Activity (Scope 2)</div>
              <div className="section-sub">Fiscal meter records and country grid emission factor.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("electricity")}>
              <Icon name="plus" size={13} /> Add Electricity Meter Log
            </button>
          </div>

          <div className="entry-table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Meter / Substation Tag</th>
                  <th>Grid MWh</th>
                  <th>Grid EF (tCO2/MWh)</th>
                  <th>Self-generation MWh</th>
                  <th>Renewable MWh</th>
                  <th>Indirect CO2 (t)</th>
                  <th>Evidence</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {formData.electricity.map((row, idx) => {
                  const mwh = toNum(row["Grid MWh"]);
                  const ef = toNum(row["Grid EF tCO2/MWh"], 0.4878);
                  const co2 = mwh * ef;

                  return (
                    <tr key={idx}>
                      <td>
                        <input
                          type="date"
                          className="table-input"
                          value={String(row.Date || "")}
                          onChange={(e) => updateRow("electricity", idx, "Date", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          value={String(row["Meter / Source"] || "")}
                          onChange={(e) => updateRow("electricity", idx, "Meter / Source", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={mwh || ""}
                          onChange={(e) => updateRow("electricity", idx, "Grid MWh", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.0001"
                          className="table-input"
                          value={ef}
                          onChange={(e) => updateRow("electricity", idx, "Grid EF tCO2/MWh", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={toNum(row["Self-generation MWh"]) || ""}
                          onChange={(e) => updateRow("electricity", idx, "Self-generation MWh", e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="table-input"
                          value={toNum(row["Renewable MWh"]) || ""}
                          onChange={(e) => updateRow("electricity", idx, "Renewable MWh", e.target.value)}
                        />
                      </td>
                      <td>
                        <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                          {co2.toFixed(1)}
                        </span>
                      </td>
                      <td>
                        <input
                          type="text"
                          className="table-input"
                          style={{ minWidth: 90 }}
                          value={String(row["Evidence ID"] || "")}
                          onChange={(e) => updateRow("electricity", idx, "Evidence ID", e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-delete-row"
                          onClick={() => removeRow("electricity", idx)}
                          title="Delete row"
                        >
                          <Icon name="trash-2" size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-label">Total Grid Electricity</div>
              <div className="kpi-value">
                {computedStore.calculations["Grid Electricity MWh"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">MWh</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Indirect Grid CO2</div>
              <div className="kpi-value">
                {computedStore.calculations["Indirect Grid CO2"]?.Value?.toLocaleString() || 0}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 6: Factors & Constants ── */}
      {activeTab === "constants" && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div className="section-title">07 Emission Factors, Constants & QA/QC Bounds</div>
            <div className="section-sub">Underlying stoichiometric factors and tolerance limits used by the calculation and QA engine.</div>
          </div>

          <div className="entry-table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Constant / Factor</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th>Source / Rationale</th>
                  <th>Used In</th>
                  <th>Control Status</th>
                </tr>
              </thead>
              <tbody>
                {formData.constants.map((row, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}>{String(row["Constant / Factor"] || "")}</td>
                    <td>
                      <input
                        type="number"
                        step="0.0001"
                        className="table-input"
                        style={{ maxWidth: 110 }}
                        value={toNum(row.Value)}
                        onChange={(e) => updateRow("constants", idx, "Value", e.target.value)}
                      />
                    </td>
                    <td>{String(row.Unit || "")}</td>
                    <td>{String(row["Source / rationale"] || "")}</td>
                    <td>
                      <span className="badge badge-secondary" style={{ fontSize: 10.5 }}>
                        {String(row["Used in"] || "")}
                      </span>
                    </td>
                    <td>
                      <span className="badge badge-pass" style={{ fontSize: 10.5 }}>
                        {String(row.Status || "Approved")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 7: Evidence Register ── */}
      {activeTab === "evidence" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">11 Evidence Document Register</div>
              <div className="section-sub">Document traceability linking input records to weigh tickets, lab certificates, and meter invoices.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("evidence")}>
              <Icon name="plus" size={13} /> Add Evidence Document
            </button>
          </div>

          <div className="entry-table-wrap">
            <table className="entry-table">
              <thead>
                <tr>
                  <th>Evidence ID</th>
                  <th>Document Type</th>
                  <th>Description</th>
                  <th>Source System</th>
                  <th>Mapped Sheet</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th style={{ width: 36 }}></th>
                </tr>
              </thead>
              <tbody>
                {formData.evidence.map((row, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        type="text"
                        className="table-input"
                        style={{ minWidth: 100 }}
                        value={String(row["Evidence ID"] || "")}
                        onChange={(e) => updateRow("evidence", idx, "Evidence ID", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="table-input"
                        value={String(row["Evidence Type"] || "")}
                        onChange={(e) => updateRow("evidence", idx, "Evidence Type", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="table-input"
                        value={String(row.Description || "")}
                        onChange={(e) => updateRow("evidence", idx, "Description", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="table-input"
                        value={String(row["Source System"] || "")}
                        onChange={(e) => updateRow("evidence", idx, "Source System", e.target.value)}
                      />
                    </td>
                    <td>
                      <select
                        className="table-select"
                        value={String(row["Mapped Sheet"] || "03_Production_Input")}
                        onChange={(e) => updateRow("evidence", idx, "Mapped Sheet", e.target.value)}
                      >
                        <option value="03_Production_Input">03 Production</option>
                        <option value="04_Raw_Material_Input">04 Raw Materials</option>
                        <option value="05_Kiln_Fuel_Input">05 Kiln Fuels</option>
                        <option value="06_Electricity_Input">06 Electricity</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="table-select"
                        value={String(row.Status || "Mapped")}
                        onChange={(e) => updateRow("evidence", idx, "Status", e.target.value)}
                      >
                        <option value="Mapped">Mapped</option>
                        <option value="Pending">Pending</option>
                        <option value="Missing">Missing</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="table-input"
                        value={String(row.Owner || "")}
                        onChange={(e) => updateRow("evidence", idx, "Owner", e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-delete-row"
                        onClick={() => removeRow("evidence", idx)}
                        title="Delete row"
                      >
                        <Icon name="trash-2" size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 8: Review & Validate ── */}
      {activeTab === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Executive Calculations Summary */}
          <div className="card">
            <div className="section-header" style={{ marginBottom: 16 }}>
              <div className="section-title">Calculated Embedded Emissions Summary</div>
              <div className="section-sub">Derived regulatory emission metrics computed from the online workbook inputs.</div>
            </div>

            <div className="kpi-mini-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              <div className="kpi-mini-card">
                <div className="kpi-label">Direct Embedded CO2</div>
                <div className="kpi-value">
                  {computedStore.calculations["Direct Embedded CO2"]?.Value?.toLocaleString() || 0}
                  <span className="kpi-unit">tCO2</span>
                </div>
              </div>
              <div className="kpi-mini-card">
                <div className="kpi-label">Indirect Grid CO2</div>
                <div className="kpi-value">
                  {computedStore.calculations["Indirect Grid CO2"]?.Value?.toLocaleString() || 0}
                  <span className="kpi-unit">tCO2</span>
                </div>
              </div>
              <div className="kpi-mini-card" style={{ borderLeft: "3px solid var(--accent)" }}>
                <div className="kpi-label">Total Embedded CO2</div>
                <div className="kpi-value" style={{ color: "var(--accent)" }}>
                  {computedStore.calculations["Total Embedded CO2"]?.Value?.toLocaleString() || 0}
                  <span className="kpi-unit">tCO2</span>
                </div>
              </div>
              <div className="kpi-mini-card">
                <div className="kpi-label">SEE Clinker Intensity</div>
                <div className="kpi-value">
                  {String(computedStore.calculations["SEE Clinker"]?.Value ?? 0)}
                  <span className="kpi-unit">tCO2/t clinker</span>
                </div>
              </div>
              <div className="kpi-mini-card" style={{ borderLeft: "3px solid var(--accent)" }}>
                <div className="kpi-label">SEE Cement (Specific Embedded)</div>
                <div className="kpi-value" style={{ color: "var(--accent)" }}>
                  {String(computedStore.calculations["Specific Embedded Emissions Cement"]?.Value ?? 0)}
                  <span className="kpi-unit">tCO2/t cement</span>
                </div>
              </div>
              <div className="kpi-mini-card">
                <div className="kpi-label">Specific Heat Consumption (SHC)</div>
                <div className="kpi-value">
                  {String(computedStore.calculations["Specific Heat Consumption"]?.Value ?? 0)}
                  <span className="kpi-unit">GJ/t clinker</span>
                </div>
              </div>
            </div>
          </div>

          {/* 18 Automated QA/QC Rules Evaluation */}
          <div className="card">
            <div className="panel-toolbar">
              <div>
                <div className="section-title">Automated QA/QC Check Register (18 Rules)</div>
                <div className="section-sub">Mass balances, emission factor plausibility, and documentation completeness rules.</div>
              </div>
              <span className={`badge ${qaBadgeClass}`}>
                <QaDot status={String(qaOverall)} /> QA Status: {String(qaOverall)}
              </span>
            </div>

            <div className="entry-table-wrap">
              <table className="entry-table">
                <thead>
                  <tr>
                    <th>Check ID</th>
                    <th>Category</th>
                    <th>Check Name</th>
                    <th>Rule Specification</th>
                    <th>Result</th>
                    <th>Status</th>
                    <th>Severity</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {computedStore.qaqc.map((q, idx) => {
                    const status = String(q.Status || "PASS");
                    const badgeClass = status === "PASS" ? "badge-pass" : status === "FAIL" ? "badge-fail" : "badge-warn";

                    return (
                      <tr key={idx}>
                        <td style={{ fontWeight: 700, fontFamily: "var(--font-mono)" }}>{String(q["Check ID"] || "")}</td>
                        <td>{String(q.Category || "")}</td>
                        <td>{String(q["Check Name"] || "")}</td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>{String(q.Rule || "")}</td>
                        <td style={{ fontFamily: "var(--font-mono)" }}>{String(q.Result || "—")}</td>
                        <td>
                          <span className={`badge ${badgeClass}`} style={{ fontSize: 10.5 }}>
                            <QaDot status={status} /> {status}
                          </span>
                        </td>
                        <td>{String(q.Severity || "")}</td>
                        <td>{String(q.Owner || "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Final Action Submission Card */}
          <div className="card" style={{ background: "#F8FAFC", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Ready to Submit?</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  Submitting will load this verified dataset into the platform, updating all dashboards, calculations diagrams, and regulatory reports.
                </div>
              </div>

              <div className="panel-actions">
                <button type="button" className="btn btn-secondary" onClick={handleReset}>
                  Reset Form
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(computedStore)}>
                  <Icon name="download" size={14} /> Download Excel (.xlsx)
                </button>
                <button type="button" className="btn btn-primary" onClick={handleSubmit}>
                  <Icon name="check-circle" size={15} /> Submit Data & Update Platform
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
