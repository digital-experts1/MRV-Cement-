import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import { buildDataPackage, dataPackageFilename } from "./dataPackage";
import { INVENTORY_HEADERS, INVENTORY_SHEET, PRESENTATION_MARKER_SHEET } from "./parser";
import { buildReportContent } from "./reportContent";
import { SYNTHETIC_NOTICE } from "./sampleData";
import type { Store } from "./types";

function fmtValue(val: unknown): string {
  if (val === null || val === undefined || val === "") return "not calculated";
  return typeof val === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(val) : String(val);
}

function statusColor(status: string): [number, number, number] {
  if (status === "PASS") return [22, 163, 74];
  if (status === "FAIL") return [220, 38, 38];
  return [217, 119, 6];
}

export async function downloadPDF(store: Store): Promise<void> {
  if (!store._valid) {
    alert("Please load a valid dataset first.");
    return;
  }

  const s = store;
  const c = buildReportContent(s);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  const TW = W - M * 2;
  let y = 0;

  function syntheticBanner() {
    if (!c.banner) return;
    doc.setFillColor(254, 226, 226);
    doc.rect(0, 287, W, 10, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(185, 28, 28);
    doc.text(c.banner, W / 2, 293, { align: "center", maxWidth: W - 10 });
  }

  function applyPageHeader(title?: string) {
    doc.setFillColor(22, 119, 255);
    doc.rect(0, 0, W, 4, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(c.headerLine, M, 11);
    if (title) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(51, 78, 104);
      doc.text(title, W - M, 11, { align: "right" });
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(M, 14, W - M, 14);
    syntheticBanner();
  }

  function checkPage(needed: number, title: string) {
    if (y + needed > 275) {
      doc.addPage();
      applyPageHeader(title);
      y = 22;
    }
  }

  // ── Cover ──
  doc.setFillColor(15, 39, 71);
  doc.rect(0, 0, W, 70, "F");
  doc.setFillColor(22, 119, 255);
  doc.rect(0, 0, W, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text(c.title, M, 28);
  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(190, 215, 255);
  doc.text(c.subtitle, M, 38);
  if (c.banner) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(252, 165, 165);
    doc.text("SYNTHETIC DEMO DATA — NOT FOR REPORTING", M, 52);
  }

  y = 78;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(M, y, TW, 22 + c.coverLines.length * 7.2, 3, 3, "FD");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Reporting & Operational Parameters", M + 8, y + 10);
  doc.line(M + 8, y + 14, M + TW - 8, y + 14);

  let cy = y + 21;
  c.coverLines.forEach(([k, v]) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 78, 104);
    doc.text(k, M + 8, cy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(23, 43, 77);
    doc.text(String(v), M + 68, cy, { maxWidth: TW - 76 });
    cy += 7.2;
  });

  y = cy + 8;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(M, y, TW, 30, 2, 2, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text(c.statementTitle, M + 6, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(c.statement, M + 6, y + 14, { maxWidth: TW - 12 });
  syntheticBanner();

  // ── KPI page ──
  doc.addPage();
  applyPageHeader("KPI Summary");
  y = 24;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Emissions & Production Summary", M, y);
  y += 6;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Computed by the platform calculation engine from the supplied inputs. Missing inputs show as 'not calculated'.", M, y);
  y += 8;

  const kpiRows: [string, unknown, string][] = [
    ["Clinker Production", s.calculations["Clinker Produced"]?.Value, "t"],
    ["Cement Production", s.calculations["Cement Produced"]?.Value, "t"],
    ["Clinker Factor", s.calculations["Clinker Factor"]?.Value, "ratio"],
    ["Process CO2 (Selected)", s.calculations["Selected Process CO2"]?.Value, "tCO2"],
    ["Fuel Combustion CO2", s.calculations["Fuel Combustion CO2"]?.Value, "tCO2"],
    ["Biogenic CO2 Memo", s.calculations["Biogenic CO2 Memo"]?.Value, "tCO2"],
    ["Direct Embedded CO2", s.calculations["Direct Embedded CO2"]?.Value, "tCO2"],
    ["Grid Electricity Consumed", s.calculations["Grid Electricity MWh"]?.Value, "MWh"],
    ["Indirect Grid CO2", s.calculations["Indirect Grid CO2"]?.Value, "tCO2"],
    ["Total Embedded CO2", s.calculations["Total Embedded CO2"]?.Value, "tCO2"],
    ["SEE Clinker", s.calculations["SEE Clinker"]?.Value, "tCO2/t clinker"],
    ["SEE Cement", s.calculations["Specific Embedded Emissions Cement"]?.Value, "tCO2/t cement"],
    ["Specific Heat Consumption", s.calculations["Specific Heat Consumption"]?.Value, "GJ/t clinker"],
    ["Thermal Substitution Rate", s.calculations["Thermal Substitution Rate (TSR)"]?.Value, "%"],
  ];

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, TW, 7, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 78, 104);
  doc.text("METRIC / INDICATOR", M + 4, y + 5);
  doc.text("COMPUTED VALUE", M + TW - 60, y + 5);
  doc.text("UNIT", M + TW - 24, y + 5);
  y += 7;

  kpiRows.forEach(([name, val, unit], i) => {
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, TW, 7, "F");
    }
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(23, 43, 77);
    doc.text(String(name), M + 4, y + 5);
    doc.setFont("helvetica", "bold");
    doc.text(fmtValue(val), M + TW - 60, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(String(unit), M + TW - 24, y + 5);
    y += 7;
  });

  // ── QA page ──
  doc.addPage();
  applyPageHeader("QA/QC Check Results");
  y = 24;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Automated QA/QC Check Register", M, y);
  y += 6;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(c.qaSummaryLine, M, y, { maxWidth: TW });
  y += 8;

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, TW, 7, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 78, 104);
  doc.text("ID", M + 2, y + 5);
  doc.text("CATEGORY", M + 18, y + 5);
  doc.text("CHECK NAME", M + 52, y + 5);
  doc.text("RESULT", M + TW - 58, y + 5);
  doc.text("STATUS", M + TW - 26, y + 5);
  y += 7;

  s.qaqc.forEach((r, i) => {
    checkPage(8, "QA/QC Check Results");
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, TW, 7, "F");
    }
    const status = String(r.Status ?? "");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 119, 255);
    doc.text(String(r["Check ID"] || ""), M + 2, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(String(r.Category || "").substring(0, 16), M + 18, y + 5);
    doc.setTextColor(23, 43, 77);
    doc.text(String(r["Check Name"] || "").substring(0, 34), M + 52, y + 5);
    doc.setTextColor(100, 116, 139);
    doc.text(String(r.Result ?? "").substring(0, 18), M + TW - 58, y + 5);
    doc.setTextColor(...statusColor(status));
    doc.setFont("helvetica", "bold");
    doc.text(status, M + TW - 26, y + 5);
    y += 7;
  });

  // ── Evidence page ──
  doc.addPage();
  applyPageHeader("Evidence Register & References");
  y = 24;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Evidence Register & Regulatory References", M, y);
  y += 6;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(c.evidenceSummaryLine, M, y, { maxWidth: TW });
  y += 8;

  s.evidence.forEach((r, i) => {
    checkPage(8, "Evidence Register & References");
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, TW, 7, "F");
    }
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 119, 255);
    doc.text(String(r["Evidence ID"] || "").substring(0, 24), M + 2, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(23, 43, 77);
    doc.text(String(r.Description || "").substring(0, 56), M + 50, y + 5);
    doc.setTextColor(100, 116, 139);
    doc.text(String(r.Status || ""), M + TW - 18, y + 5);
    y += 7;
  });

  y += 8;
  checkPage(30, "Evidence Register & References");
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Reference Standards (for context only)", M, y);
  y += 7;
  s.regulatory.forEach((r) => {
    checkPage(14, "Evidence Register & References");
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 119, 255);
    doc.text(String(r.Reference || "").substring(0, 60), M, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(String(r["Workbook application"] || "").substring(0, 95), M, y, { maxWidth: TW });
    y += 6;
  });

  doc.save(c.filename);
}

