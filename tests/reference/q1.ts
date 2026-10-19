/**
 * Q1 2025 reconciliation of the supplied collection workbook (server/test only — reads the fixture from disk).
 *
 * Three independent columns per metric:
 *   - workbook:    the workbook's own cached formula results (08_Calculations column C) — comparison only;
 *   - reference:   tests/reference/reference.ts on rows read here directly with SheetJS (no lib/parser, no engine);
 *   - application: the real import path — parseWorkbook → toReadingDrafts(explicit per-sheet mapping) → rebuildInput →
 *                  scopeInputToRange(Q1) → calculateStore.
 *
 * The workbook is labelled DEMO. Nothing here validates real plant data.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import * as XLSX from "xlsx";
import { calculateStore } from "@/lib/calcEngine";
import { parseWorkbook } from "@/lib/parser";
import { parseMapping } from "@/lib/mrv/importMapping";
import { rebuildInput, toConfigDrafts, toReadingDrafts, type StoredReading } from "@/lib/mrv/readings";
import { scopeInputToRange } from "@/lib/mrv/snapshot";
import { selectForRange } from "@/lib/mrv/rangeSelection";
import { discrepancyRegister, type ReferenceInput } from "./reference";

export const Q1_FILE = "TRACE_FORCE_MRV_Cement_QAQC_V28_Collection_Workbook_v0_2.xlsx";
/**
 * Declared from the workbook's own documentation, not from dates: 03/04/06 rows are "Demo monthly row"s (one per month),
 * 05 rows carry quarter evidence IDs (EV-FUEL-*-Q1) and are Q1 totals even though dated 31 March.
 */
export const Q1_MAPPING = "default=calendar_month_of_date;kilnFuel=calendar_quarter_of_date";

const rows = (wb: XLSX.WorkBook, sheet: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheet], { range: 2, defval: null });

export function q1Reconciliation() {
  const bytes = readFileSync(join(process.cwd(), "tests", "fixtures", "q1-2025", Q1_FILE));

  // Workbook cached values + raw rows (independent read).
  const wb = XLSX.read(bytes);
  const workbook: Record<string, number | string | null> = {};
  for (const r of rows(wb, "08_Calculations")) if (r.Metric) workbook[String(r.Metric)] = (r.Value as number | string | null) ?? null;
  const setup: Record<string, unknown> = {};
  for (const r of rows(wb, "01_Setup")) if (r.Parameter) setup[String(r.Parameter)] = r.Value;
  const ref: ReferenceInput = {
    setup,
    production: rows(wb, "03_Production_Input"),
    rawMaterial: rows(wb, "04_Raw_Material_Input"),
    kilnFuel: rows(wb, "05_Kiln_Fuel_Input"),
    electricity: rows(wb, "06_Electricity_Input"),
    inventory: [],
    constants: rows(wb, "07_Constants_EF_NCV").filter((r) => r["Constant / Factor"]),
  };

  // Application path.
  const parsed = parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, Q1_FILE);
  const drafts = toReadingDrafts(parsed.inputs, parseMapping(Q1_MAPPING), Q1_FILE);
  const stored: StoredReading[] = drafts.readings.map((d, i) => ({ ...d, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
  const sel = selectForRange(stored, "2025-01-01", "2025-03-31");
  const cfg = Object.fromEntries(toConfigDrafts(parsed.inputs).map((d) => [d.kind, d.content]));
  const input = scopeInputToRange(rebuildInput(sel.included, cfg, parsed.inputs.meta), { start: "2025-01-01", end: "2025-03-31", label: "Calendar Q1 2025" });
  const store = calculateStore(input, "workbook");
  const app: Record<string, number | null> = {};
  for (const r of store.calcRows) app[String(r.Metric)] = typeof r.Value === "number" ? r.Value : null;

  const register = discrepancyRegister(ref, app).map((r) => {
    const w = workbook[r.metric];
    return { ...r, workbook: typeof w === "number" ? new Decimal(w).toSignificantDigits(15).toString() : (w ?? null) };
  });

  // Method A as the workbook computes it (fractions × its 0.44 / 0.522 factors) vs stoichiometric ratios — for the unit note.
  const fractionA = (caF: string, mgF: string) =>
    ref.rawMaterial.reduce((acc, r) => acc.plus(new Decimal(Number(r["Quantity t"])).mul(new Decimal(Number(r["CaCO3 %"])).mul(caF).plus(new Decimal(Number(r["MgCO3 %"])).mul(mgF)))), new Decimal(0));

  return {
    labelledDemo: String(setup["Workbook mode"] ?? "").includes("Demo"),
    mapping: Q1_MAPPING,
    mappingErrors: drafts.errors,
    readings: drafts.readings.map((d) => ({ sheet: d.source_ref.sheet, row: d.source_ref.row, section: d.section, interval: `${d.interval_start}..${d.interval_end}`, basis: d.interval_basis })),
    excluded: sel.excluded.length,
    conflicts: sel.conflicts.length,
    inputIssues: store.inputIssues,
    qa: store.qaqc.map((q) => ({ id: q["Check ID"], status: q.Status, result: q.Result })),
    register,
    methodANote: {
      workbookCached: workbook["Process CO2 Method A"] ?? null,
      asFractionWithWorkbookFactors: fractionA("0.44", "0.522").toString(),
      asFractionWithStoichiometricRatios: fractionA(new Decimal("44.01").div("100.09").toString(), new Decimal("44.01").div("84.31").toString()).toSignificantDigits(12).toString(),
    },
  };
}
