import * as XLSX from "xlsx";
import { createEmptyStore, type SheetRow, type Store } from "./types";

const EXPECTED_SHEETS = [
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

const REQUIRED_HEADERS: Record<string, string[]> = {
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
  "07_Constants_EF_NCV": [
    "Constant / Factor",
    "Value",
    "Unit",
    "Source / rationale",
    "Used in",
    "Change control",
    "Status",
    "Source URL",
  ],
  "08_Calculations": ["Metric", "Formula / Link", "Value", "Unit", "Governance note", "QA Source"],
  "09_QAQC_Checks": ["Check ID", "Category", "Check Name", "Rule", "Result", "Status", "Severity", "Owner"],
  "10_Report_Outputs": [
    "Output Field",
    "Value",
    "Unit",
    "Source",
    "Report Label",
    "Governance Position",
    "Mapped to Cement UI",
    "Notes",
  ],
  "11_Evidence_Register": [
    "Evidence ID",
    "Evidence Type",
    "Description",
    "Source System",
    "Mapped Sheet",
    "Status",
    "Owner",
    "Reviewer",
    "Frequency",
    "Notes",
  ],
  "12_Regulatory_Refs": [
    "Reference",
    "Workbook application",
    "Official source URL",
    "Page / section pointer",
    "Applied sheets",
    "Notes",
    "Status",
    "Last checked",
  ],
};

function sheetRows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null }) as unknown[][];
}

function sheetRowsRaw(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as unknown[][];
}

function rowToObj(headers: unknown[], row: unknown[]): SheetRow {
  const obj: SheetRow = {};
  headers.forEach((h, i) => {
    obj[String(h)] = row[i] !== undefined ? row[i] : null;
  });
  return obj;
}

function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "number") {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    } catch {
      /* ignore */
    }
  }
  if (typeof val === "string") {
    const d = new Date(val);
    if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  }
  return String(val);
}

function parseNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "string" && val.startsWith("#")) return null;
  const n = parseFloat(String(val));
  return Number.isNaN(n) ? null : n;
}

function isEmptyRow(r: unknown[] | undefined): boolean {
  return !r || r.every((v) => v === null);
}

export function parseWorkbook(buffer: ArrayBuffer, filename: string): Store {
  const store = createEmptyStore();
  store.meta.filename = filename;
  store.meta.uploadedAt = new Date().toISOString();

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch (e) {
    store._errors.push("Failed to read file: " + (e instanceof Error ? e.message : String(e)));
    store._valid = false;
    return store;
  }

  const missing = EXPECTED_SHEETS.filter((s) => !wb.SheetNames.includes(s));
  if (missing.length > 0) {
    missing.forEach((s) => store._errors.push(`Missing sheet: "${s}"`));
    store._valid = false;
    return store;
  }

  for (const [sheet, reqCols] of Object.entries(REQUIRED_HEADERS)) {
    const rows = sheetRows(wb, sheet);
    const headerRow = rows[2] || [];
    for (const col of reqCols) {
      if (!headerRow.includes(col)) {
        store._errors.push(`Sheet "${sheet}" missing column: "${col}"`);
      }
    }
  }

  if (store._errors.length > 0) {
    store._valid = false;
    return store;
  }

  parse00(wb, store);
  parse01(wb, store);
  parse02(wb, store);
  parse03(wb, store);
  parse04(wb, store);
  parse05(wb, store);
  parse06(wb, store);
  parse07(wb, store);
  parse08(wb, store);
  parse09(wb, store);
  parse10(wb, store);
  parse11(wb, store);
  parse12(wb, store);
  parse13(wb, store);

  store._valid = store._errors.length === 0;
  return store;
}

function parse00(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "00_README_Control");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    store.readme.push(rowToObj(headers, r));
  }
}

