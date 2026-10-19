import * as XLSX from "xlsx";
import { compareWorkbookClaims, type WorkbookClaims } from "./assertions";
import { calculateStore } from "./calcEngine";
import { toIsoDate } from "./dates";
import { createEmptyInput, createEmptyStore, type MrvInput, type RowSource, type SheetRow, type Store } from "./types";

export const PRESENTATION_MARKER_SHEET = "_EXPORT_INFO";
export const INVENTORY_SHEET = "14_Inventory_Movements";
export const INVENTORY_HEADERS = ["Date", "Material", "Opening Stock t", "Purchased t", "Dispatched t", "Closing Stock t", "Evidence ID"];

export const EXPECTED_SHEETS = [
  "00_README_Control",
  "01_Setup",
  "02_DCS_Boundary_Map",
  "03_Production_Input",
  "04_Raw_Material_Input",
  "05_Kiln_Fuel_Input",
  "06_Electricity_Input",
  "07_Constants_EF_NCV",
  "08_Calculations",
  "09_QAQC_Checks",
  "10_Report_Outputs",
  "11_Evidence_Register",
  "12_Regulatory_Refs",
  "13_Dashboard",
];

export const REQUIRED_HEADERS: Record<string, string[]> = {
  "00_README_Control": ["Control", "Value", "Governance note"],
  "01_Setup": ["Parameter", "Value", "Unit", "Required?", "Notes", "Governance owner"],
  "02_DCS_Boundary_Map": [
    "Boundary Area",
    "Source System",
    "DCS/ERP/Lab Tag",
    "MRV Field",
    "Unit",
    "Frequency",
    "Evidence Required",
    "Calculation Use",
    "Mapped Status",
    "Owner",
    "QA/QC Rule",
  ],
  "03_Production_Input": [
    "Date",
    "Quarter",
    "Kiln Line",
    "Cement Type",
    "Clinker Produced t",
    "Cement Produced t",
    "Clinker Used t",
    "Gypsum t",
    "Limestone Additive t",
    "Other Additives t",
    "Clinker Factor",
    "Evidence ID",
    "QA Status",
    "Notes",
  ],
  "04_Raw_Material_Input": [
    "Date",
    "Material",
    "Quantity t",
    "CaCO3 %",
    "MgCO3 %",
    "Moisture %",
    "Calcination Conversion",
    "CaCO3 CO2 t",
    "MgCO3 CO2 t",
    "Process CO2 Method A t",
    "Evidence ID",
    "QA Status",
  ],
  "05_Kiln_Fuel_Input": [
    "Date",
    "Fuel Type",
    "Quantity",
    "Unit",
    "NCV GJ/unit",
    "EF tCO2/TJ",
    "Oxidation Factor",
    "Biomass Fraction",
    "Fossil Fraction",
    "Energy GJ",
    "Energy TJ",
    "Fossil CO2 t",
    "Biogenic CO2 Memo t",
    "Evidence ID",
    "QA Status",
  ],
  "06_Electricity_Input": [
    "Date",
    "Meter / Source",
    "Grid MWh",
    "Grid EF tCO2/MWh",
    "Grid CO2 t",
    "Self-generation MWh",
    "Self-generation EF",
    "Self-generation CO2 t",
    "Renewable MWh",
    "Evidence ID",
    "QA Status",
  ],
  "07_Constants_EF_NCV": ["Constant / Factor", "Value", "Unit", "Source / rationale", "Used in", "Change control", "Status", "Source URL"],
  "08_Calculations": ["Metric", "Formula / Link", "Value", "Unit", "Governance note", "QA Source"],
  "09_QAQC_Checks": ["Check ID", "Category", "Check Name", "Rule", "Result", "Status", "Severity", "Owner"],
  "10_Report_Outputs": ["Output Field", "Value", "Unit", "Source", "Report Label", "Governance Position", "Mapped to Cement UI", "Notes"],
  "11_Evidence_Register": ["Evidence ID", "Evidence Type", "Description", "Source System", "Mapped Sheet", "Status", "Owner", "Reviewer", "Frequency", "Notes"],
  "12_Regulatory_Refs": ["Reference", "Workbook application", "Official source URL", "Page / section pointer", "Applied sheets", "Notes", "Status", "Last checked"],
};