const PRESENTATION_NOTE = "Presentation export of computed results — NOT re-importable. Use 'Export Data (.json)' for a re-importable data export.";

/** Presentation workbook (computed results). Marked so the importer rejects it explicitly. */
export function buildReportWorkbook(store: Store): XLSX.WorkBook {
  const s = store;
  const wb = XLSX.utils.book_new();
  const banner = s.meta.synthetic ? SYNTHETIC_NOTICE : "TRACE FORCE MRV — presentation export";

  function addSheet(name: string, rows: unknown[][]) {
    const ws = XLSX.utils.aoa_to_sheet([[banner], [PRESENTATION_NOTE], ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const pick = (rows: Record<string, unknown>[], cols: string[]) => [cols, ...rows.map((r) => cols.map((k) => r[k] ?? null))];

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Field", "Value"],
      ["Export type", "PRESENTATION_REPORT"],
      ["Re-importable", "NO"],
      ["Synthetic demo data", s.meta.synthetic ? "YES" : "NO"],
      ["Data origin", s.meta.origin],
      ["Dataset revision", s.meta.revision],
      ["Report status", "DRAFT — not approved"],
      ["Calculation run", s.meta.run ? `${s.meta.run.id}${s.meta.run.stale ? " (STALE)" : ""}` : "Not a stored calculation run"],
      ["Run input SHA-256", s.meta.run?.input_sha256 ?? null],
      ["Run results SHA-256", s.meta.run?.results_sha256 ?? null],
      ["Engine version", s.meta.run?.engine_version ?? null],
      ["External verification", "None recorded — not externally verified"],
      ["Note", PRESENTATION_NOTE],
    ]),
    PRESENTATION_MARKER_SHEET,
  );
  addSheet("01_Setup", pick(s.setupRows.length ? s.setupRows : Object.entries(s.setup).map(([Parameter, Value]) => ({ Parameter, Value })), ["Parameter", "Value", "Unit", "Notes"]));
  addSheet("03_Production", pick(s.production, ["Date", "Kiln Line", "Cement Type", "Clinker Produced t", "Cement Produced t", "Clinker Used t", "Gypsum t", "Limestone Additive t", "Other Additives t", "Clinker Factor", "Evidence ID", "QA Status"]));
  addSheet("04_Raw_Material", pick(s.rawMaterial, ["Date", "Material", "Quantity t", "CaCO3 %", "MgCO3 %", "Moisture %", "Calcination Conversion", "CaCO3 CO2 t", "MgCO3 CO2 t", "Process CO2 Method A t", "Evidence ID", "QA Status"]));
  addSheet("05_Kiln_Fuel", pick(s.kilnFuel, ["Date", "Fuel Type", "Quantity", "Unit", "NCV GJ/unit", "EF tCO2/TJ", "Oxidation Factor", "Biomass Fraction", "Fossil Fraction", "Energy GJ", "Energy TJ", "Fossil CO2 t", "Biogenic CO2 Memo t", "Evidence ID", "QA Status"]));
  addSheet("06_Electricity", pick(s.electricity, ["Date", "Meter / Source", "Grid MWh", "Grid EF tCO2/MWh", "Grid CO2 t", "Self-generation MWh", "Self-generation EF", "Self-generation CO2 t", "Renewable MWh", "Evidence ID", "QA Status"]));
  addSheet("14_Inventory", pick(s.inventory, INVENTORY_HEADERS));
  addSheet("07_Constants", pick(s.constants, ["Constant / Factor", "Value", "Unit", "Source / rationale", "Used in", "Status"]));
  addSheet("08_Calculations", pick(s.calcRows, ["Metric", "Formula / Link", "Value", "Unit", "Governance note"]));
  addSheet("09_QAQC", pick(s.qaqc, ["Check ID", "Category", "Check Name", "Rule", "Result", "Status", "Severity", "Owner", "Comment"]));
  addSheet("10_Report_Outputs", pick(s.reportOutputs, ["Output Field", "Value", "Unit", "Source", "Report Label", "Governance Position"]));
  addSheet("11_Evidence", pick(s.evidence, ["Evidence ID", "Evidence Type", "Description", "Source System", "Mapped Sheet", "Status", "Owner", "Reviewer"]));
  addSheet("Comparison_Assertions", pick(s.assertions as unknown as Record<string, unknown>[], ["sheet", "field", "workbookValue", "computedValue", "outcome", "note"]));
  return wb;
}