function parse01(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "01_Setup");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const obj = rowToObj(headers, r);
    const key = obj["Parameter"];
    if (key) {
      let val = obj["Value"];
      if (val && typeof val === "string" && val.includes("T00:00:00")) {
        val = val.split("T")[0];
      }
      store.setup[String(key)] = val;
      store.setupRows.push(obj);
    }
  }
}

function parse02(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "02_DCS_Boundary_Map");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    store.dcsMap.push(rowToObj(headers, r));
  }
}

function parse03(wb: XLSX.WorkBook, store: Store) {
  const rowsRaw = sheetRowsRaw(wb, "03_Production_Input");
  const rowsStr = sheetRows(wb, "03_Production_Input");
  const headers = rowsStr[2] || [];
  for (let i = 3; i < rowsStr.length; i++) {
    const rStr = rowsStr[i];
    const rRaw = rowsRaw[i] || rStr;
    if (isEmptyRow(rStr)) continue;
    const obj = rowToObj(headers, rStr);
    obj["Date"] = parseDate(rRaw[0]);
    obj["_dateRaw"] = rRaw[0];
    ["Clinker Produced t", "Cement Produced t", "Clinker Used t", "Gypsum t", "Limestone Additive t", "Other Additives t", "Clinker Factor"].forEach((k) => {
      obj[k] = parseNum(obj[k]);
    });
    store.production.push(obj);
  }
}

function parse04(wb: XLSX.WorkBook, store: Store) {
  const rowsRaw = sheetRowsRaw(wb, "04_Raw_Material_Input");
  const rowsStr = sheetRows(wb, "04_Raw_Material_Input");
  const headers = rowsStr[2] || [];
  for (let i = 3; i < rowsStr.length; i++) {
    const rStr = rowsStr[i];
    const rRaw = rowsRaw[i] || rStr;
    if (isEmptyRow(rStr)) continue;
    const obj = rowToObj(headers, rStr);
    obj["Date"] = parseDate(rRaw[0]);
    ["Quantity t", "CaCO3 %", "MgCO3 %", "Moisture %", "Calcination Conversion", "CaCO3 CO2 t", "MgCO3 CO2 t", "Process CO2 Method A t"].forEach((k) => {
      obj[k] = parseNum(obj[k]);
    });
    store.rawMaterial.push(obj);
  }
}

function parse05(wb: XLSX.WorkBook, store: Store) {
  const rowsRaw = sheetRowsRaw(wb, "05_Kiln_Fuel_Input");
  const rowsStr = sheetRows(wb, "05_Kiln_Fuel_Input");
  const headers = rowsStr[2] || [];
  for (let i = 3; i < rowsStr.length; i++) {
    const rStr = rowsStr[i];
    const rRaw = rowsRaw[i] || rStr;
    if (isEmptyRow(rStr)) continue;
    const obj = rowToObj(headers, rStr);
    obj["Date"] = parseDate(rRaw[0]);
    ["Quantity", "NCV GJ/unit", "EF tCO2/TJ", "Oxidation Factor", "Biomass Fraction", "Fossil Fraction", "Energy GJ", "Energy TJ", "Fossil CO2 t", "Biogenic CO2 Memo t"].forEach((k) => {
      obj[k] = parseNum(obj[k]);
    });
    store.kilnFuel.push(obj);
  }
}

function parse06(wb: XLSX.WorkBook, store: Store) {
  const rowsRaw = sheetRowsRaw(wb, "06_Electricity_Input");
  const rowsStr = sheetRows(wb, "06_Electricity_Input");
  const headers = rowsStr[2] || [];
  for (let i = 3; i < rowsStr.length; i++) {
    const rStr = rowsStr[i];
    const rRaw = rowsRaw[i] || rStr;
    if (isEmptyRow(rStr)) continue;
    const obj = rowToObj(headers, rStr);
    obj["Date"] = parseDate(rRaw[0]);
    ["Grid MWh", "Grid EF tCO2/MWh", "Grid CO2 t", "Self-generation MWh", "Self-generation EF", "Self-generation CO2 t", "Renewable MWh"].forEach((k) => {
      obj[k] = parseNum(obj[k]);
    });
    store.electricity.push(obj);
  }
}