/** Columns the workbook computes itself. They are dropped from inputs (the engine recalculates them) but kept in provenance. */
const DERIVED_COLUMNS: Record<string, string[]> = {
  "03_Production_Input": ["Clinker Factor", "QA Status"],
  "04_Raw_Material_Input": ["CaCO3 CO2 t", "MgCO3 CO2 t", "Process CO2 Method A t", "QA Status"],
  "05_Kiln_Fuel_Input": ["Fossil Fraction", "Energy GJ", "Energy TJ", "Fossil CO2 t", "Biogenic CO2 Memo t", "QA Status"],
  "06_Electricity_Input": ["Grid CO2 t", "Self-generation CO2 t", "QA Status"],
};

const HEADER_ROW = 2;

interface SheetData {
  headers: string[];
  rows: { cells: unknown[]; rowNumber: number }[];
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function readSheet(wb: XLSX.WorkBook, name: string, raw: boolean, headerRow = HEADER_ROW): SheetData {
  const ws = wb.Sheets[name];
  if (!ws) return { headers: [], rows: [] };
  const startRow = ws["!ref"] ? XLSX.utils.decode_range(ws["!ref"]).s.r : 0;
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw, defval: null, blankrows: true }) as unknown[][];
  const headers = (all[headerRow] || []).map((h) => (h === null ? "" : String(h).trim()));
  const rows = all
    .map((cells, i) => ({ cells: cells || [], rowNumber: startRow + i + 1 }))
    .slice(headerRow + 1)
    .filter((r) => !r.cells.every(isBlank));
  return { headers, rows };
}

function toObj(headers: string[], cells: unknown[]): SheetRow {
  const obj: SheetRow = {};
  headers.forEach((h, i) => {
    if (h) obj[h] = cells[i] ?? null;
  });
  return obj;
}

function inputRows(wb: XLSX.WorkBook, sheet: string, filename: string, headers?: string[]): SheetRow[] {
  const data = readSheet(wb, sheet, true);
  const derived = DERIVED_COLUMNS[sheet] ?? [];
  return data.rows.map(({ cells, rowNumber }) => {
    const rawObj = toObj(data.headers, cells);
    const row: SheetRow = {};
    for (const [k, v] of Object.entries(rawObj)) {
      if (derived.includes(k)) continue;
      if (headers && !headers.includes(k)) continue;
      row[k] = k === "Date" ? (toIsoDate(v) ?? v) : v;
    }
    const source: RowSource = { origin: "workbook", file: filename, sheet, row: rowNumber, raw: rawObj };
    row._source = source;
    return row;
  });
}

function textRows(wb: XLSX.WorkBook, sheet: string, filename: string, keyField: string): SheetRow[] {
  const data = readSheet(wb, sheet, false);
  return data.rows
    .map(({ cells, rowNumber }) => {
      const row = toObj(data.headers, cells);
      row._source = { origin: "workbook", file: filename, sheet, row: rowNumber } satisfies RowSource;
      return row;
    })
    .filter((r) => !isBlank(r[keyField]));
}

function parseSetup(wb: XLSX.WorkBook, input: MrvInput, filename: string) {
  const data = readSheet(wb, "01_Setup", true);
  for (const { cells, rowNumber } of data.rows) {
    const row = toObj(data.headers, cells);
    const key = row.Parameter;
    if (isBlank(key)) continue;
    let value = row.Value;
    const isDate = String(row.Unit ?? "").toLowerCase() === "date" || /^period (start|end)$/i.test(String(key));
    if (isDate) value = toIsoDate(value) ?? value;
    input.setup[String(key)] = value;
    input.setupRows.push({ ...row, Value: value, _source: { origin: "workbook", file: filename, sheet: "01_Setup", row: rowNumber, raw: { Value: row.Value } } satisfies RowSource });
  }
}

function parseConstants(wb: XLSX.WorkBook, input: MrvInput, filename: string) {
  const sheet = "07_Constants_EF_NCV";
  const data = readSheet(wb, sheet, true);
  const fuelHeaderIdx = data.rows.findIndex((r) => r.cells[0] === "Fuel Type" && r.cells[1] === "Default NCV");
  data.rows.forEach(({ cells, rowNumber }, i) => {
    if (fuelHeaderIdx >= 0 && i === fuelHeaderIdx) return;
    const src: RowSource = { origin: "workbook", file: filename, sheet, row: rowNumber };
    if (fuelHeaderIdx >= 0 && i > fuelHeaderIdx) {
      const obj = toObj(data.rows[fuelHeaderIdx].cells.map((h) => (h === null ? "" : String(h))), cells);
      if (!isBlank(obj["Fuel Type"])) input.fuelDefaults.push({ ...obj, _source: src });
    } else {
      const obj = toObj(data.headers, cells);
      if (!isBlank(obj["Constant / Factor"])) input.constants.push({ ...obj, _source: { ...src, raw: { Value: obj.Value } } });
    }
  });
}

