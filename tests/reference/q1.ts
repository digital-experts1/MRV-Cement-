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

/**
 * TEST ASSUMPTIONS pending owner confirmation (Directive 06B §3) — not facts about the source:
 *  - Q1-A1 fuel aggregation: the 05 rows dated 31 March are Q1 totals (quarter evidence IDs), not March totals.
 *  - Q1-A2 carbonate unit: values under "CaCO3 %"/"MgCO3 %" are fractions (0.95 = 95 %), as the workbook formula uses them.
 *  - Q1-A3 mass basis: quantities are used as entered (dry basis declared), as the workbook formula does not deduct moisture.
 */
export const Q1_ASSUMPTIONS = [
  { id: "Q1-A1", subject: "Fuel aggregation", assumption: "05_Kiln_Fuel_Input rows are calendar-Q1 totals", status: "pending owner confirmation" },
  { id: "Q1-A2", subject: "Carbonate unit", assumption: "CaCO3/MgCO3 values are fractions despite the % header", status: "pending owner confirmation" },
  { id: "Q1-A3", subject: "Raw-material mass basis", assumption: "Quantity is dry mass (no moisture deduction)", status: "pending owner confirmation" },
] as const;
export const Q1_UNITS_DECLARED = ";carbonate=fraction;massBasis=dry";
/**
 * Source-specific requirement, read here independently of lib/mrv/sourceProfiles.ts: the "Cement_QAQC_V28_Demo" workbook's
 * Method A formula contradicts its % headers, so carbonate unit and mass basis must be declared explicitly.
 */
const requiredUnitsOf = (mode: unknown): ("carbonate" | "massBasis")[] => (String(mode ?? "").trim() === "Cement_QAQC_V28_Demo" ? ["carbonate", "massBasis"] : []);

/**
 * Named, versioned carbonate factor scenarios — kept separate, never mixed:
 *  - WORKBOOK-REPRO/Q1-DEMO/v1: the workbook's own factors (0.44, 0.522) — only to reproduce its cached value;
 *  - STOICH-ROUNDED-MM/v1: the engine's factor set (ratios of molar masses rounded to 2 dp; not "exact").
 * Neither is a production methodology selection; that requires a documented technical basis.
 */
export const FACTOR_SCENARIOS = {
  "WORKBOOK-REPRO/Q1-DEMO/v1": { caco3: "0.44", mgco3: "0.522", basis: "07_Constants of the DEMO workbook" },
  "STOICH-ROUNDED-MM/v1": { caco3: new Decimal("44.01").div("100.09").toString(), mgco3: new Decimal("44.01").div("84.31").toString(), basis: "CO2 44.01 / CaCO3 100.09 / MgCO3 84.31 (2 dp)" },
} as const;

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
    requiredUnits: requiredUnitsOf(setup["Workbook mode"]),
  };

  // Application path (real import path). Without the required unit declaration the import is rejected; with it, it runs.
  const parsed = parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, Q1_FILE);
  const cfg = Object.fromEntries(toConfigDrafts(parsed.inputs).map((d) => [d.kind, d.content]));
  const runApp = (mapping: string) => {
    const drafts = toReadingDrafts(parsed.inputs, parseMapping(mapping), Q1_FILE);
    const stored: StoredReading[] = drafts.readings.map((d, i) => ({ ...d, id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}` }));
    const sel = selectForRange(stored, "2025-01-01", "2025-03-31");
    const input = scopeInputToRange(rebuildInput(sel.included, cfg, parsed.inputs.meta), { start: "2025-01-01", end: "2025-03-31", label: "Calendar Q1 2025" });
    const store = calculateStore(input, "workbook");
    const app: Record<string, number | null> = {};
    for (const r of store.calcRows) app[String(r.Metric)] = typeof r.Value === "number" ? r.Value : null;
    return { drafts, sel, store, app };
  };
  const undeclaredErrors = toReadingDrafts(parsed.inputs, parseMapping(Q1_MAPPING), Q1_FILE).errors;
  const declared = runApp(Q1_MAPPING + Q1_UNITS_DECLARED);
  const { drafts, sel, store } = declared;
  const withWorkbook = (rowsIn: ReturnType<typeof discrepancyRegister>) =>
    rowsIn.map((r) => {
      const w = workbook[r.metric];
      return { ...r, workbook: typeof w === "number" ? new Decimal(w).toSignificantDigits(15).toString() : (w ?? null) };
    });
  const register = withWorkbook(discrepancyRegister({ ...ref, units: { carbonate: "fraction", massBasis: "dry" } }, declared.app));
  const undeclaredRef = discrepancyRegister(ref, {}).find((r) => r.metric === "Process CO2 Method A")!.reference;

  // Method A in the workbook's formula form (Σ Qty × (CaCO3 × f1 + MgCO3 × f2); fractions per Q1-A2, as-entered mass per Q1-A3)
  // under each named factor scenario. The engine additionally applies the row's Calcination Conversion (see register).
  const scenarioA = (caF: string, mgF: string) =>
    ref.rawMaterial.reduce((acc, r) => acc.plus(new Decimal(Number(r["Quantity t"])).mul(new Decimal(Number(r["CaCO3 %"])).mul(caF).plus(new Decimal(Number(r["MgCO3 %"])).mul(mgF)))), new Decimal(0));

  return {
    labelledDemo: String(setup["Workbook mode"] ?? "").includes("Demo"),
    mapping: Q1_MAPPING,
    requiredUnits: ref.requiredUnits,
    undeclaredErrors,
    undeclaredReferenceMethodA: undeclaredRef,
    undeclaredDirectMethodA: parsed.calculations["Process CO2 Method A"]?.Value ?? null,
    mappingErrors: drafts.errors,
    readings: drafts.readings.map((d) => ({ sheet: d.source_ref.sheet, row: d.source_ref.row, section: d.section, interval: `${d.interval_start}..${d.interval_end}`, basis: d.interval_basis })),
    excluded: sel.excluded.length,
    conflicts: sel.conflicts.length,
    inputIssues: store.inputIssues,
    qa: store.qaqc.map((q) => ({ id: q["Check ID"], status: q.Status, result: q.Result })),
    register,
    declaredRawRows: declared.store.rawMaterial.map((r) => ({ unit: r["Carbonate Unit"], basis: r["Mass Basis"], version: r["Unit Mapping Version"], caSource: r["CaCO3 %"], caFraction: r["CaCO3 Fraction"] })),
    assumptions: Q1_ASSUMPTIONS,
    methodAScenarios: {
      workbookCached: workbook["Process CO2 Method A"] ?? null,
      "WORKBOOK-REPRO/Q1-DEMO/v1": scenarioA(FACTOR_SCENARIOS["WORKBOOK-REPRO/Q1-DEMO/v1"].caco3, FACTOR_SCENARIOS["WORKBOOK-REPRO/Q1-DEMO/v1"].mgco3).toString(),
      "STOICH-ROUNDED-MM/v1": scenarioA(FACTOR_SCENARIOS["STOICH-ROUNDED-MM/v1"].caco3, FACTOR_SCENARIOS["STOICH-ROUNDED-MM/v1"].mgco3).toSignificantDigits(12).toString(),
      applicationDeclared: declared.app["Process CO2 Method A"],
    },
  };
}