export function downloadExcel(store: Store): void {
  if (!store._valid) {
    alert("Please load a valid dataset first.");
    return;
  }
  const quarter = String(store.setup["Reporting quarter"] || "period").replace(/\s/g, "_");
  XLSX.writeFile(buildReportWorkbook(store), `${store.meta.synthetic ? "SYNTHETIC_DEMO_" : ""}TRACE_FORCE_MRV_Report_${quarter}.xlsx`);
}

/** Re-importable data export (JSON data package). */
export function downloadDataPackage(store: Store): void {
  if (!store._valid) {
    alert("Please load a valid dataset first.");
    return;
  }
  const blob = new Blob([JSON.stringify(buildDataPackage(store), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = dataPackageFilename(store);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Blank collection template. Contains no fabricated PASS/Mapped statuses or calculated values. */
export function buildBlankTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  function addSheet(name: string, rows: (string | number | null | undefined)[][]) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  const computedNote = "Computed by the platform on import. Any values entered here are used for comparison only.";

  addSheet("00_README_Control", [
    ["TRACE FORCE MRV — Cement QA/QC V28 Collection Workbook Template"],
    ["Blank collection template. Contains no plant data."],
    ["Control", "Value", "Governance note"],
    ["Workbook Version", "v0.2", "TRACE FORCE MRV collection schema"],
    ["Status", "BLANK TEMPLATE", "Not yet populated"],
    ["Sector", "Cement / Clinker", "Operational boundary"],
    ["Important control", "Missing values are never converted to zero", "Blank required cells block readiness"],
  ]);
  addSheet("01_Setup", [
    ["Setup and Reporting Control"],
    ["Facility parameters, accounting period and methodology selection."],
    ["Parameter", "Value", "Unit", "Required?", "Notes", "Governance owner"],
    ["Workbook mode", "Cement_QAQC_V28", null, "Yes", "MRV mode lock", "EgyTrace"],
    ["Installation / site", "", null, "Yes", "Enter plant name", "Plant"],
    ["Country", "", null, "Yes", "Jurisdiction", "Plant"],
    ["Reporting quarter", "", null, "Yes", "e.g. Q1 2025", "Sustainability"],
    ["Period start", "", "date", "Yes", "Inclusive start date (YYYY-MM-DD)", "Sustainability"],
    ["Period end", "", "date", "Yes", "Inclusive end date (YYYY-MM-DD)", "Sustainability"],
    ["Primary product", "", null, "Yes", "Product type", "Production"],
    ["Boundary approach", "", null, "Yes", "Accounting boundary", "Sustainability"],
    ["Selected calcination method", "", null, "Yes", "Method A - raw material input / Method B - clinker output", "Sustainability"],
    ["Assurance status", "Not externally verified", null, "Yes", "External verification is recorded separately", "Sustainability"],
    ["Submission status", "Draft", null, "Yes", "Submission status", "Sustainability"],
    ["CKD correction applied", "", null, "Yes", "Cement kiln dust correction", "Sustainability"],
  ]);
  addSheet("02_DCS_Boundary_Map", [
    ["DCS / ERP / Lab Boundary Map"],
    ["Source systems mapping to MRV fields."],
    ["Boundary Area", "Source System", "DCS/ERP/Lab Tag", "MRV Field", "Unit", "Frequency", "Evidence Required", "Calculation Use", "Mapped Status", "Owner", "QA/QC Rule"],
    ["Production", "", "", "Clinker Produced", "t", "", "Weighbridge log", "Production_Input", "Not mapped", "", "No negative"],
    ["Production", "", "", "Cement Produced", "t", "", "Dispatch report", "Production_Input", "Not mapped", "", "Cement >= clinker used"],
    ["Fuel", "", "", "Kiln Fuel Feed", "t", "", "Weigh feeder ticket", "Kiln_Fuel_Input", "Not mapped", "", "Qty >= 0"],
    ["Electricity", "", "", "Purchased Grid Electricity", "MWh", "", "Utility invoice", "Electricity_Input", "Not mapped", "", "MWh >= 0"],
  ]);
  addSheet("03_Production_Input", [
    ["Production Activity Data"],
    ["Enter numbers as numeric cells. Leave unknown values blank (blank ≠ zero)."],
    ["Date", "Quarter", "Kiln Line", "Cement Type", "Clinker Produced t", "Cement Produced t", "Clinker Used t", "Gypsum t", "Limestone Additive t", "Other Additives t", "Clinker Factor", "Evidence ID", "QA Status", "Notes"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  addSheet("04_Raw_Material_Input", [
    ["Raw Material Carbonate Data"],
    ["Required when Method A is selected."],
    ["Date", "Material", "Quantity t", "CaCO3 %", "MgCO3 %", "Moisture %", "Calcination Conversion", "CaCO3 CO2 t", "MgCO3 CO2 t", "Process CO2 Method A t", "Evidence ID", "QA Status"],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  addSheet("05_Kiln_Fuel_Input", [
    ["Kiln Fuel Combustion Data"],
    ["Enter plant-specific or approved NCV/EF values; defaults are listed in 07 for reference only."],
    ["Date", "Fuel Type", "Quantity", "Unit", "NCV GJ/unit", "EF tCO2/TJ", "Oxidation Factor", "Biomass Fraction", "Fossil Fraction", "Energy GJ", "Energy TJ", "Fossil CO2 t", "Biogenic CO2 Memo t", "Evidence ID", "QA Status"],
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ]);
  addSheet("06_Electricity_Input", [
    ["Electricity Consumption Data"],
    ["Grid purchases and on-site generation activity data."],
    ["Date", "Meter / Source", "Grid MWh", "Grid EF tCO2/MWh", "Grid CO2 t", "Self-generation MWh", "Self-generation EF", "Self-generation CO2 t", "Renewable MWh", "Evidence ID", "QA Status"],
    ["", "", "", "", "", "", "", "", "", "", ""],
  ]);
  addSheet("07_Constants_EF_NCV", [
    ["Factors and Constants Library"],
    ["Reference defaults — review and replace with approved values. Status is not an approval."],
    ["Constant / Factor", "Value", "Unit", "Source / rationale", "Used in", "Change control", "Status", "Source URL"],
    ["Selected clinker process EF", 0.5325, "tCO2/t clinker", "IPCC default for 65% CaO", "08_Calculations", "Controlled", "Default – review required", ""],
    ["CaCO3 molar mass ratio", 0.4397, "tCO2/t CaCO3", "Stoichiometric 44.01/100.09", "04_Raw_Material_Input", "Fixed chemistry", "Fixed chemistry", ""],
    ["MgCO3 molar mass ratio", 0.522, "tCO2/t MgCO3", "Stoichiometric 44.01/84.31", "04_Raw_Material_Input", "Fixed chemistry", "Fixed chemistry", ""],
    [],
    ["Fuel Type", "Default NCV", "NCV Unit", "Default EF", "EF Unit", "Default Ox.", "Default Biomass %", "Notes"],
    ["Petcoke", 32.5, "GJ/t", 97.5, "tCO2/TJ", 0.99, 0, "Reference default"],
    ["Coal", 25.8, "GJ/t", 94.6, "tCO2/TJ", 0.99, 0, "Reference default"],
    ["RDF", 17.0, "GJ/t", 85.0, "tCO2/TJ", 0.98, 0.5, "Reference default"],
    ["Tyre Chips", 31.4, "GJ/t", 85.0, "tCO2/TJ", 0.98, 0.27, "Reference default"],
    ["Natural Gas", 0.048, "GJ/Nm3", 56.1, "tCO2/TJ", 0.995, 0, "Reference default"],
    ["Diesel", 43.0, "GJ/t", 74.1, "tCO2/TJ", 0.99, 0, "Reference default"],
  ]);
  addSheet("08_Calculations", [
    ["Emissions Calculations Chain"],
    [computedNote],
    ["Metric", "Formula / Link", "Value", "Unit", "Governance note", "QA Source"],
  ]);
  addSheet("09_QAQC_Checks", [
    ["QA/QC Check Register"],
    [computedNote],
    ["Check ID", "Category", "Check Name", "Rule", "Result", "Status", "Severity", "Owner"],
  ]);
  addSheet("10_Report_Outputs", [
    ["Report Outputs"],
    [computedNote],
    ["Output Field", "Value", "Unit", "Source", "Report Label", "Governance Position", "Mapped to Cement UI", "Notes"],
  ]);
  addSheet("11_Evidence_Register", [
    ["Evidence Document Register"],
    ["Set Status to Mapped only when the document reference is linked. Mapping is not verification."],
    ["Evidence ID", "Evidence Type", "Description", "Source System", "Mapped Sheet", "Status", "Owner", "Reviewer", "Frequency", "Notes"],
    ["", "", "", "", "", "Pending", "", "", "", ""],
  ]);
  addSheet("12_Regulatory_Refs", [
    ["Regulatory Reference Library"],
    ["References for context only."],
    ["Reference", "Workbook application", "Official source URL", "Page / section pointer", "Applied sheets", "Notes", "Status", "Last checked"],
    ["CBAM Regulation (EU) 2023/956", "Legal basis for CBAM embedded emissions reporting", "https://taxation-customs.ec.europa.eu/", "Regulation (EU) 2023/956", "All sheets", "Reference", "Reference", ""],
    ["ISO 14064-1:2018", "GHG quantification boundaries", "https://www.iso.org/standard/66453.html", "Section 5", "00, 01, 08", "Reference", "Reference", ""],
  ]);
  addSheet("13_Dashboard", [
    ["Cement MRV Summary"],
    [computedNote],
    ["Metric", "Value", "Unit", "Governance position"],
  ]);
  addSheet(INVENTORY_SHEET, [
    ["Clinker Inventory Movements"],
    ["Required for stock reconciliation (MB-04). Without it MB-04 is NOT_EVALUATED."],
    INVENTORY_HEADERS,
    ["", "Clinker", "", "", "", "", ""],
  ]);
  return wb;
}

export function downloadBlankTemplate(): void {
  try {
    XLSX.writeFile(buildBlankTemplateWorkbook(), "TRACE_FORCE_MRV_Cement_QAQC_V28_Blank_Template.xlsx");
  } catch (e) {
    console.error("Blank template export error:", e);
    alert("Failed to generate template: " + (e instanceof Error ? e.message : String(e)));
  }
}