function readClaims(wb: XLSX.WorkBook): WorkbookClaims {
  const rowsOf = (sheet: string) => {
    const d = readSheet(wb, sheet, true);
    return d.rows.map((r) => toObj(d.headers, r.cells));
  };
  const dashboardKpis: Record<string, unknown> = {};
  const ws = wb.Sheets["13_Dashboard"];
  if (ws) {
    const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
    const idx = all.findIndex((r) => r && r[0] === "Metric" && r[1] === "Value");
    if (idx >= 0) {
      for (const r of all.slice(idx + 1)) {
        if (r && !isBlank(r[0])) dashboardKpis[String(r[0])] = r[1];
      }
    }
  }
  return { calcRows: rowsOf("08_Calculations"), qaqc: rowsOf("09_QAQC_Checks"), reportOutputs: rowsOf("10_Report_Outputs"), dashboardKpis };
}

function failed(filename: string, errors: string[]): Store {
  const store = createEmptyStore();
  store.meta.filename = filename;
  store._errors = errors;
  store._valid = false;
  return store;
}

/** Extracts raw inputs + provenance from a workbook, then runs the shared calculation engine. */
export function parseWorkbook(buffer: ArrayBuffer, filename: string): Store {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array" });
  } catch (e) {
    return failed(filename, ["Failed to read file: " + (e instanceof Error ? e.message : String(e))]);
  }

  if (wb.SheetNames.includes(PRESENTATION_MARKER_SHEET)) {
    return failed(filename, [
      "This file is a presentation report export, not an input workbook. Re-import the data export (.json) instead.",
    ]);
  }

  const missing = EXPECTED_SHEETS.filter((s) => !wb.SheetNames.includes(s));
  if (missing.length > 0) return failed(filename, missing.map((s) => `Missing sheet: "${s}"`));

  const errors: string[] = [];
  for (const [sheet, reqCols] of Object.entries(REQUIRED_HEADERS)) {
    const headers = readSheet(wb, sheet, false).headers;
    for (const col of reqCols) {
      if (!headers.includes(col)) errors.push(`Sheet "${sheet}" missing column: "${col}"`);
    }
  }
  if (wb.SheetNames.includes(INVENTORY_SHEET)) {
    const headers = readSheet(wb, INVENTORY_SHEET, false).headers;
    for (const col of INVENTORY_HEADERS) {
      if (!headers.includes(col)) errors.push(`Sheet "${INVENTORY_SHEET}" missing column: "${col}"`);
    }
  }
  if (errors.length > 0) return failed(filename, errors);

  const input = createEmptyInput("workbook");
  input.meta = { origin: "workbook", synthetic: false, filename, importedAt: new Date().toISOString() };
  input.readme = textRows(wb, "00_README_Control", filename, "Control");
  parseSetup(wb, input, filename);
  input.dcsMap = textRows(wb, "02_DCS_Boundary_Map", filename, "Boundary Area");
  input.production = inputRows(wb, "03_Production_Input", filename);
  input.rawMaterial = inputRows(wb, "04_Raw_Material_Input", filename);
  input.kilnFuel = inputRows(wb, "05_Kiln_Fuel_Input", filename);
  input.electricity = inputRows(wb, "06_Electricity_Input", filename);
  if (wb.SheetNames.includes(INVENTORY_SHEET)) input.inventory = inputRows(wb, INVENTORY_SHEET, filename, INVENTORY_HEADERS);
  parseConstants(wb, input, filename);
  input.evidence = textRows(wb, "11_Evidence_Register", filename, "Evidence ID");
  input.regulatory = textRows(wb, "12_Regulatory_Refs", filename, "Reference");

  const store = calculateStore(input, "workbook");
  store.assertions = compareWorkbookClaims(store, readClaims(wb));
  return store;
}
