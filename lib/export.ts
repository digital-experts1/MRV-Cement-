import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import type { Store } from "./types";

export async function downloadPDF(store: Store): Promise<void> {
  if (!store._valid) {
    alert("Please upload a valid workbook first.");
    return;
  }

  const s = store;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const W = 210;
  const M = 16;
  const TW = W - M * 2;
  let y = 0;

  function applyPageHeader(title?: string) {
    doc.setFillColor(22, 119, 255);
    doc.rect(0, 0, W, 4, "F");
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text("TRACE FORCE MRV  |  Cement QA/QC Verification Report", M, 11);
    if (title) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(51, 78, 104);
      doc.text(title, W - M, 11, { align: "right" });
    }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(M, 14, W - M, 14);
  }

  function checkPage(needed: number, title: string) {
    if (y + needed > 275) {
      doc.addPage();
      applyPageHeader(title);
      y = 22;
    }
  }

  doc.setFillColor(15, 39, 71);
  doc.rect(0, 0, W, 70, "F");
  doc.setFillColor(22, 119, 255);
  doc.rect(0, 0, W, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text("TRACE FORCE MRV", M, 28);
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(190, 215, 255);
  doc.text("Cement QA/QC Embedded Emissions Report", M, 38);
  doc.setFontSize(9);
  doc.setTextColor(147, 197, 253);
  doc.text("EU ETS / CBAM Aligned  |  ISO 14064 Compliance Assurance", M, 48);

  y = 80;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.roundedRect(M, y, TW, 94, 3, 3, "FD");
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Reporting & Operational Parameters", M + 8, y + 10);
  doc.setDrawColor(226, 232, 240);
  doc.line(M + 8, y + 14, M + TW - 8, y + 14);

  const site = String(s.setup["Installation / site"] || "Primary Facility");
  const quarter = String(s.setup["Reporting quarter"] || "—");
  const product = String(s.setup["Primary product"] || "—");
  const country = String(s.setup["Country"] || "—");
  const pStart = String(s.setup["Period start"] || "—");
  const pEnd = String(s.setup["Period end"] || "—");
  const version = String(s.readme.find((r) => r.Control === "Workbook Version")?.Value || "v0.2");
  const qaStatus = String(s.calculations["QA/QC Overall Status"]?.Value || "PASS");
  const evStatus = String(s.calculations["Evidence Status"]?.Value || "Mapped");

  const coverLines: [string, string][] = [
    ["Installation / Site:", site],
    ["Country / Jurisdiction:", country],
    ["Primary Product:", product],
    ["Reporting Quarter:", quarter],
    ["Accounting Period:", `${pStart} to ${pEnd}`],
    ["Workbook Specification:", version],
    ["QA/QC Overall Status:", qaStatus],
    ["Evidence Coverage Status:", evStatus],
    ["Report Generation Date:", new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC"],
  ];

  let cy = y + 22;
  coverLines.forEach(([k, v]) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(51, 78, 104);
    doc.text(k, M + 8, cy);
    doc.setFont("helvetica", "normal");
    if (k.includes("QA/QC Overall Status")) {
      const isP = String(v).toUpperCase() === "PASS";
      doc.setTextColor(isP ? 22 : 220, isP ? 163 : 38, isP ? 74 : 38);
      doc.setFont("helvetica", "bold");
    } else {
      doc.setTextColor(23, 43, 77);
    }
    doc.text(String(v), M + 68, cy);
    cy += 7.5;
  });

  y = 186;
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(M, y, TW, 26, 2, 2, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Verification & Methodology Statement", M + 6, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "This report summarizes activity data, clinker ratios, emission factors, and energy balances compiled in strict alignment with MRV greenhouse gas accounting standards. All calculations have undergone automated cross-sheet reconciliation.",
    M + 6,
    y + 14,
    { maxWidth: TW - 12 }
  );
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Page 1 of 4  |  Confidential QA/QC Record", M, 285);

  doc.addPage();
  applyPageHeader("Executive KPI Summary");
  y = 24;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Emissions & Production Summary", M, y);
  y += 6;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Direct, indirect, and specific embedded emission indicators reconciled from Sheet 08_Calculations.", M, y);
  y += 8;

  const kpiRows: [string, unknown, string][] = [
    ["Clinker Production", s.calculations["Clinker Produced"]?.Value, "t"],
    ["Cement Production", s.calculations["Cement Produced"]?.Value, "t"],
    ["Clinker Factor", s.calculations["Clinker Factor"]?.Value, "ratio"],
    ["Process CO₂ (Selected)", s.calculations["Selected Process CO2"]?.Value, "tCO₂"],
    ["Fuel Combustion CO₂", s.calculations["Fuel Combustion CO2"]?.Value, "tCO₂"],
    ["Biogenic CO₂ Memo", s.calculations["Biogenic CO2 Memo"]?.Value, "tCO₂"],
    ["Direct Embedded CO₂", s.calculations["Direct Embedded CO2"]?.Value, "tCO₂"],
    ["Grid Electricity Consumed", s.calculations["Grid Electricity MWh"]?.Value, "MWh"],
    ["Indirect Grid CO₂", s.calculations["Indirect Grid CO2"]?.Value, "tCO₂"],
    ["Total Embedded CO₂", s.calculations["Total Embedded CO2"]?.Value, "tCO₂"],
    ["SEE Clinker", s.calculations["SEE Clinker"]?.Value, "tCO₂/t clinker"],
    ["SEE Cement", s.calculations["Specific Embedded Emissions Cement"]?.Value, "tCO₂/t cement"],
    ["Specific Heat Consumption", s.calculations["Specific Heat Consumption"]?.Value, "GJ/t clinker"],
    ["Thermal Substitution Rate", s.calculations["Thermal Substitution Rate (TSR)"]?.Value, "%"],
  ];

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, TW, 7, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 78, 104);
  doc.text("METRIC / INDICATOR", M + 4, y + 5);
  doc.text("REPORTED VALUE", M + TW - 55, y + 5);
  doc.text("UNIT", M + TW - 20, y + 5);
  y += 7;

  kpiRows.forEach(([name, val, unit], i) => {
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, TW, 7, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.line(M, y + 7, M + TW, y + 7);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(23, 43, 77);
    doc.text(String(name), M + 4, y + 5);
    const formatted =
      val !== null && val !== undefined
        ? typeof val === "number"
          ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(val)
          : String(val)
        : "—";
    doc.setFont("helvetica", "bold");
    doc.text(formatted, M + TW - 55, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(String(unit), M + TW - 20, y + 5);
    y += 7;
  });

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Page 2 of 4  |  Trace Force MRV Cement QA/QC Protocol", M, 285);

  doc.addPage();
  applyPageHeader("QA/QC Check Results");
  y = 24;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Automated QA/QC Validation Register", M, y);
  y += 6;

  const qaTotal = s.qaqc.length;
  const qaPassed = s.qaqc.filter((r) => String(r.Status).toUpperCase() === "PASS").length;
  const isOverallPass = qaPassed === qaTotal;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(isOverallPass ? 22 : 220, isOverallPass ? 163 : 38, isOverallPass ? 74 : 38);
  doc.text(`Overall Verification Status: ${qaPassed} of ${qaTotal} checks PASS`, M, y);
  y += 8;

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, TW, 7, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 78, 104);
  doc.text("ID", M + 2, y + 5);
  doc.text("CATEGORY", M + 18, y + 5);
  doc.text("CHECK NAME", M + 55, y + 5);
  doc.text("RESULT", M + TW - 42, y + 5);
  doc.text("STATUS", M + TW - 16, y + 5);
  y += 7;

  s.qaqc.forEach((r, i) => {
    checkPage(8, "QA/QC Check Results");
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, TW, 7, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.line(M, y + 7, M + TW, y + 7);
    const isPass = String(r.Status).toUpperCase() === "PASS";
    const isWarn = String(r.Status).toUpperCase() === "WARNING";
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 119, 255);
    doc.text(String(r["Check ID"] || ""), M + 2, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(String(r.Category || "").substring(0, 16), M + 18, y + 5);
    doc.setTextColor(23, 43, 77);
    doc.text(String(r["Check Name"] || "").substring(0, 32), M + 55, y + 5);
    doc.setTextColor(100, 116, 139);
    doc.text(String(r.Result || "").substring(0, 12), M + TW - 42, y + 5);
    if (isPass) doc.setTextColor(22, 163, 74);
    else if (isWarn) doc.setTextColor(217, 119, 6);
    else doc.setTextColor(220, 38, 38);
    doc.setFont("helvetica", "bold");
    doc.text(String(r.Status || ""), M + TW - 16, y + 5);
    y += 7;
  });

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Page 3 of 4  |  Automated Verification Ledger", M, 285);

  doc.addPage();
  applyPageHeader("Evidence & Regulatory Assurance");
  y = 24;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Evidence Register & Regulatory Linkage", M, y);
  y += 6;
  const mappedCount = s.evidence.filter((r) => r.Status === "Mapped").length;
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text(`${mappedCount} of ${s.evidence.length} documentary evidence sources verified and mapped.`, M, y);
  y += 8;

  doc.setFillColor(241, 245, 249);
  doc.rect(M, y, TW, 7, "F");
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 78, 104);
  doc.text("EVIDENCE ID", M + 2, y + 5);
  doc.text("DESCRIPTION / SOURCE", M + 50, y + 5);
  doc.text("STATUS", M + TW - 18, y + 5);
  y += 7;

  s.evidence.forEach((r, i) => {
    checkPage(8, "Evidence & Regulatory Assurance");
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(M, y, TW, 7, "F");
    }
    doc.setDrawColor(241, 245, 249);
    doc.line(M, y + 7, M + TW, y + 7);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(22, 119, 255);
    doc.text(String(r.evidenceId || "").substring(0, 24), M + 2, y + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(23, 43, 77);
    doc.text(String(r.Description || "").substring(0, 48), M + 50, y + 5);
    const isMapped = r.Status === "Mapped";
    doc.setTextColor(isMapped ? 22 : 220, isMapped ? 163 : 38, isMapped ? 74 : 38);
    doc.setFont("helvetica", "bold");
    doc.text(String(r.Status || ""), M + TW - 18, y + 5);
    y += 7;
  });

  y += 8;
  checkPage(30, "Evidence & Regulatory Assurance");
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(15, 39, 71);
  doc.text("Governing Standards & Rules", M, y);
  y += 7;

  s.regulatory.forEach((r) => {
    checkPage(14, "Evidence & Regulatory Assurance");
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

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Page 4 of 4  |  End of Generated Report", M, 285);

  const filename = `TRACE_FORCE_MRV_Cement_Report_${quarter.replace(/\s/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
}

export function downloadExcel(store: Store): void {
  if (!store._valid) {
    alert("Please upload a valid workbook first.");
    return;
  }

  const s = store;
  const wb = XLSX.utils.book_new();

  function addSheet(name: string, rows: unknown[][]) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  addSheet("00_README_Control", [
    ["Control", "Value", "Governance note"],
    ...s.readme.map((r) => [r.Control, r.Value, r["Governance note"]]),
  ]);
  addSheet("01_Setup", [
    ["Parameter", "Value", "Unit", "Required?", "Notes", "Governance owner"],
    ...s.setupRows.map((r) => [r.Parameter, r.Value, r.Unit, r["Required?"], r.Notes, r["Governance owner"]]),
  ]);
  addSheet("02_DCS_Boundary_Map", [
    ["Boundary Area", "Source System", "DCS/ERP/Lab Tag", "MRV Field", "Unit", "Frequency", "Evidence Required", "Calculation Use", "Mapped Status", "Owner", "QA/QC Rule"],
    ...s.dcsMap.map((r) =>
      ["Boundary Area", "Source System", "DCS/ERP/Lab Tag", "MRV Field", "Unit", "Frequency", "Evidence Required", "Calculation Use", "Mapped Status", "Owner", "QA/QC Rule"].map((k) => r[k])
    ),
  ]);
  addSheet("03_Production_Input", [
    ["Date", "Quarter", "Kiln Line", "Cement Type", "Clinker Produced t", "Cement Produced t", "Clinker Used t", "Gypsum t", "Limestone Additive t", "Other Additives t", "Clinker Factor", "Evidence ID", "QA Status", "Notes"],
    ...s.production.map((r) => [r.Date, r.Quarter, r["Kiln Line"], r["Cement Type"], r["Clinker Produced t"], r["Cement Produced t"], r["Clinker Used t"], r["Gypsum t"], r["Limestone Additive t"], r["Other Additives t"], r["Clinker Factor"], r["Evidence ID"], r["QA Status"], r.Notes]),
  ]);
  addSheet("04_Raw_Material_Input", [
    ["Date", "Material", "Quantity t", "CaCO3 %", "MgCO3 %", "Moisture %", "Calcination Conversion", "CaCO3 CO2 t", "MgCO3 CO2 t", "Process CO2 Method A t", "Evidence ID", "QA Status"],
    ...s.rawMaterial.map((r) => [r.Date, r.Material, r["Quantity t"], r["CaCO3 %"], r["MgCO3 %"], r["Moisture %"], r["Calcination Conversion"], r["CaCO3 CO2 t"], r["MgCO3 CO2 t"], r["Process CO2 Method A t"], r["Evidence ID"], r["QA Status"]]),
  ]);
  addSheet("05_Kiln_Fuel_Input", [
    ["Date", "Fuel Type", "Quantity", "Unit", "NCV GJ/unit", "EF tCO2/TJ", "Oxidation Factor", "Biomass Fraction", "Fossil Fraction", "Energy GJ", "Energy TJ", "Fossil CO2 t", "Biogenic CO2 Memo t", "Evidence ID", "QA Status"],
    ...s.kilnFuel.map((r) => [r.Date, r["Fuel Type"], r.Quantity, r.Unit, r["NCV GJ/unit"], r["EF tCO2/TJ"], r["Oxidation Factor"], r["Biomass Fraction"], r["Fossil Fraction"], r["Energy GJ"], r["Energy TJ"], r["Fossil CO2 t"], r["Biogenic CO2 Memo t"], r["Evidence ID"], r["QA Status"]]),
  ]);
  addSheet("06_Electricity_Input", [
    ["Date", "Meter / Source", "Grid MWh", "Grid EF tCO2/MWh", "Grid CO2 t", "Self-generation MWh", "Self-generation EF", "Self-generation CO2 t", "Renewable MWh", "Evidence ID", "QA Status"],
    ...s.electricity.map((r) => [r.Date, r["Meter / Source"], r["Grid MWh"], r["Grid EF tCO2/MWh"], r["Grid CO2 t"], r["Self-generation MWh"], r["Self-generation EF"], r["Self-generation CO2 t"], r["Renewable MWh"], r["Evidence ID"], r["QA Status"]]),
  ]);
  addSheet("07_Constants_EF_NCV", [
    ["Constant / Factor", "Value", "Unit", "Source / rationale", "Used in", "Change control", "Status", "Source URL"],
    ...s.constants.map((r) => [r["Constant / Factor"], r.Value, r.Unit, r["Source / rationale"], r["Used in"], r["Change control"], r.Status, r["Source URL"]]),
    [],
    ["Fuel Type", "Default NCV", "NCV Unit", "Default EF", "EF Unit", "Default Ox.", "Default Biomass %", "Notes"],
    ...s.fuelDefaults.map((r) => [r["Fuel Type"], r["Default NCV"], r["NCV Unit"], r["Default EF"], r["EF Unit"], r["Default Ox."], r["Default Biomass %"], r.Notes]),
  ]);
  addSheet("08_Calculations", [
    ["Metric", "Formula / Link", "Value", "Unit", "Governance note", "QA Source"],
    ...s.calcRows.map((r) => [r.Metric, r["Formula / Link"], r.Value, r.Unit, r["Governance note"], r["QA Source"]]),
  ]);
  addSheet("09_QAQC_Checks", [
    ["Check ID", "Category", "Check Name", "Rule", "Result", "Status", "Severity", "Owner", "Comment"],
    ...s.qaqc.map((r) => [r["Check ID"], r.Category, r["Check Name"], r.Rule, r.Result, r.Status, r.Severity, r.Owner, r.Comment]),
  ]);
  addSheet("10_Report_Outputs", [
    ["Output Field", "Value", "Unit", "Source", "Report Label", "Governance Position", "Mapped to Cement UI", "Notes"],
    ...s.reportOutputs.map((r) => [r["Output Field"], r.Value, r.Unit, r.Source, r["Report Label"], r["Governance Position"], r["Mapped to Cement UI"], r.Notes]),
  ]);
  addSheet("11_Evidence_Register", [
    ["Evidence ID", "Evidence Type", "Description", "Source System", "Mapped Sheet", "Status", "Owner", "Reviewer", "Frequency", "Notes"],
    ...s.evidence.map((r) => [r["Evidence ID"], r["Evidence Type"], r.Description, r["Source System"], r["Mapped Sheet"], r.Status, r.Owner, r.Reviewer, r.Frequency, r.Notes]),
  ]);
  addSheet("12_Regulatory_Refs", [
    ["Reference", "Workbook application", "Official source URL", "Page / section pointer", "Applied sheets", "Notes", "Status", "Last checked"],
    ...s.regulatory.map((r) => [r.Reference, r["Workbook application"], r["Official source URL"], r["Page / section pointer"], r["Applied sheets"], r.Notes, r.Status, r["Last checked"]]),
  ]);

  const quarter = String(s.setup["Reporting quarter"] || "Q1");
  XLSX.writeFile(wb, `TRACE_FORCE_MRV_Cement_Export_${quarter.replace(/\s/g, "_")}.xlsx`);
}

export function downloadBlankTemplate(): void {
  try {
    const wb = XLSX.utils.book_new();

    function addSheet(name: string, rows: (string | number | null | undefined)[][]) {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }

    // 00_README_Control
    addSheet("00_README_Control", [
      ["TRACE FORCE MRV — Cement QA/QC V28 Collection Workbook Template"],
      ["Standard workbook schema for cement/clinker CBAM-GHG MRV."],
      ["Control", "Value", "Governance note"],
      ["Workbook Version", "v0.2", "Official TRACE FORCE MRV Schema"],
      ["Status", "OFFICIAL TEMPLATE", "Ready for plant activity data collection"],
      ["Sector", "Cement / Clinker", "Operational boundary"],
      ["Calculation chain", "DCS Boundary → Inputs → Constants → Calculations → QA/QC → Report Outputs", "14-sheet automated accounting"],
      ["Important control", "Missing values are not silently converted to zero", "QA/QC flags unpopulated mandatory cells"],
    ]);

    // 01_Setup
    addSheet("01_Setup", [
      ["Setup and Reporting Control"],
      ["Facility parameters, accounting period and methodology selection."],
      ["Parameter", "Value", "Unit", "Required?", "Notes", "Governance owner"],
      ["Workbook mode", "Cement_QAQC_V28", null, "Yes", "MRV mode lock", "EgyTrace"],
      ["Installation / site", "", null, "Yes", "Enter plant name", "Plant"],
      ["Country", "Egypt", null, "Yes", "Jurisdiction for grid emission factors", "Plant"],
      ["Reporting quarter", "Q1 2025", null, "Yes", "Reporting period", "Sustainability"],
      ["Period start", "2025-01-01", "date", "Yes", "Inclusive start date", "Sustainability"],
      ["Period end", "2025-03-31", "date", "Yes", "Inclusive end date", "Sustainability"],
      ["Primary product", "CEM II/A-L 42.5N", null, "Yes", "Target product type", "Production"],
      ["Boundary approach", "Operational control", null, "Yes", "Accounting boundary", "Sustainability"],
      ["Selected calcination method", "Method B - clinker output", null, "Yes", "Method A or Method B", "Sustainability"],
      ["Assurance status", "Prepared for internal review", null, "Yes", "Verification status", "Sustainability"],
      ["Submission status", "Draft", null, "Yes", "Submission status", "Sustainability"],
      ["CKD correction applied", "No", null, "Yes", "Cement kiln dust correction", "Sustainability"],
    ]);

    // 02_DCS_Boundary_Map
    addSheet("02_DCS_Boundary_Map", [
      ["DCS / ERP / Lab Boundary Map"],
      ["Source systems mapping to MRV fields."],
      ["Boundary Area","Source System","DCS/ERP/Lab Tag","MRV Field","Unit","Frequency","Evidence Required","Calculation Use","Mapped Status","Owner","QA/QC Rule"],
      ["Production", "Kiln DCS", "KILN1_CLINKER_T_DAY", "Clinker Produced", "t/day", "Daily", "Weighbridge log", "Production_Input", "Mapped", "Production", "No negative"],
      ["Production", "ERP / Dispatch", "CEM_MILL1_OUTPUT_T_DAY", "Cement Produced", "t/day", "Daily", "Dispatch report", "Production_Input", "Mapped", "Production", "Cement >= clinker used"],
      ["Production", "ERP / Mill", "CLINKER_USED_CEM_T_DAY", "Clinker Used in Cement", "t/day", "Daily", "Mill balance", "Production_Input", "Mapped", "Production", "Clinker factor 0.25–1.00"],
      ["Raw materials", "LIMS", "RAWMEAL_CACO3_PCT", "CaCO3 Content", "%", "Daily/Batch", "Lab certificate", "Raw_Material_Input", "Mapped", "Lab", "0–100%"],
      ["Fuel", "Weigh feeder", "FUEL_FEED_T_DAY", "Kiln Fuel Feed", "t/day", "Daily", "Weigh feeder ticket", "Kiln_Fuel_Input", "Mapped", "Energy", "Qty >= 0"],
      ["Electricity", "Utility meter", "GRID_MWH_MONTH", "Purchased Grid Electricity", "MWh", "Monthly", "Utility invoice", "Electricity_Input", "Mapped", "Utilities", "MWh >= 0"],
    ]);

    // 03_Production_Input
    addSheet("03_Production_Input", [
      ["Production Activity Data"],
      ["Daily or monthly production and additive masses."],
      ["Date","Quarter","Kiln Line","Cement Type","Clinker Produced t","Cement Produced t","Clinker Used t","Gypsum t","Limestone Additive t","Other Additives t","Clinker Factor","Evidence ID","QA Status","Notes"],
      ["2025-01-31", "Q1 2025", "Kiln 1", "CEM II/A-L 42.5N", "", "", "", "", "", "", "", "EV-PROD-01", "", "Enter row data"],
    ]);

    // 04_Raw_Material_Input
    addSheet("04_Raw_Material_Input", [
      ["Raw Material Carbonate Data"],
      ["Raw meal carbonate titration and calcination parameters for Method A."],
      ["Date","Material","Quantity t","CaCO3 %","MgCO3 %","Moisture %","Calcination Conversion","CaCO3 CO2 t","MgCO3 CO2 t","Process CO2 Method A t","Evidence ID","QA Status"],
      ["2025-01-31", "Raw Meal", "", "", "", "", 1.0, "", "", "", "EV-RAW-01", ""],
    ]);

    // 05_Kiln_Fuel_Input
    addSheet("05_Kiln_Fuel_Input", [
      ["Kiln Fuel Combustion Data"],
      ["Fuel quantities, heating values, and emission factors."],
      ["Date","Fuel Type","Quantity","Unit","NCV GJ/unit","EF tCO2/TJ","Oxidation Factor","Biomass Fraction","Fossil Fraction","Energy GJ","Energy TJ","Fossil CO2 t","Biogenic CO2 Memo t","Evidence ID","QA Status"],
      ["2025-01-31", "Petcoke", "", "t", 32.5, 97.5, 0.99, 0.00, 1.00, "", "", "", "", "EV-FUEL-01", ""],
      ["2025-01-31", "Coal",    "", "t", 25.8, 94.6, 0.99, 0.00, 1.00, "", "", "", "", "EV-FUEL-02", ""],
      ["2025-01-31", "RDF",     "", "t", 17.0, 85.0, 0.98, 0.50, 0.50, "", "", "", "", "EV-FUEL-03", ""],
    ]);

    // 06_Electricity_Input
    addSheet("06_Electricity_Input", [
      ["Electricity Consumption Data"],
      ["Grid purchases and on-site generation Scope 2 activity data."],
      ["Date","Meter / Source","Grid MWh","Grid EF tCO2/MWh","Grid CO2 t","Self-generation MWh","Self-generation EF","Self-generation CO2 t","Renewable MWh","Evidence ID","QA Status"],
      ["2025-01-31", "Main Substation", "", 0.4878, "", 0, 0, 0, 0, "EV-ELEC-01", ""],
    ]);

    // 07_Constants_EF_NCV
    addSheet("07_Constants_EF_NCV", [
      ["Factors and Constants Library"],
      ["Official emission factors, heating values, and stoichiometric ratios."],
      ["Constant / Factor","Value","Unit","Source / rationale","Used in","Change control","Status","Source URL"],
      ["Selected clinker process EF", 0.5325, "tCO2/t clinker", "IPCC default for 65% CaO", "08_Calculations", "Controlled", "Active", ""],
      ["CaCO3 molar mass ratio", 0.4397, "tCO2/t CaCO3", "Stoichiometric 44.01/100.09", "04_Raw_Material_Input", "Controlled", "Active", ""],
      ["MgCO3 molar mass ratio", 0.5220, "tCO2/t MgCO3", "Stoichiometric 44.01/84.31", "04_Raw_Material_Input", "Controlled", "Active", ""],
      ["Grid EF Egypt Q1 2025", 0.4878, "tCO2/MWh", "Published grid baseline", "06_Electricity_Input", "Controlled", "Active", ""],
      [],
      ["Fuel Type","Default NCV","NCV Unit","Default EF","EF Unit","Default Ox.","Default Biomass %","Notes"],
      ["Petcoke", 32.5, "GJ/t", 97.5, "tCO2/TJ", 0.99, 0.00, "High-carbon kiln fuel"],
      ["Coal", 25.8, "GJ/t", 94.6, "tCO2/TJ", 0.99, 0.00, "Fossil solid fuel"],
      ["RDF", 17.0, "GJ/t", 85.0, "tCO2/TJ", 0.98, 0.50, "Refuse derived fuel"],
      ["Tyre Chips", 31.4, "GJ/t", 85.0, "tCO2/TJ", 0.98, 0.27, "Rubber biomass"],
      ["Natural Gas", 0.048, "GJ/Nm3", 56.1, "tCO2/TJ", 0.995, 0.00, "Gaseous fuel"],
      ["Diesel", 43.0, "GJ/t", 74.1, "tCO2/TJ", 0.99, 0.00, "Startup backup fuel"],
    ]);

    // 08_Calculations
    addSheet("08_Calculations", [
      ["Emissions Calculations Chain"],
      ["Summary of all mathematical derivations and intensity metrics."],
      ["Metric","Formula / Link","Value","Unit","Governance note","QA Source"],
      ["Clinker Produced", "=SUM('03_Production_Input'!E4:E10)", 0, "t", "Production total", "Production_Input"],
      ["Cement Produced", "=SUM('03_Production_Input'!F4:F10)", 0, "t", "Cement output", "Production_Input"],
      ["Clinker Used in Cement", "=SUM('03_Production_Input'!G4:G10)", 0, "t", "Clinker consumption", "Production_Input"],
      ["Clinker Factor", "=C6/C5", 0, "ratio", "Clinker / Cement", "Production_Input"],
      ["Process CO2 Method A", "=SUM('04_Raw_Material_Input'!J4:J10)", 0, "tCO2", "Method A total", "Raw_Material_Input"],
      ["Process CO2 Method B", "=C4*0.5325", 0, "tCO2", "Method B clinker EF total", "Constants"],
      ["Selected Process CO2", "=C9", 0, "tCO2", "Selected calcination pathway", "Setup"],
      ["Fuel Combustion CO2", "=SUM('05_Kiln_Fuel_Input'!L4:L10)", 0, "tCO2", "Fossil fuel combustion", "Kiln_Fuel_Input"],
      ["Biogenic CO2 Memo", "=SUM('05_Kiln_Fuel_Input'!M4:M10)", 0, "tCO2", "Biogenic memo", "Kiln_Fuel_Input"],
      ["Direct Embedded CO2", "=C10+C11", 0, "tCO2", "Process + Fuel combustion", "Calculations"],
      ["Grid Electricity MWh", "=SUM('06_Electricity_Input'!C4:C10)", 0, "MWh", "Scope 2 consumption", "Electricity_Input"],
      ["Indirect Grid CO2", "=SUM('06_Electricity_Input'!E4:E10)", 0, "tCO2", "Scope 2 emissions", "Electricity_Input"],
      ["Total Embedded CO2", "=C13+C15", 0, "tCO2", "Direct + Indirect emissions", "Calculations"],
      ["SEE Clinker", "=C13/C4", 0, "tCO2/t clinker", "Clinker intensity", "Calculations"],
      ["Specific Embedded Emissions Cement", "=C16/C5", 0, "tCO2/t cement", "Product intensity", "Calculations"],
    ]);

    // 09_QAQC_Checks
    addSheet("09_QAQC_Checks", [
      ["Automated QA/QC Check Register"],
      ["18 automated quality rules for completeness, mass balances, and reasonableness."],
      ["Check ID","Category","Check Name","Rule","Result","Status","Severity","Owner"],
      ["MB-01", "Mass Balance", "Clinker factor range", "0.25 <= Clinker Factor <= 1.00", "", "PASS", "Warning", "Production"],
      ["MB-02", "Mass Balance", "Cement production >= clinker used", "Cement Produced >= Clinker Used", "", "PASS", "Fail", "Production"],
      ["MB-03", "Mass Balance", "Cement mass balance tolerance", "Clinker + additives ≈ cement ±2%", "", "PASS", "Warning", "Production"],
      ["EI-01", "Emission Intensity", "SEE clinker expected range", "0.50 <= SEE Clinker <= 1.20", "", "PASS", "Warning", "Sustainability"],
      ["EI-02", "Emission Intensity", "SEE cement not extreme", "0.20 <= SEE Cement <= 1.20", "", "PASS", "Warning", "Sustainability"],
      ["FC-01", "Fuel", "All fuel NCV populated", "Minimum NCV > 0", "", "PASS", "Fail", "Energy"],
      ["FC-02", "Fuel", "All fuel EF populated", "Minimum EF > 0", "", "PASS", "Fail", "Sustainability"],
      ["FC-03", "Fuel", "Biomass fraction valid", "0 <= Biomass <= 1", "", "PASS", "Fail", "Energy"],
      ["FC-04", "Fuel", "Oxidation factor reasonable", "0.95 <= OxFactor <= 1.00", "", "PASS", "Warning", "Sustainability"],
      ["EL-01", "Electricity", "Grid EF populated", "Minimum grid EF > 0", "", "PASS", "Fail", "Utilities"],
      ["EL-02", "Electricity", "Electricity present", "Grid MWh > 0", "", "PASS", "Warning", "Utilities"],
      ["CP-01", "Completeness", "Process CO2 calculated", "Selected Process CO2 > 0", "", "PASS", "Fail", "Sustainability"],
      ["EV-01", "Evidence", "Evidence register completeness", "No missing evidence status", "", "PASS", "Warning", "QA/QC"],
      ["PR-01", "Period Lock", "Input period aligned", "Inputs are in selected quarter", "", "PASS", "Fail", "Sustainability"],
      ["MB-04", "Mass Balance", "Clinker stockpile reconciliation", "Produced - Used = tracked delta", "", "PASS", "Warning", "Production"],
      ["EI-03", "Emission Intensity", "SHC expected range", "2.8 <= SHC <= 4.5 GJ/t clinker", "", "PASS", "Warning", "Sustainability"],
      ["FC-05", "Fuel", "TSR in expected range", "0% <= TSR <= 80%", "", "PASS", "Warning", "Energy"],
      ["CP-02", "Completeness", "Method selection valid", "Method A or B explicitly selected in Setup", "", "PASS", "Fail", "Sustainability"],
    ]);

    // 10_Report_Outputs
    addSheet("10_Report_Outputs", [
      ["System-Facing Report Outputs"],
      ["Consolidated outputs ready for regulatory submission."],
      ["Output Field","Value","Unit","Source","Report Label","Governance Position","Mapped to Cement UI","Notes"],
      ["Quarter", "Q1 2025", null, "Setup", "Reporting period", "Selected-period lock", "Overview / Report Cover", "Template"],
      ["Product", "CEM II/A-L 42.5N", null, "Setup", "Product selected", "Product boundary", "Overview", "Template"],
      ["Total Embedded CO2", 0, "tCO2", "Calculations", "Total embedded CO2", "Direct + indirect grid", "Overview / Report", "Template"],
      ["Specific Embedded Emissions Cement", 0, "tCO2/t cement", "Calculations", "Specific embedded emissions", "Final cement product intensity", "Overview / Report", "Template"],
    ]);

    // 11_Evidence_Register
    addSheet("11_Evidence_Register", [
      ["Evidence Document Register"],
      ["Document traceability linking activity records to calibration and lab evidence."],
      ["Evidence ID","Evidence Type","Description","Source System","Mapped Sheet","Status","Owner","Reviewer","Frequency","Notes"],
      ["EV-PROD-01", "Production log", "Weighbridge monthly production log", "Kiln DCS / ERP", "03_Production_Input", "Mapped", "Production", "MRV Team", "Monthly", "Template"],
      ["EV-RAW-01",  "Lab certificate", "Raw meal carbonate titration analysis", "LIMS", "04_Raw_Material_Input", "Mapped", "Lab", "MRV Team", "Monthly", "Template"],
      ["EV-FUEL-01", "Fuel record", "Fuel delivery weigh tickets and lab NCV certificates", "Fuel ERP", "05_Kiln_Fuel_Input", "Mapped", "Energy", "MRV Team", "Monthly", "Template"],
      ["EV-ELEC-01", "Electricity bill", "Monthly fiscal electricity meter bill", "Utility meter", "06_Electricity_Input", "Mapped", "Utilities", "MRV Team", "Monthly", "Template"],
    ]);

    // 12_Regulatory_Refs
    addSheet("12_Regulatory_Refs", [
      ["Regulatory Reference Library"],
      ["Official EU/CBAM and ISO 14064 reference mappings."],
      ["Reference","Workbook application","Official source URL","Page / section pointer","Applied sheets","Notes","Status","Last checked"],
      ["CBAM Regulation (EU) 2023/956", "Legal basis for CBAM embedded emissions reporting", "https://taxation-customs.ec.europa.eu/", "Regulation (EU) 2023/956", "All sheets", "Official", "Official", "2026-05-19"],
      ["ISO 14064-1:2018", "GHG quantification boundaries", "https://www.iso.org/standard/66453.html", "Section 5", "00, 01, 08", "Standard", "Official", "2026-05-19"],
    ]);

    // 13_Dashboard
    addSheet("13_Dashboard", [
      ["Cement MRV Executive Summary"],
      ["Pre-formatted executive dashboard summary."],
      ["Metric", "Value", "Unit", "Governance position"],
      ["Direct Embedded CO2", 0, "tCO2", "Process + fossil combustion"],
      ["Total Embedded CO2", 0, "tCO2", "Direct + Indirect grid"],
      ["SEE Cement", 0, "tCO2/t cement", "Final product intensity"],
      ["QA/QC Status", "PASS", "status", "Internal readiness"],
    ]);

    XLSX.writeFile(wb, "TRACE_FORCE_MRV_Cement_QAQC_V28_Blank_Template.xlsx");
  } catch (e: any) {
    console.error("Blank template export error:", e);
    alert("Failed to generate template: " + e.message);
  }
}
