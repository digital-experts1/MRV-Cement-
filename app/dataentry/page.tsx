"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { QaDot } from "@/components/ui/Badge";
import { EntryTable } from "@/components/dataentry/EntryTable";
import { useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";
import { calculateStore, DEFAULT_FUEL_FACTORS, DEFAULT_CONSTANTS } from "@/lib/calcEngine";
import { createSampleDataset } from "@/lib/sampleData";
import { downloadExcel, downloadBlankTemplate, downloadDataPackage } from "@/lib/export";
import { DRAFT_KEY, LEGACY_DRAFT_KEY, describeDraft, makeDraft, readDraft, resolveDraft, type DraftRecord } from "@/lib/draft";
import { scopedDraftKey } from "@/lib/tenancy/scopeKeys";
import type { MrvInput, RowSource, SheetRow } from "@/lib/types";

type TabKey =
  | "setup"
  | "production"
  | "rawmaterial"
  | "kilnfuel"
  | "electricity"
  | "inventory"
  | "constants"
  | "evidence"
  | "review";

type RowSection = "production" | "rawMaterial" | "kilnFuel" | "electricity" | "inventory" | "evidence" | "constants";

function blankForm(): MrvInput {
  return {
    meta: { origin: "manual", synthetic: false, filename: null, importedAt: null },
    readme: [],
    setupRows: [],
    dcsMap: [],
    fuelDefaults: [],
    regulatory: [],
    setup: {
      "Workbook mode": "Cement_QAQC_V28",
      "Installation / site": "",
      Country: "",
      "Reporting quarter": "",
      "Period start": "",
      "Period end": "",
      "Primary product": "",
      "Boundary approach": "",
      "Selected calcination method": "",
      "Assurance status": "Not externally verified",
      "Submission status": "Draft / Online Studio",
      "CKD correction applied": "",
    },
    production: [{ Date: "", "Kiln Line": "", "Cement Type": "", "Clinker Produced t": "", "Cement Produced t": "", "Clinker Used t": "", "Gypsum t": "", "Limestone Additive t": "", "Other Additives t": "", "Evidence ID": "", Notes: "" }],
    rawMaterial: [],
    kilnFuel: [{ Date: "", "Fuel Type": "", Quantity: "", Unit: "", "NCV GJ/unit": "", "EF tCO2/TJ": "", "Oxidation Factor": "", "Biomass Fraction": "", "Evidence ID": "" }],
    electricity: [{ Date: "", "Meter / Source": "", "Grid MWh": "", "Grid EF tCO2/MWh": "", "Self-generation MWh": "", "Self-generation EF": "", "Renewable MWh": "", "Evidence ID": "" }],
    inventory: [],
    constants: DEFAULT_CONSTANTS.map((r) => ({ ...r })),
    evidence: [],
  };
}

/** Raw input value for an editable cell; never coerces blanks to 0. */
function raw(row: SheetRow | undefined, key: string): string {
  const v = row?.[key];
  return v === null || v === undefined ? "" : String(v);
}

/** Display of a computed value; null means "not calculated", never 0. */
function show(v: unknown, dp?: number): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "number") return String(v);
  return new Intl.NumberFormat("en-US", dp === undefined ? { maximumFractionDigits: 4 } : { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(v);
}

function rowStatusBadge(status: unknown): string {
  return status === "PASS" ? "badge-pass" : status === "FAIL" ? "badge-fail" : "badge-warn";
}

export default function DataEntryPage() {
  const router = useRouter();
  const { store, setStoreData } = useStore();
  const { active, activeKey } = useScope();
  // Drafts are keyed by user/organization/factory/period; unscoped legacy drafts only exist in the local workspace.
  const draftKey = scopedDraftKey(active);
  const localWorkspace = active.tenantId === null;
  const [activeTab, setActiveTab] = useState<TabKey>("setup");
  const [formData, setFormData] = useState<MrvInput>(blankForm);
  const [baseRevision, setBaseRevision] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<{ draft: DraftRecord; reason: string } | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [submittedAlert, setSubmittedAlert] = useState(false);
  const resolvedFor = useRef<string | undefined>(undefined);

  // Explicit draft resolution by facility / period / dataset revision. Stale drafts are never applied silently.
  useEffect(() => {
    const activeRevision = store?._valid ? store.meta.revision : null;
    // Re-resolve whenever the scope changes too, so form contents never carry over to another factory/organization.
    const resolutionKey = `${activeKey}|${activeRevision}`;
    if (resolvedFor.current === resolutionKey) return;
    resolvedFor.current = resolutionKey;

    const fromStore = store?._valid ? structuredClone(store.inputs) : blankForm();
    const draft = readDraft(window.localStorage, draftKey, localWorkspace);
    const decision = resolveDraft(draft, store);
    if (decision.action === "use-draft") {
      setFormData(decision.draft.data);
      setBaseRevision(decision.draft.baseRevision);
      setPendingDraft(null);
    } else {
      setFormData(fromStore);
      setBaseRevision(activeRevision);
      setPendingDraft(decision.action === "ask" ? { draft: decision.draft, reason: decision.reason } : null);
    }
  }, [store, activeKey, draftKey, localWorkspace]);

  const saveDraft = useCallback(
    (data: MrvInput = formData) => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(makeDraft(data, baseRevision)));
        if (localWorkspace) {
          localStorage.removeItem(DRAFT_KEY);
          localStorage.removeItem(LEGACY_DRAFT_KEY);
        }
        setPendingDraft(null);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
      } catch (e) {
        console.error("Draft save error:", e);
      }
    },
    [formData, baseRevision, draftKey, localWorkspace]
  );

  function clearDraft() {
    localStorage.removeItem(draftKey);
    if (localWorkspace) {
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    }
  }

  function restorePendingDraft() {
    if (!pendingDraft) return;
    setFormData(pendingDraft.draft.data);
    setBaseRevision(pendingDraft.draft.baseRevision);
    setPendingDraft(null);
  }

  function discardPendingDraft() {
    clearDraft();
    setPendingDraft(null);
  }

  // Same engine as workbook import: every keystroke runs the authoritative calculation path.
  const computedStore = useMemo(() => calculateStore(formData, "manual"), [formData]);

  // Section status derives from the shared required-data completeness definition.
  const sectionStatus = useMemo(() => {
    const missing = computedStore.completeness.missing;
    const clean = (prefix: string) => !missing.some((m) => m.startsWith(prefix));
    const method = String(formData.setup["Selected calcination method"] ?? "");
    return {
      setup: clean("01_Setup"),
      production: clean("03_Production_Input"),
      rawmaterial: method.includes("Method A") ? clean("04_Raw_Material_Input") && formData.rawMaterial.length > 0 : true,
      kilnfuel: clean("05_Kiln_Fuel_Input"),
      electricity: clean("06_Electricity_Input"),
      inventory: computedStore.qaqc.find((q) => q["Check ID"] === "MB-04")?.Status === "PASS",
      constants: clean("07_Constants_EF_NCV"),
      evidence: computedStore.qaqc.find((q) => q["Check ID"] === "EV-01")?.Status === "PASS",
    };
  }, [computedStore, formData]);

  function updateSetup(key: string, val: string) {
    setFormData((prev) => ({ ...prev, setup: { ...prev.setup, [key]: val } }));
  }

  function updateRow(section: RowSection, idx: number, key: string, val: unknown) {
    setFormData((prev) => {
      const list = [...prev[section]];
      const updated: SheetRow = { ...list[idx], [key]: val };
      const src = list[idx]._source as RowSource | undefined;
      if (src && src.origin !== "manual") updated._source = { origin: "manual", previous: src };

      // Selecting a preset fuel copies reference defaults into the row explicitly (visible and editable).
      if (section === "kilnFuel" && key === "Fuel Type") {
        const factor = DEFAULT_FUEL_FACTORS[String(val)];
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

  function addRow(section: Exclude<RowSection, "constants">) {
    setFormData((prev) => {
      const date = String(prev.setup["Period end"] ?? "");
      const rows: Record<typeof section, SheetRow> = {
        production: { Date: date, "Kiln Line": "", "Cement Type": prev.setup["Primary product"] ?? "", "Clinker Produced t": "", "Cement Produced t": "", "Clinker Used t": "", "Gypsum t": "", "Limestone Additive t": "", "Other Additives t": "", "Evidence ID": "", Notes: "" },
        rawMaterial: { Date: date, Material: "Raw Meal", "Quantity t": "", "CaCO3 %": "", "MgCO3 %": "", "Moisture %": "", "Calcination Conversion": "", "Evidence ID": "" },
        kilnFuel: { Date: date, "Fuel Type": "", Quantity: "", Unit: "", "NCV GJ/unit": "", "EF tCO2/TJ": "", "Oxidation Factor": "", "Biomass Fraction": "", "Evidence ID": "" },
        electricity: { Date: date, "Meter / Source": "", "Grid MWh": "", "Grid EF tCO2/MWh": "", "Self-generation MWh": "", "Self-generation EF": "", "Renewable MWh": "", "Evidence ID": "" },
        inventory: { Date: date, Material: "Clinker", "Opening Stock t": "", "Purchased t": "", "Dispatched t": "", "Closing Stock t": "", "Evidence ID": "" },
        evidence: { "Evidence ID": "", "Evidence Type": "", Description: "", "Source System": "", "Mapped Sheet": "03_Production_Input", Status: "Pending", Owner: "", Reviewer: "", Frequency: "", Notes: "" },
      };
      return { ...prev, [section]: [...prev[section], rows[section]] };
    });
  }

  function removeRow(section: Exclude<RowSection, "constants">, idx: number) {
    setFormData((prev) => ({ ...prev, [section]: prev[section].filter((_, i) => i !== idx) }));
  }

  function handleLoadSample() {
    const sample = createSampleDataset();
    setFormData(sample);
    setBaseRevision(null);
    saveDraft(sample);
  }

  function handleReset() {
    if (confirm("Reset the form? Unsaved inputs and the saved draft will be cleared.")) {
      setFormData(blankForm());
      setBaseRevision(null);
      clearDraft();
    }
  }

  function handleSubmit() {
    const finalStore = calculateStore(formData, "manual");
    clearDraft();
    resolvedFor.current = `${activeKey}|${finalStore.meta.revision}`;
    setStoreData(finalStore);
    setBaseRevision(finalStore.meta.revision);
    setSubmittedAlert(true);
    setTimeout(() => {
      router.push("/overview");
    }, 1200);
  }

  const calc = (metric: string) => computedStore.calculations[metric]?.Value;
  const qaOverall = String(calc("QA/QC Overall Status") ?? "—");
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
              Enter cement plant MRV inputs. Calculations use the same engine as workbook import; blank values are reported as missing, never treated as zero.
            </p>
          </div>

          <div className="studio-actions-bar">
            {isSaved && (
              <span className="badge badge-pass" style={{ fontSize: 11 }}>
                <Icon name="check" size={12} /> Draft Saved
              </span>
            )}
            {formData.meta.synthetic ? <span className="badge badge-fail" style={{ fontSize: 11 }}>SYNTHETIC DEMO</span> : null}
            <span className={`badge ${qaBadgeClass}`} style={{ fontSize: 11 }}>
              <QaDot status={qaOverall} /> QA/QC {qaOverall}
            </span>

            <button type="button" className="btn btn-secondary btn-sm" onClick={handleLoadSample} title="Pre-fill with fictitious synthetic demo values">
              <Icon name="play" size={13} /> Load Synthetic Demo
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => saveDraft()} title="Save draft to this browser (scoped by facility, period and dataset revision)">
              <Icon name="save" size={13} /> Save Draft
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={downloadBlankTemplate} title="Download blank Excel collection template">
              <Icon name="download" size={13} /> Blank Template (.xlsx)
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadDataPackage(computedStore)} title="Re-importable data export with provenance">
              <Icon name="file-spreadsheet" size={13} /> Export Data (.json)
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit} title="Apply dataset to the platform">
              <Icon name="check-circle" size={13} /> Submit & Apply
            </button>
          </div>
        </div>

        {/* Required-data completeness (separate from QA pass rate) */}
        <div className="studio-progress-wrap">
          <div className="studio-progress-bar">
            <div className="studio-progress-fill" style={{ width: `${computedStore.completeness.pct}%` }} />
          </div>
          <div className="studio-progress-text">
            Required data {computedStore.completeness.present} of {computedStore.completeness.required} items ({computedStore.completeness.pct}%) · QA pass rate {computedStore.qaPassPct}%
          </div>
        </div>
      </div>

      {pendingDraft && (
        <div className="card mb-lg" style={{ background: "var(--qa-warn-dim)", borderColor: "var(--qa-warn-border)" }} role="alert">
          <div className="draft-notice">
            <div style={{ fontSize: 12.5 }}>
              <strong>Saved draft not applied.</strong> {pendingDraft.reason}
              <div style={{ color: "var(--text-secondary)", marginTop: 2 }}>Draft: {describeDraft(pendingDraft.draft)}</div>
            </div>
            <div className="panel-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={discardPendingDraft}>
                Discard draft
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={restorePendingDraft}>
                Restore draft
              </button>
            </div>
          </div>
        </div>
      )}

      {submittedAlert && (
        <div className="card card-accent mb-lg" style={{ background: "var(--qa-pass-dim)", borderColor: "var(--qa-pass-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--qa-pass)" }}>
            <Icon name="check-circle" size={20} />
            <div>
              <strong>Dataset applied.</strong>
              <div style={{ fontSize: 12 }}>
                QA/QC {qaOverall} · readiness: {computedStore.readiness.status === "READY_FOR_INTERNAL_REVIEW" ? "ready for internal review" : "not ready"}. Redirecting to Overview…
              </div>
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
          { key: "inventory", label: "14 Inventory", valid: sectionStatus.inventory },
          { key: "constants", label: "07 Factors & Bounds", valid: sectionStatus.constants },
          { key: "evidence", label: "11 Evidence Register", valid: sectionStatus.evidence },
          { key: "review", label: "Review & Validate", valid: computedStore.readiness.status === "READY_FOR_INTERNAL_REVIEW" },
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
              <span className="studio-tab-badge">{tab.valid ? "✓" : "•"}</span>
            </button>
          );
        })}
      </div>

      {/* ── TAB 1: Setup & Governance ── */}
      {activeTab === "setup" && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 16 }}>
            <div className="section-title">01 Setup and Facility Parameters</div>
            <div className="section-sub">Facility identifiers, accounting boundary, and methodology selection. No method is pre-selected.</div>
          </div>

          <div className="form-grid-2">
            {(
              [
                { key: "Installation / site", label: "Installation / Site Name", required: true, type: "text", placeholder: "e.g. Plant name" },
                { key: "Country", label: "Country Jurisdiction", required: true, type: "text" },
                { key: "Reporting quarter", label: "Reporting Quarter", required: true, options: [["Q1 2025", "Q1 2025 (Jan - Mar)"], ["Q2 2025", "Q2 2025 (Apr - Jun)"], ["Q3 2025", "Q3 2025 (Jul - Sep)"], ["Q4 2025", "Q4 2025 (Oct - Dec)"], ["Annual 2025", "Full Year 2025"]] },
                { key: "Primary product", label: "Primary Cement Product", required: true, options: [["CEM I 42.5R", "CEM I 42.5R (Pure Portland)"], ["CEM II/A-L 42.5N", "CEM II/A-L 42.5N (Portland Limestone)"], ["CEM II/B-L 32.5R", "CEM II/B-L 32.5R (Composite)"], ["CEM III/A 42.5N", "CEM III/A 42.5N (Blast Furnace)"], ["CEM IV/B (P) 32.5N", "CEM IV/B (P) 32.5N (Pozzolanic)"]] },
                { key: "Period start", label: "Period Start Date", required: true, type: "date" },
                { key: "Period end", label: "Period End Date", required: true, type: "date" },
                { key: "Boundary approach", label: "Boundary Approach", options: [["Operational control", "Operational control"], ["Financial control", "Financial control"], ["Equity share", "Equity share"]] },
                { key: "Selected calcination method", label: "Selected Calcination Method", required: true, options: [["Method B - clinker output", "Method B — Clinker output × clinker EF (07 constants)"], ["Method A - raw material input", "Method A — Raw material carbonates"]] },
                { key: "Assurance status", label: "Assurance Status (free text; does not establish verification)", type: "text" },
                { key: "CKD correction applied", label: "CKD Correction Applied?", options: [["No", "No"], ["Yes", "Yes"]] },
              ] as { key: string; label: string; required?: boolean; type?: string; placeholder?: string; options?: string[][] }[]
            ).map((f) => (
              <div className="form-field" key={f.key}>
                <label>
                  {f.label} {f.required ? <span className="required">*</span> : null}
                </label>
                {f.options ? (
                  <select className="form-select" value={raw(formData.setup, f.key)} onChange={(e) => updateSetup(f.key, e.target.value)}>
                    <option value="">— select —</option>
                    {f.options.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type={f.type} className="form-input" placeholder={f.placeholder} value={raw(formData.setup, f.key)} onChange={(e) => updateSetup(f.key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 2: Production Data ── */}
      {activeTab === "production" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">03 Production Activity Data</div>
              <div className="section-sub">Clinker and cement quantities. Blank cells stay blank — they are reported as missing, never as zero.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("production")}>
              <Icon name="plus" size={13} /> Add Production Record
            </button>
          </div>
          <EntryTable
            rows={formData.production}
            computedRows={computedStore.production}
            onChange={(i, k, v) => updateRow("production", i, k, v)}
            onRemove={(i) => removeRow("production", i)}
            columns={[
              { key: "Date", label: "Date", type: "date" },
              { key: "Kiln Line", label: "Kiln Line", type: "text", minWidth: 65 },
              { key: "Cement Type", label: "Cement Type", type: "text", minWidth: 120 },
              { key: "Clinker Produced t", label: "Clinker Produced (t)", type: "number" },
              { key: "Cement Produced t", label: "Cement Produced (t)", type: "number" },
              { key: "Clinker Used t", label: "Clinker Used (t)", type: "number" },
              { key: "Gypsum t", label: "Gypsum (t)", type: "number" },
              { key: "Limestone Additive t", label: "Limestone Additive (t)", type: "number" },
              { key: "Other Additives t", label: "Other Additives (t)", type: "number" },
              { key: "_cf", label: "Clinker Factor", type: "computed", render: (c) => <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{show(c?.["Clinker Factor"], 3)}</span> },
              { key: "_qa", label: "QA", type: "computed", render: (c) => <span className={`badge ${rowStatusBadge(c?.["QA Status"])}`} style={{ fontSize: 10 }}>{String(c?.["QA Status"] ?? "—")}</span> },
              { key: "Evidence ID", label: "Evidence", type: "text", minWidth: 90 },
            ]}
          />
          <div className="kpi-mini-grid">
            {[
              ["Total Clinker Produced", calc("Clinker Produced"), "t"],
              ["Total Cement Produced", calc("Cement Produced"), "t"],
              ["Weighted Clinker Factor", calc("Clinker Factor"), "ratio"],
              ["Stockpile Delta", calc("Clinker Stockpile Delta"), "t"],
            ].map(([label, value, unit]) => (
              <div className="kpi-mini-card" key={String(label)}>
                <div className="kpi-label">{String(label)}</div>
                <div className="kpi-value">
                  {show(value)}
                  <span className="kpi-unit">{String(unit)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 3: Raw Materials (Method A) ── */}
      {activeTab === "rawmaterial" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">04 Raw Material Carbonate Input</div>
              <div className="section-sub">Required when Method A is selected. Calcination conversion must be entered explicitly (no default).</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("rawMaterial")}>
              <Icon name="plus" size={13} /> Add Raw Material Record
            </button>
          </div>
          <EntryTable
            rows={formData.rawMaterial}
            computedRows={computedStore.rawMaterial}
            onChange={(i, k, v) => updateRow("rawMaterial", i, k, v)}
            onRemove={(i) => removeRow("rawMaterial", i)}
            columns={[
              { key: "Date", label: "Date", type: "date" },
              { key: "Material", label: "Material", type: "text" },
              { key: "Quantity t", label: "Quantity (t)", type: "number" },
              { key: "CaCO3 %", label: "CaCO3 %", type: "number", step: "0.1" },
              { key: "MgCO3 %", label: "MgCO3 %", type: "number", step: "0.1" },
              { key: "Moisture %", label: "Moisture %", type: "number", step: "0.1" },
              { key: "Calcination Conversion", label: "Calcination Conv", type: "number", step: "0.01" },
              { key: "_co2", label: "Method A CO2 (t)", type: "computed", render: (c) => <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{show(c?.["Process CO2 Method A t"], 1)}</span> },
              { key: "Evidence ID", label: "Evidence", type: "text", minWidth: 90 },
            ]}
          />
          <div className="kpi-mini-grid">
            {[
              ["Method A Process CO2", calc("Process CO2 Method A")],
              ["Method B Process CO2 (Clinker EF)", calc("Process CO2 Method B")],
              ["Active Selected Process CO2", calc("Selected Process CO2")],
            ].map(([label, value]) => (
              <div className="kpi-mini-card" key={String(label)}>
                <div className="kpi-label">{String(label)}</div>
                <div className="kpi-value">
                  {show(value, 2)}
                  <span className="kpi-unit">tCO2</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 4: Kiln Fuels ── */}
      {activeTab === "kilnfuel" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">05 Kiln Fuel Combustion Activity</div>
              <div className="section-sub">Selecting a preset fuel copies reference NCV, EF, oxidation and biomass values into the row; review and replace with approved values.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("kilnFuel")}>
              <Icon name="plus" size={13} /> Add Fuel Line
            </button>
          </div>
          <EntryTable
            rows={formData.kilnFuel}
            computedRows={computedStore.kilnFuel}
            onChange={(i, k, v) => updateRow("kilnFuel", i, k, v)}
            onRemove={(i) => removeRow("kilnFuel", i)}
            columns={[
              { key: "Date", label: "Date", type: "date" },
              { key: "Fuel Type", label: "Fuel Type", type: "select", options: [...Object.keys(DEFAULT_FUEL_FACTORS), "Custom"].map((f) => ({ value: f, label: f })) },
              { key: "Quantity", label: "Quantity", type: "number" },
              { key: "Unit", label: "Unit", type: "text" },
              { key: "NCV GJ/unit", label: "NCV (GJ/unit)", type: "number", step: "0.01" },
              { key: "EF tCO2/TJ", label: "EF (tCO2/TJ)", type: "number", step: "0.1" },
              { key: "Oxidation Factor", label: "Oxidation", type: "number", step: "0.005" },
              { key: "Biomass Fraction", label: "Biomass fraction", type: "number", step: "0.05" },
              { key: "_gj", label: "Energy (GJ)", type: "computed", render: (c) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{show(c?.["Energy GJ"])}</span> },
              { key: "_tj", label: "Energy (TJ)", type: "computed", render: (c) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{show(c?.["Energy TJ"])}</span> },
              { key: "_fossil", label: "Fossil CO2 (t)", type: "computed", render: (c) => <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{show(c?.["Fossil CO2 t"], 1)}</span> },
              { key: "_bio", label: "Biogenic (t)", type: "computed", render: (c) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>{show(c?.["Biogenic CO2 Memo t"], 1)}</span> },
              { key: "Evidence ID", label: "Evidence", type: "text", minWidth: 90 },
            ]}
          />
          <div className="kpi-mini-grid">
            {[
              ["Total Fuel Energy", calc("Total Fuel Energy"), "GJ"],
              ["Fossil Combustion CO2", calc("Fuel Combustion CO2"), "tCO2"],
              ["Biogenic CO2 Memo", calc("Biogenic CO2 Memo"), "tCO2"],
              ["Thermal Substitution (TSR)", calc("Thermal Substitution Rate (TSR)"), "%"],
            ].map(([label, value, unit]) => (
              <div className="kpi-mini-card" key={String(label)}>
                <div className="kpi-label">{String(label)}</div>
                <div className="kpi-value">
                  {show(value, 2)}
                  <span className="kpi-unit">{String(unit)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TAB 5: Electricity ── */}
      {activeTab === "electricity" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">06 Purchased Electricity Activity</div>
              <div className="section-sub">Meter records and grid emission factor (entered explicitly; no default is applied).</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("electricity")}>
              <Icon name="plus" size={13} /> Add Electricity Meter Log
            </button>
          </div>
          <EntryTable
            rows={formData.electricity}
            computedRows={computedStore.electricity}
            onChange={(i, k, v) => updateRow("electricity", i, k, v)}
            onRemove={(i) => removeRow("electricity", i)}
            columns={[
              { key: "Date", label: "Date", type: "date" },
              { key: "Meter / Source", label: "Meter / Substation Tag", type: "text" },
              { key: "Grid MWh", label: "Grid MWh", type: "number" },
              { key: "Grid EF tCO2/MWh", label: "Grid EF (tCO2/MWh)", type: "number", step: "0.0001" },
              { key: "Self-generation MWh", label: "Self-generation MWh", type: "number" },
              { key: "Renewable MWh", label: "Renewable MWh", type: "number" },
              { key: "_co2", label: "Indirect CO2 (t)", type: "computed", render: (c) => <span className="badge badge-info" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{show(c?.["Grid CO2 t"], 1)}</span> },
              { key: "Evidence ID", label: "Evidence", type: "text", minWidth: 90 },
            ]}
          />
          <div className="kpi-mini-grid">
            <div className="kpi-mini-card">
              <div className="kpi-label">Total Grid Electricity</div>
              <div className="kpi-value">
                {show(calc("Grid Electricity MWh"))}
                <span className="kpi-unit">MWh</span>
              </div>
            </div>
            <div className="kpi-mini-card">
              <div className="kpi-label">Indirect Grid CO2</div>
              <div className="kpi-value">
                {show(calc("Indirect Grid CO2"), 2)}
                <span className="kpi-unit">tCO2</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 5b: Inventory Movements ── */}
      {activeTab === "inventory" && (
        <div className="card">
          <div className="panel-toolbar">
            <div>
              <div className="section-title">14 Clinker Inventory Movements</div>
              <div className="section-sub">Opening/closing stock, purchases and dispatches. Without these, stock reconciliation (MB-04) is NOT_EVALUATED.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("inventory")}>
              <Icon name="plus" size={13} /> Add Inventory Record
            </button>
          </div>
          <EntryTable
            rows={formData.inventory}
            computedRows={computedStore.inventory}
            onChange={(i, k, v) => updateRow("inventory", i, k, v)}
            onRemove={(i) => removeRow("inventory", i)}
            columns={[
              { key: "Date", label: "Date", type: "date" },
              { key: "Material", label: "Material", type: "text" },
              { key: "Opening Stock t", label: "Opening Stock (t)", type: "number" },
              { key: "Purchased t", label: "Purchased (t)", type: "number" },
              { key: "Dispatched t", label: "Dispatched (t)", type: "number" },
              { key: "Closing Stock t", label: "Closing Stock (t)", type: "number" },
              { key: "Evidence ID", label: "Evidence", type: "text", minWidth: 90 },
            ]}
          />
          {(() => {
            const mb04 = computedStore.qaqc.find((q) => q["Check ID"] === "MB-04");
            return (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <span className={`badge ${rowStatusBadge(mb04?.Status)}`}>
                  <QaDot status={String(mb04?.Status ?? "")} /> MB-04 {String(mb04?.Status ?? "—")}
                </span>{" "}
                <span style={{ color: "var(--text-secondary)" }}>{String(mb04?.Comment ?? "")}</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* ── TAB 6: Factors & Constants ── */}
      {activeTab === "constants" && (
        <div className="card">
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div className="section-title">07 Emission Factors, Constants & QA/QC Bounds</div>
            <div className="section-sub">Reference values used by the engine. Status describes review state only; it is not an approval.</div>
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
                  <th>Status</th>
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
                        aria-label={`${String(row["Constant / Factor"] || "")} value`}
                        value={raw(row, "Value")}
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
                      <span className="badge badge-info" style={{ fontSize: 10.5 }}>
                        {String(row.Status || "—")}
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
              <div className="section-sub">Links input records to document references. &quot;Mapped&quot; means linked — it is not verification.</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow("evidence")}>
              <Icon name="plus" size={13} /> Add Evidence Document
            </button>
          </div>
          <EntryTable
            rows={formData.evidence}
            computedRows={computedStore.evidence}
            onChange={(i, k, v) => updateRow("evidence", i, k, v)}
            onRemove={(i) => removeRow("evidence", i)}
            columns={[
              { key: "Evidence ID", label: "Evidence ID", type: "text", minWidth: 100 },
              { key: "Evidence Type", label: "Document Type", type: "text" },
              { key: "Description", label: "Description", type: "text" },
              { key: "Source System", label: "Source System", type: "text" },
              {
                key: "Mapped Sheet",
                label: "Mapped Sheet",
                type: "select",
                options: [
                  { value: "03_Production_Input", label: "03 Production" },
                  { value: "04_Raw_Material_Input", label: "04 Raw Materials" },
                  { value: "05_Kiln_Fuel_Input", label: "05 Kiln Fuels" },
                  { value: "06_Electricity_Input", label: "06 Electricity" },
                  { value: "14_Inventory_Movements", label: "14 Inventory" },
                ],
              },
              {
                key: "Status",
                label: "Status",
                type: "select",
                options: [
                  { value: "Pending", label: "Pending" },
                  { value: "Mapped", label: "Mapped (linked, not verified)" },
                  { value: "Missing", label: "Missing" },
                ],
              },
              { key: "Owner", label: "Owner", type: "text" },
            ]}
          />
        </div>
      )}

      {/* ── TAB 8: Review & Validate ── */}
      {activeTab === "review" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="section-header" style={{ marginBottom: 16 }}>
              <div className="section-title">Calculated Embedded Emissions Summary</div>
              <div className="section-sub">Computed by the platform engine from these inputs. &quot;—&quot; means not calculable because required inputs are missing.</div>
            </div>

            <div className="kpi-mini-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
              {[
                ["Direct Embedded CO2", "Direct Embedded CO2", "tCO2", 2],
                ["Indirect Grid CO2", "Indirect Grid CO2", "tCO2", 2],
                ["Total Embedded CO2", "Total Embedded CO2", "tCO2", 2],
                ["SEE Clinker Intensity", "SEE Clinker", "tCO2/t clinker", 4],
                ["SEE Cement (Specific Embedded)", "Specific Embedded Emissions Cement", "tCO2/t cement", 4],
                ["Specific Heat Consumption (SHC)", "Specific Heat Consumption", "GJ/t clinker", 3],
              ].map(([label, metric, unit, dp]) => (
                <div className="kpi-mini-card" key={String(label)}>
                  <div className="kpi-label">{String(label)}</div>
                  <div className="kpi-value">
                    {show(calc(String(metric)), Number(dp))}
                    <span className="kpi-unit">{String(unit)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="panel-toolbar">
              <div>
                <div className="section-title">Readiness & Required Data</div>
                <div className="section-sub">Completeness of required inputs is reported separately from the QA pass rate.</div>
              </div>
              <span className={`badge ${computedStore.readiness.status === "READY_FOR_INTERNAL_REVIEW" ? "badge-pass" : "badge-warn"}`}>
                {computedStore.readiness.status === "READY_FOR_INTERNAL_REVIEW" ? "Ready for internal review" : "Not ready"}
              </span>
            </div>
            <ul style={{ fontSize: 12, margin: "0 0 8px 18px" }}>
              {computedStore.readiness.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            {computedStore.completeness.missing.length > 0 ? (
              <details style={{ fontSize: 12 }}>
                <summary>Missing required items ({computedStore.completeness.missing.length})</summary>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {computedStore.completeness.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {computedStore.inputIssues.length > 0 ? (
              <details style={{ fontSize: 12, marginTop: 6 }}>
                <summary>Rejected input values ({computedStore.inputIssues.length})</summary>
                <ul style={{ margin: "6px 0 0 18px" }}>
                  {computedStore.inputIssues.map((i, k) => (
                    <li key={k}>
                      {i.section} row {String(i.row)} · {i.field}: {i.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <div className="card">
            <div className="panel-toolbar">
              <div>
                <div className="section-title">Automated QA/QC Check Register</div>
                <div className="section-sub">NOT_EVALUATED means required supporting inputs are missing — it is never counted as a pass.</div>
              </div>
              <span className={`badge ${qaBadgeClass}`}>
                <QaDot status={qaOverall} /> QA Status: {qaOverall}
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
                    <th>Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {computedStore.qaqc.map((q, idx) => {
                    const status = String(q.Status ?? "");
                    return (
                      <tr key={idx}>
                        <td style={{ fontWeight: 700, fontFamily: "var(--font-mono)" }}>{String(q["Check ID"] || "")}</td>
                        <td>{String(q.Category || "")}</td>
                        <td>{String(q["Check Name"] || "")}</td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>{String(q.Rule || "")}</td>
                        <td style={{ fontFamily: "var(--font-mono)" }}>{String(q.Result ?? "—")}</td>
                        <td>
                          <span className={`badge ${rowStatusBadge(status)}`} style={{ fontSize: 10.5 }}>
                            <QaDot status={status} /> {status}
                          </span>
                        </td>
                        <td style={{ fontSize: 11, color: "var(--text-secondary)" }}>{String(q.Comment || "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ background: "#F8FAFC", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Apply this dataset?</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  Submitting loads these inputs into the platform. Applying does not approve or verify the dataset.
                </div>
              </div>

              <div className="panel-actions">
                <button type="button" className="btn btn-secondary" onClick={handleReset}>
                  Reset Form
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => downloadExcel(computedStore)}>
                  <Icon name="download" size={14} /> Report (.xlsx)
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