function parse07(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "07_Constants_EF_NCV");
  const constHeaders = rows[2] || [];
  let fuelHeaderIdx = -1;

  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (r && r[0] === "Fuel Type" && r[1] === "Default NCV") {
      fuelHeaderIdx = i;
      break;
    }
  }

  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    if (i === fuelHeaderIdx) continue;
    if (fuelHeaderIdx > -1 && i > fuelHeaderIdx) {
      const fuelHeaders = rows[fuelHeaderIdx] || [];
      const obj = rowToObj(fuelHeaders, r);
      if (!obj["Fuel Type"]) continue;
      obj["Default NCV"] = parseNum(obj["Default NCV"]);
      obj["Default EF"] = parseNum(obj["Default EF"]);
      obj["Default Ox."] = parseNum(obj["Default Ox."]);
      obj["Default Biomass %"] = parseNum(obj["Default Biomass %"]);
      store.fuelDefaults.push(obj);
    } else {
      const obj = rowToObj(constHeaders, r);
      if (!obj["Constant / Factor"]) continue;
      obj["Value"] = parseNum(obj["Value"]);
      store.constants.push(obj);
    }
  }
}

function parse08(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "08_Calculations");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const obj = rowToObj(headers, r);
    if (!obj["Metric"]) continue;
    obj["Value"] = parseNum(obj["Value"]) !== null ? parseNum(obj["Value"]) : obj["Value"];
    store.calcRows.push(obj);
    store.calculations[String(obj["Metric"])] = obj;
  }
}

function parse09(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "09_QAQC_Checks");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const obj = rowToObj(headers, r);
    if (!obj["Check ID"]) continue;
    const numResult = parseNum(obj["Result"]);
    if (numResult !== null) obj["_resultNum"] = numResult;
    store.qaqc.push(obj);
  }
}

function parse10(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "10_Report_Outputs");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const obj = rowToObj(headers, r);
    if (!obj["Output Field"]) continue;
    obj.outputField = obj["Output Field"];
    const numVal = parseNum(obj["Value"]);
    if (numVal !== null) obj["_valueNum"] = numVal;
    if (obj["Value"] && typeof obj["Value"] === "string" && obj["Value"].includes("T00:00:00")) {
      obj["Value"] = obj["Value"].split("T")[0];
    }
    store.reportOutputs.push(obj);
  }
}

function parse11(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "11_Evidence_Register");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const obj = rowToObj(headers, r);
    if (!obj["Evidence ID"]) continue;
    obj.evidenceId = obj["Evidence ID"];
    store.evidence.push(obj);
  }
}

function parse12(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "12_Regulatory_Refs");
  const headers = rows[2] || [];
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (isEmptyRow(r)) continue;
    const obj = rowToObj(headers, r);
    if (!obj["Reference"]) continue;
    store.regulatory.push(obj);
  }
}

function parse13(wb: XLSX.WorkBook, store: Store) {
  const rows = sheetRows(wb, "13_Dashboard");
  let metricHeaderIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i][0] === "Metric" && rows[i][1] === "Value") {
      metricHeaderIdx = i;
      break;
    }
  }

  if (metricHeaderIdx >= 0) {
    for (let i = metricHeaderIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || !r[0]) continue;
      const metric = String(r[0]);
      const val = parseNum(r[1]);
      const unit = r[2];
      const govPos = r[3];
      const comp = r[5];
      const tco2 = parseNum(r[6]);
      const share = parseNum(r[7]);
      if (comp && tco2 !== null && share !== null) {
        store.dashboard.co2Breakdown.push({ component: String(comp), tCO2: tco2, share });
      }
      store.dashboard.kpis[metric] = { value: val, unit, govPos };
    }
  }
}
