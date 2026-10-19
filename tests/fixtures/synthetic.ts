/**
 * SYNTHETIC TEST FIXTURES — fictitious values for automated tests only. Not plant data.
 */
import * as XLSX from "xlsx";
import { EXPECTED_SHEETS, INVENTORY_HEADERS, INVENTORY_SHEET, REQUIRED_HEADERS } from "@/lib/parser";
import type { MrvInput, SheetRow } from "@/lib/types";

export const SYNTH_SETUP: Record<string, string> = {
  "Installation / site": "SYNTHETIC TEST PLANT",
  Country: "Testland",
  "Reporting quarter": "Q1 2025",
  "Period start": "2025-01-01",
  "Period end": "2025-03-31",
  "Primary product": "CEM II/A-L 42.5N",
  "Selected calcination method": "Method B - clinker output",
};

export const SYNTH_PRODUCTION: SheetRow = {
  Date: "2025-01-31",
  Quarter: "Q1 2025",
  "Kiln Line": "Kiln 1",
  "Cement Type": "CEM II/A-L 42.5N",
  "Clinker Produced t": 520000,
  "Cement Produced t": 680000,
  "Clinker Used t": 520200,
  "Gypsum t": 34000,
  "Limestone Additive t": 125800,
  "Other Additives t": 0,
  "Evidence ID": "EV-P1",
};

export const SYNTH_FUEL: SheetRow = {
  Date: "2025-02-28",
  "Fuel Type": "Petcoke",
  Quantity: 70000,
  Unit: "t",
  "NCV GJ/unit": 32.5,
  "EF tCO2/TJ": 97.5,
  "Oxidation Factor": 0.99,
  "Biomass Fraction": 0,
  "Evidence ID": "EV-F1",
};

export const SYNTH_ELECTRICITY: SheetRow = {
  Date: "2025-01-31",
  "Meter / Source": "M-01",
  "Grid MWh": 95000,
  "Grid EF tCO2/MWh": 0.4878,
  "Self-generation MWh": 0,
  "Self-generation EF": 0,
  "Renewable MWh": 0,
  "Evidence ID": "EV-E1",
};

export const SYNTH_INVENTORY: SheetRow = {
  Date: "2025-03-31",
  Material: "Clinker",
  "Opening Stock t": 30000,
  "Purchased t": 0,
  "Dispatched t": 0,
  "Closing Stock t": 29800,
  "Evidence ID": "EV-S1",
};

export const SYNTH_CONSTANTS: SheetRow[] = [
  { "Constant / Factor": "Selected clinker process EF", Value: 0.5325, Unit: "tCO2/t clinker", "Source / rationale": "Synthetic test", "Used in": "08", "Change control": "Test", Status: "Test", "Source URL": "" },
];

export const SYNTH_EVIDENCE: SheetRow[] = ["EV-P1", "EV-F1", "EV-E1", "EV-S1"].map((id) => ({
  "Evidence ID": id,
  "Evidence Type": "Synthetic",
  Description: "Synthetic test document",
  "Source System": "Test",
  "Mapped Sheet": "Test",
  Status: "Mapped",
  Owner: "Test",
  Reviewer: "Test",
  Frequency: "Quarterly",
  Notes: "Synthetic",
}));

/** Manual-entry equivalent: every value as the string an HTML input would produce. */
export function manualInput(overrides: Partial<MrvInput> = {}): Partial<MrvInput> {
  const asText = (r: SheetRow): SheetRow => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? "" : String(v)]));
  return {
    meta: { origin: "manual", synthetic: false, filename: null, importedAt: null },
    setup: { ...SYNTH_SETUP },
    production: [asText(SYNTH_PRODUCTION)],
    kilnFuel: [asText(SYNTH_FUEL)],
    electricity: [asText(SYNTH_ELECTRICITY)],
    inventory: [asText(SYNTH_INVENTORY)],
    rawMaterial: [],
    constants: SYNTH_CONSTANTS.map((r) => ({ ...r })),
    evidence: SYNTH_EVIDENCE.map((r) => ({ ...r })),
    ...overrides,
  };
}

export interface WorkbookOptions {
  setup?: Record<string, unknown>;
  production?: SheetRow[];
  fuel?: SheetRow[];
  electricity?: SheetRow[];
  inventory?: SheetRow[] | null;
  /** [sheet, rowIndex(0-based data row), column header, number format] */
  formats?: [string, number, string, string][];
  calcClaims?: SheetRow[];
  qaqcClaims?: SheetRow[];
  dashboardClaims?: [string, unknown][];
  omitSheet?: string;
}

function sheetFromObjects(title: string, headers: string[], rows: SheetRow[]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet([[title], ["SYNTHETIC TEST FIXTURE"], headers, ...rows.map((r) => headers.map((h) => (r[h] === undefined ? null : r[h])))]);
}

/** Builds a synthetic collection workbook (14 sheets + optional inventory) as an .xlsx ArrayBuffer. */
export function buildWorkbook(opts: WorkbookOptions = {}): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const setup = { ...SYNTH_SETUP, ...(opts.setup ?? {}) };
  const data: Record<string, SheetRow[]> = {
    "00_README_Control": [{ Control: "Workbook Version", Value: "test", "Governance note": "Synthetic" }],
    "01_Setup": Object.entries(setup).map(([Parameter, Value]) => ({ Parameter, Value, Unit: /^Period/.test(Parameter) ? "date" : null, "Required?": "Yes" })),
    "02_DCS_Boundary_Map": [],
    "03_Production_Input": opts.production ?? [SYNTH_PRODUCTION],
    "04_Raw_Material_Input": [],
    "05_Kiln_Fuel_Input": opts.fuel ?? [SYNTH_FUEL],
    "06_Electricity_Input": opts.electricity ?? [SYNTH_ELECTRICITY],
    "07_Constants_EF_NCV": SYNTH_CONSTANTS,
    "08_Calculations": opts.calcClaims ?? [],
    "09_QAQC_Checks": opts.qaqcClaims ?? [],
    "10_Report_Outputs": [],
    "11_Evidence_Register": SYNTH_EVIDENCE,
    "12_Regulatory_Refs": [],
  };
  for (const name of EXPECTED_SHEETS) {
    if (name === opts.omitSheet) continue;
    let ws: XLSX.WorkSheet;
    if (name === "13_Dashboard") {
      ws = XLSX.utils.aoa_to_sheet([["Dashboard"], ["SYNTHETIC"], ["Metric", "Value", "Unit", "Governance position"], ...(opts.dashboardClaims ?? []).map(([k, v]) => [k, v, null, null])]);
    } else {
      const headers = REQUIRED_HEADERS[name];
      ws = sheetFromObjects(name, headers, data[name] ?? []);
      for (const [sheet, rowIdx, col, z] of opts.formats ?? []) {
        if (sheet !== name) continue;
        const ref = XLSX.utils.encode_cell({ r: 3 + rowIdx, c: headers.indexOf(col) });
        if (ws[ref]) ws[ref].z = z;
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  if (opts.inventory !== null) {
    XLSX.utils.book_append_sheet(wb, sheetFromObjects(INVENTORY_SHEET, INVENTORY_HEADERS, opts.inventory ?? [SYNTH_INVENTORY]), INVENTORY_SHEET);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function workbookToBuffer(wb: XLSX.WorkBook): ArrayBuffer {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
