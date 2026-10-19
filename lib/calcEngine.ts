import Decimal from "decimal.js";
import { computeCompleteness, computeReadiness } from "./completeness";
import { contentRevision } from "./hash";
import { parseStrictNumber } from "./numeric";
import { runQaChecks } from "./qaChecks";
import { missingRequiredUnits, sourceProfileOf } from "./mrv/sourceProfiles";
import type { UnitKey } from "./mrv/unitMapping";
import {
  createEmptyInput,
  type DataOrigin,
  type InputIssue,
  type MrvInput,
  type OverallQaStatus,
  type RowSource,
  type SheetRow,
  type Store,
} from "./types";

export type Dec = Decimal | null;

export interface FuelDefaultFactor {
  ncv: number;
  ncvUnit: string;
  ef: number;
  efUnit: string;
  ox: number;
  biomass: number;
  notes: string;
}

/** Reference defaults offered in manual entry. Selecting a fuel copies these explicitly into the row; they are never applied silently. */
export const DEFAULT_FUEL_FACTORS: Record<string, FuelDefaultFactor> = {
  Petcoke:     { ncv: 32.5,  ncvUnit: "GJ/t", ef: 97.5, efUnit: "tCO2/TJ", ox: 0.99,  biomass: 0.00, notes: "High-carbon kiln fuel" },
  Coal:        { ncv: 25.8,  ncvUnit: "GJ/t", ef: 94.6, efUnit: "tCO2/TJ", ox: 0.99,  biomass: 0.00, notes: "Fossil solid fuel" },
  RDF:         { ncv: 17.0,  ncvUnit: "GJ/t", ef: 85.0, efUnit: "tCO2/TJ", ox: 0.98,  biomass: 0.50, notes: "Refuse derived fuel with 50% biomass" },
  "Tyre Chips":{ ncv: 31.4,  ncvUnit: "GJ/t", ef: 85.0, efUnit: "tCO2/TJ", ox: 0.98,  biomass: 0.27, notes: "Tyre chips with 27% natural rubber biomass" },
  "Natural Gas":{ ncv: 0.048, ncvUnit: "GJ/Nm3", ef: 56.1, efUnit: "tCO2/TJ", ox: 0.995, biomass: 0.00, notes: "Gaseous kiln fuel" },
  Diesel:      { ncv: 43.0,  ncvUnit: "GJ/t", ef: 74.1, efUnit: "tCO2/TJ", ox: 0.99,  biomass: 0.00, notes: "Startup/backup liquid fuel" },
};

export const CLINKER_EF_CONSTANT = "Selected clinker process EF";

const REVIEW = "Default – review required";
export const DEFAULT_CONSTANTS: SheetRow[] = [
  { "Constant / Factor": CLINKER_EF_CONSTANT,      Value: 0.5325, Unit: "tCO2/t clinker", "Source / rationale": "IPCC default for 65% CaO in clinker", "Used in": "08_Calculations", "Change control": "Controlled", Status: REVIEW, "Source URL": "https://www.ipcc-nggip.iges.or.jp/" },
  { "Constant / Factor": "CaCO3 molar mass ratio", Value: 0.4397, Unit: "tCO2/t CaCO3",   "Source / rationale": "Stoichiometric 44.01/100.09 (molar masses rounded to 2 dp); reference only — the engine uses factor set STOICH-ROUNDED-MM/v1", "Used in": "04_Raw_Material_Input", "Change control": "Fixed chemistry", Status: "Fixed chemistry", "Source URL": "" },
  { "Constant / Factor": "MgCO3 molar mass ratio", Value: 0.5220, Unit: "tCO2/t MgCO3",   "Source / rationale": "Stoichiometric 44.01/84.31 (molar masses rounded to 2 dp); reference only — the engine uses factor set STOICH-ROUNDED-MM/v1", "Used in": "04_Raw_Material_Input", "Change control": "Fixed chemistry", Status: "Fixed chemistry", "Source URL": "" },
  { "Constant / Factor": "Grid EF Egypt Q1 2025",  Value: 0.4878, Unit: "tCO2/MWh",       "Source / rationale": "Placeholder baseline – source document not yet attached", "Used in": "06_Electricity_Input", "Change control": "Annual/Controlled", Status: REVIEW, "Source URL": "" },
  ...([
    ["Clinker factor min QA", 0.25, "ratio"], ["Clinker factor max QA", 1.0, "ratio"],
    ["SEE clinker min QA", 0.5, "tCO2/t clinker"], ["SEE clinker max QA", 1.2, "tCO2/t clinker"],
    ["SEE cement min QA", 0.2, "tCO2/t cement"], ["SEE cement max QA", 1.2, "tCO2/t cement"],
    ["SHC min QA", 2.8, "GJ/t clinker"], ["SHC max QA", 4.5, "GJ/t clinker"],
    ["TSR min QA", 0, "%"], ["TSR max QA", 80, "%"],
  ] as const).map(([name, value, unit]) => ({
    "Constant / Factor": name, Value: value, Unit: unit, "Source / rationale": "Internal plausibility bound", "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Internal QA bound", "Source URL": "",
  })),
];

// ── Decimal helpers: any missing operand yields null (never zero). ──

export function sumAll(values: Dec[]): Dec {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return values.reduce<Decimal>((acc, v) => acc.plus(v as Decimal), new Decimal(0));
}

function mulAll(...values: Dec[]): Dec {
  if (values.some((v) => v === null)) return null;
  return values.reduce<Decimal>((acc, v) => acc.mul(v as Decimal), new Decimal(1));
}

function add(a: Dec, b: Dec): Dec {
  return a === null || b === null ? null : a.plus(b);
}

function div(a: Dec, b: Dec): Dec {
  if (a === null || b === null || b.isZero()) return null;
  return a.div(b);
}

export function out(d: Dec): number | null {
  return d === null ? null : d.toNumber();
}

function rowRef(row: SheetRow, idx: number): number {
  return (row._source as RowSource | undefined)?.row ?? idx + 1;
}

function readNum(row: SheetRow, field: string, section: string, idx: number, issues: InputIssue[]): Dec {
  const parsed = parseStrictNumber(row[field]);
  if (parsed.kind === "ok") return parsed.value;
  if (parsed.kind === "invalid") {
    issues.push({ section, row: rowRef(row, idx), field, raw: row[field], reason: parsed.reason });
  }
  return null;
}

export interface RowCalc {
  row: SheetRow;
  d: Record<string, Dec>;
  missing: string[];
}

function finishRow(row: SheetRow, d: Record<string, Dec>, required: string[], status: string): RowCalc {
  const missing = required.filter((k) => d[k] === null);
  const outRow: SheetRow = { ...row };
  for (const [k, v] of Object.entries(d)) outRow[k] = out(v);
  outRow["QA Status"] = missing.length > 0 ? "INCOMPLETE" : status;
  outRow._missing = missing;
  return { row: outRow, d, missing };
}

export function calcProductionRow(row: SheetRow, issues: InputIssue[] = [], idx = 0): RowCalc {
  const S = "03_Production_Input";
  const f = (k: string) => readNum(row, k, S, idx, issues);
  const d: Record<string, Dec> = {
    "Clinker Produced t": f("Clinker Produced t"),
    "Cement Produced t": f("Cement Produced t"),
    "Clinker Used t": f("Clinker Used t"),
    "Gypsum t": f("Gypsum t"),
    "Limestone Additive t": f("Limestone Additive t"),
    "Other Additives t": f("Other Additives t"),
  };
  d["Clinker Factor"] = div(d["Clinker Used t"], d["Cement Produced t"]);
  const cf = d["Clinker Factor"];
  const status = cf !== null && cf.gte(0.25) && cf.lte(1) ? "PASS" : "WARNING";
  return finishRow(row, d, ["Clinker Produced t", "Cement Produced t", "Clinker Used t"], status);
}

/**
 * Carbonate factor set used by the engine (Directive 06B §3). Stoichiometric CO2/carbonate mass ratios computed from molar
 * masses rounded to two decimals (CO2 44.01, CaCO3 100.09, MgCO3 84.31) — not "exact", and not a production methodology
 * decision: selecting a factor set for production requires a documented technical basis.
 */
export const CARBONATE_FACTOR_SET = "STOICH-ROUNDED-MM/v1";
const CACO3_RATIO = new Decimal("44.01").div("100.09");
const MGCO3_RATIO = new Decimal("44.01").div("84.31");

const unitOf = (row: SheetRow, col: string) => String(row[col] ?? "").trim().toLowerCase();

/** Converts a share value under an explicit (or header) unit to a fraction; out-of-range values contradict the unit. */
function toFraction(v: Dec, unit: string, field: string, row: SheetRow, idx: number, S: string, issues: InputIssue[]): Dec {
  if (v === null) return null;
  const max = unit === "fraction" ? 1 : 100;
  if (v.lt(0) || v.gt(max)) {
    issues.push({ section: S, row: rowRef(row, idx), field, raw: row[field], reason: `value contradicts its unit (${unit === "fraction" ? "declared fraction: 0–1" : unit === "percent" ? "declared percent: 0–100" : "column header %: 0–100"}); not converted` });
    return null;
  }
  return unit === "fraction" ? v : v.div(100);
}

/** `required`: units the row's source must declare explicitly (lib/mrv/sourceProfiles.ts); without them nothing is converted. */
export function calcRawMaterialRow(row: SheetRow, issues: InputIssue[] = [], idx = 0, required: UnitKey[] = []): RowCalc {
  const S = "04_Raw_Material_Input";
  const f = (k: string) => readNum(row, k, S, idx, issues);
  const d: Record<string, Dec> = {
    "Quantity t": f("Quantity t"),
    "CaCO3 %": f("CaCO3 %"),
    "MgCO3 %": f("MgCO3 %"),
    "Moisture %": f("Moisture %"),
    "Calcination Conversion": f("Calcination Conversion"),
  };
  // Original values stay in their source columns; conversions go to separate fields (unit mapping: lib/mrv/unitMapping.ts).
  const carb = unitOf(row, "Carbonate Unit");
  const moist = unitOf(row, "Moisture Unit");
  const basis = unitOf(row, "Mass Basis");
  for (const [col, val, allowed] of [["Carbonate Unit", carb, ["percent", "fraction"]], ["Moisture Unit", moist, ["percent", "fraction"]], ["Mass Basis", basis, ["dry", "wet"]]] as const) {
    if (val && !(allowed as readonly string[]).includes(val)) issues.push({ section: S, row: rowRef(row, idx), field: col, raw: row[col], reason: `unrecognised unit "${val}"` });
  }
  // Explicit unit → used; undeclared → the column header (%) governs, unless the source requires a declaration.
  const unitFor = (v: string, key: UnitKey) => (v === "percent" || v === "fraction" ? v : v || required.includes(key) ? null : "header");
  const carbUnit = unitFor(carb, "carbonate");
  d["CaCO3 Fraction"] = carbUnit ? toFraction(d["CaCO3 %"], carbUnit, "CaCO3 %", row, idx, S, issues) : null;
  d["MgCO3 Fraction"] = carbUnit ? toFraction(d["MgCO3 %"], carbUnit, "MgCO3 %", row, idx, S, issues) : null;
  if (basis === "wet") {
    const mUnit = unitFor(moist, "moisture");
    const m = mUnit ? toFraction(d["Moisture %"], mUnit, "Moisture %", row, idx, S, issues) : null;
    d["Dry Quantity t"] = d["Quantity t"] === null || m === null ? null : d["Quantity t"].mul(new Decimal(1).minus(m));
  } else if (basis === "dry") {
    d["Dry Quantity t"] = d["Quantity t"];
  } else {
    // Undeclared mass basis: the quantity is used as entered (moisture not deducted) and QA check CP-03 flags it —
    // unless the source requires the basis to be declared.
    d["Dry Quantity t"] = basis || required.includes("massBasis") ? null : d["Quantity t"];
  }
  d["CaCO3 CO2 t"] = mulAll(d["Dry Quantity t"], d["CaCO3 Fraction"], CACO3_RATIO, d["Calcination Conversion"]);
  d["MgCO3 CO2 t"] = mulAll(d["Dry Quantity t"], d["MgCO3 Fraction"], MGCO3_RATIO, d["Calcination Conversion"]);
  d["Process CO2 Method A t"] = add(d["CaCO3 CO2 t"], d["MgCO3 CO2 t"]);
  const co2 = d["Process CO2 Method A t"];
  const status = co2 !== null && co2.gt(0) ? "PASS" : "WARNING";
  const calc = finishRow(row, d, ["Quantity t", "CaCO3 %", "MgCO3 %", "Calcination Conversion", "CaCO3 Fraction", "MgCO3 Fraction", "Dry Quantity t"], status);
  const requiredMissing = (key: UnitKey) => required.includes(key) ? "undeclared — required by the source; not converted" : null;
  calc.row["Carbonate Unit Basis"] = carbUnit === "header" ? "column header (%), undeclared" : carbUnit ?? (carb ? "unrecognised" : requiredMissing("carbonate"));
  calc.row["Mass Basis Applied"] = basis || requiredMissing("massBasis") || "undeclared (quantity as entered)";
  calc.row["Carbonate Factor Set"] = CARBONATE_FACTOR_SET;
  return calc;
}

/**
 * Source-unit semantics of the raw-material section. Values never establish a contradiction on their own; `unresolved`
 * counts rows lacking a declaration that their source profile requires (lib/mrv/sourceProfiles.ts). Method A is not
 * calculated while any row is unresolved.
 */
export function carbonateSemantics(rows: SheetRow[], setup: Record<string, unknown>) {
  const profile = sourceProfileOf(setup);
  return {
    rows: rows.length,
    undeclaredCarbonate: rows.filter((r) => !unitOf(r, "Carbonate Unit")).length,
    undeclaredMassBasis: rows.filter((r) => !unitOf(r, "Mass Basis")).length,
    unresolved: rows.filter((r) => missingRequiredUnits(r, profile).length > 0).length,
    profile,
  };
}

export function isAlternativeFuel(fuelType: unknown, biomass: Dec): boolean {
  const type = String(fuelType ?? "").toLowerCase();
  return type.includes("rdf") || type.includes("tyre") || type.includes("biomass") || (biomass !== null && biomass.gt(0));
}

export function calcFuelRow(row: SheetRow, issues: InputIssue[] = [], idx = 0): RowCalc {
  const S = "05_Kiln_Fuel_Input";
  const f = (k: string) => readNum(row, k, S, idx, issues);
  const d: Record<string, Dec> = {
    Quantity: f("Quantity"),
    "NCV GJ/unit": f("NCV GJ/unit"),
    "EF tCO2/TJ": f("EF tCO2/TJ"),
    "Oxidation Factor": f("Oxidation Factor"),
    "Biomass Fraction": f("Biomass Fraction"),
  };
  const bio = d["Biomass Fraction"];
  d["Fossil Fraction"] = bio === null ? null : Decimal.max(0, new Decimal(1).minus(bio));
  d["Energy GJ"] = mulAll(d.Quantity, d["NCV GJ/unit"]);
  d["Energy TJ"] = div(d["Energy GJ"], new Decimal(1000));
  const base = mulAll(d["Energy TJ"], d["EF tCO2/TJ"], d["Oxidation Factor"]);
  d["Fossil CO2 t"] = mulAll(base, d["Fossil Fraction"]);
  d["Biogenic CO2 Memo t"] = mulAll(base, bio);
  const ok = [d.Quantity, d["NCV GJ/unit"], d["EF tCO2/TJ"]].every((v) => v !== null && v.gt(0));
  return finishRow(row, d, ["Quantity", "NCV GJ/unit", "EF tCO2/TJ", "Oxidation Factor", "Biomass Fraction"], ok ? "PASS" : "WARNING");
}

export function calcElectricityRow(row: SheetRow, issues: InputIssue[] = [], idx = 0): RowCalc {
  const S = "06_Electricity_Input";
  const f = (k: string) => readNum(row, k, S, idx, issues);
  const d: Record<string, Dec> = {
    "Grid MWh": f("Grid MWh"),
    "Grid EF tCO2/MWh": f("Grid EF tCO2/MWh"),
    "Self-generation MWh": f("Self-generation MWh"),
    "Self-generation EF": f("Self-generation EF"),
    "Renewable MWh": f("Renewable MWh"),
  };
  d["Grid CO2 t"] = mulAll(d["Grid MWh"], d["Grid EF tCO2/MWh"]);
  d["Self-generation CO2 t"] = mulAll(d["Self-generation MWh"], d["Self-generation EF"]);
  const ok = [d["Grid MWh"], d["Grid EF tCO2/MWh"]].every((v) => v !== null && v.gt(0));
  return finishRow(row, d, ["Grid MWh", "Grid EF tCO2/MWh"], ok ? "PASS" : "WARNING");
}

export function calcInventoryRow(row: SheetRow, issues: InputIssue[] = [], idx = 0): RowCalc {
  const S = "14_Inventory_Movements";
  const f = (k: string) => readNum(row, k, S, idx, issues);
  const d: Record<string, Dec> = {
    "Opening Stock t": f("Opening Stock t"),
    "Purchased t": f("Purchased t"),
    "Dispatched t": f("Dispatched t"),
    "Closing Stock t": f("Closing Stock t"),
  };
  return finishRow(row, d, ["Opening Stock t", "Purchased t", "Dispatched t", "Closing Stock t"], "RECORDED");
}

type InputLike = Partial<Omit<MrvInput, "meta">> & { meta?: Partial<MrvInput["meta"]> };

/** Fills defaults and deep-copies so the store keeps an immutable snapshot of the exact inputs used. */
export function normalizeInput(input: InputLike, fallbackOrigin: DataOrigin = "manual"): MrvInput {
  const base = createEmptyInput(input.meta?.origin ?? fallbackOrigin);
  const copy = structuredClone({ ...input, meta: undefined }) as Partial<MrvInput>;
  return {
    ...base,
    ...copy,
    meta: {
      origin: input.meta?.origin ?? fallbackOrigin,
      synthetic: Boolean(input.meta?.synthetic),
      filename: input.meta?.filename ?? null,
      importedAt: input.meta?.importedAt ?? null,
    },
    setup: { ...(copy.setup ?? {}) },
  };
}

function setupText(setup: Record<string, unknown>, key: string): string | null {
  const v = setup[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function selectedMethod(setup: Record<string, unknown>): "A" | "B" | null {
  const m = setupText(setup, "Selected calcination method") ?? "";
  if (m.includes("Method A")) return "A";
  if (m.includes("Method B")) return "B";
  return null;
}

export interface Aggregates {
  clinkerProduced: Dec;
  cementProduced: Dec;
  clinkerUsed: Dec;
  clinkerFactor: Dec;
  processCO2MethodA: Dec;
  clinkerProcessEF: Dec;
  processCO2MethodB: Dec;
  selectedProcessCO2: Dec;
  fuelCombustionCO2: Dec;
  biogenicCO2Memo: Dec;
  totalFuelEnergyGJ: Dec;
  altFuelEnergyGJ: Dec;
  shc: Dec;
  tsr: Dec;
  directEmbeddedCO2: Dec;
  gridMWh: Dec;
  indirectGridCO2: Dec;
  totalEmbeddedCO2: Dec;
  seeClinker: Dec;
  seeCement: Dec;
  clinkerStockpileDelta: Dec;
}

export interface EngineContext {
  input: MrvInput;
  production: RowCalc[];
  rawMaterial: RowCalc[];
  kilnFuel: RowCalc[];
  electricity: RowCalc[];
  inventory: RowCalc[];
  agg: Aggregates;
  method: "A" | "B" | null;
}

function aggregate(input: MrvInput, production: RowCalc[], rawMaterial: RowCalc[], kilnFuel: RowCalc[], electricity: RowCalc[], issues: InputIssue[]): Aggregates {
  const col = (rows: RowCalc[], k: string) => sumAll(rows.map((r) => r.d[k]));
  const clinkerProduced = col(production, "Clinker Produced t");
  const cementProduced = col(production, "Cement Produced t");
  const clinkerUsed = col(production, "Clinker Used t");
  // Units required by the source but not declared → Method A not calculated (never rescaled by guessing).
  const processCO2MethodA = carbonateSemantics(input.rawMaterial, input.setup).unresolved > 0 ? null : col(rawMaterial, "Process CO2 Method A t");

  const efIdx = input.constants.findIndex((r) => r["Constant / Factor"] === CLINKER_EF_CONSTANT);
  const clinkerProcessEF = efIdx >= 0 ? readNum(input.constants[efIdx], "Value", "07_Constants_EF_NCV", efIdx, issues) : null;
  const processCO2MethodB = mulAll(clinkerProduced, clinkerProcessEF);

  const method = selectedMethod(input.setup);
  const selectedProcessCO2 = method === "A" ? processCO2MethodA : method === "B" ? processCO2MethodB : null;

  const fuelCombustionCO2 = col(kilnFuel, "Fossil CO2 t");
  const biogenicCO2Memo = col(kilnFuel, "Biogenic CO2 Memo t");
  const totalFuelEnergyGJ = col(kilnFuel, "Energy GJ");
  const altFuelEnergyGJ =
    totalFuelEnergyGJ === null
      ? null
      : sumAll(kilnFuel.map((r) => (isAlternativeFuel(r.row["Fuel Type"], r.d["Biomass Fraction"]) ? r.d["Energy GJ"] : new Decimal(0))));

  const directEmbeddedCO2 = add(selectedProcessCO2, fuelCombustionCO2);
  const gridMWh = col(electricity, "Grid MWh");
  const indirectGridCO2 = col(electricity, "Grid CO2 t");
  const totalEmbeddedCO2 = add(directEmbeddedCO2, indirectGridCO2);

  return {
    clinkerProduced,
    cementProduced,
    clinkerUsed,
    clinkerFactor: div(clinkerUsed, cementProduced),
    processCO2MethodA,
    clinkerProcessEF,
    processCO2MethodB,
    selectedProcessCO2,
    fuelCombustionCO2,
    biogenicCO2Memo,
    totalFuelEnergyGJ,
    altFuelEnergyGJ,
    shc: div(totalFuelEnergyGJ, clinkerProduced),
    tsr: mulAll(div(altFuelEnergyGJ, totalFuelEnergyGJ), new Decimal(100)),
    directEmbeddedCO2,
    gridMWh,
    indirectGridCO2,
    totalEmbeddedCO2,
    seeClinker: div(directEmbeddedCO2, clinkerProduced),
    seeCement: div(totalEmbeddedCO2, cementProduced),
    clinkerStockpileDelta: clinkerProduced === null || clinkerUsed === null ? null : clinkerProduced.minus(clinkerUsed),
  };
}

function evidenceStatus(input: MrvInput): string {
  if (input.evidence.length === 0) return "Missing";
  return input.evidence.every((r) => r.Status === "Mapped") ? "Mapped (not externally verified)" : "Partial";
}

function overallStatus(statuses: string[]): OverallQaStatus {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("NOT_EVALUATED")) return "INCOMPLETE";
  if (statuses.includes("WARNING")) return "WARNING";
  return "PASS";
}

/**
 * The single authoritative calculation path. Workbook imports, manual entry, demo data and data-package
 * re-imports all pass their raw inputs here. Workbook totals/statuses are never read by this function.
 */
export function calculateStore(inputLike: InputLike, fallbackOrigin: DataOrigin = "manual"): Store {
  const input = normalizeInput(inputLike, fallbackOrigin);
  const issues: InputIssue[] = [];

  const production = input.production.map((r, i) => calcProductionRow(r, issues, i));
  const requiredUnits = sourceProfileOf(input.setup)?.requiredUnits ?? [];
  const rawMaterial = input.rawMaterial.map((r, i) => calcRawMaterialRow(r, issues, i, requiredUnits));
  const kilnFuel = input.kilnFuel.map((r, i) => calcFuelRow(r, issues, i));
  const electricity = input.electricity.map((r, i) => calcElectricityRow(r, issues, i));
  const inventory = input.inventory.map((r, i) => calcInventoryRow(r, issues, i));
  const agg = aggregate(input, production, rawMaterial, kilnFuel, electricity, issues);
  const method = selectedMethod(input.setup);
  const ctx: EngineContext = { input, production, rawMaterial, kilnFuel, electricity, inventory, agg, method };

  const v = (d: Dec) => out(d);
  const evStatus = evidenceStatus(input);
  const methodLabel = setupText(input.setup, "Selected calcination method");

  const calcRows: SheetRow[] = [
    { Metric: "Clinker Produced", "Formula / Link": "Σ 03_Production_Input[Clinker Produced t]", Value: v(agg.clinkerProduced), Unit: "t", "Governance note": "Selected period production total", "QA Source": "Production_Input" },
    { Metric: "Cement Produced", "Formula / Link": "Σ 03_Production_Input[Cement Produced t]", Value: v(agg.cementProduced), Unit: "t", "Governance note": "Selected period cement output", "QA Source": "Production_Input" },
    { Metric: "Clinker Used in Cement", "Formula / Link": "Σ 03_Production_Input[Clinker Used t]", Value: v(agg.clinkerUsed), Unit: "t", "Governance note": "Used for clinker factor", "QA Source": "Production_Input" },
    { Metric: "Clinker Factor", "Formula / Link": "Clinker Used ÷ Cement Produced", Value: v(agg.clinkerFactor), Unit: "ratio", "Governance note": "Clinker content divided by cement production", "QA Source": "Production_Input" },
    { Metric: "Process CO2 Method A", "Formula / Link": "Σ dry Qty × (CaCO3 fraction × 44.01/100.09 + MgCO3 fraction × 44.01/84.31) × conversion", Value: v(agg.processCO2MethodA), Unit: "tCO2", "Governance note": `Input-based carbonate pathway; factor set ${CARBONATE_FACTOR_SET} (ratios from rounded molar masses); units per declared source-unit mapping`, "QA Source": "Raw_Material_Input" },
    { Metric: "Process CO2 Method B", "Formula / Link": `Clinker Produced × ${CLINKER_EF_CONSTANT}`, Value: v(agg.processCO2MethodB), Unit: "tCO2", "Governance note": "Output-based clinker pathway", "QA Source": "Constants" },
    { Metric: "Selected Process CO2", "Formula / Link": "Method selected in Setup (no default)", Value: v(agg.selectedProcessCO2), Unit: "tCO2", "Governance note": `Method: ${methodLabel ?? "not selected"}`, "QA Source": "Setup" },
    { Metric: "Fuel Combustion CO2", "Formula / Link": "Σ Energy TJ × EF × Ox × (1 − biomass)", Value: v(agg.fuelCombustionCO2), Unit: "tCO2", "Governance note": "Fossil combustion only", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Biogenic CO2 Memo", "Formula / Link": "Σ Energy TJ × EF × Ox × biomass", Value: v(agg.biogenicCO2Memo), Unit: "tCO2", "Governance note": "Reported separately; not counted in fossil direct CO2", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Direct Embedded CO2", "Formula / Link": "Selected Process CO2 + Fuel Combustion CO2", Value: v(agg.directEmbeddedCO2), Unit: "tCO2", "Governance note": "Process + fossil fuel combustion", "QA Source": "Calculations" },
    { Metric: "Grid Electricity MWh", "Formula / Link": "Σ 06_Electricity_Input[Grid MWh]", Value: v(agg.gridMWh), Unit: "MWh", "Governance note": "Purchased grid electricity", "QA Source": "Electricity_Input" },
    { Metric: "Indirect Grid CO2", "Formula / Link": "Σ Grid MWh × Grid EF", Value: v(agg.indirectGridCO2), Unit: "tCO2", "Governance note": "Grid electricity × grid EF", "QA Source": "Electricity_Input" },
    { Metric: "Total Embedded CO2", "Formula / Link": "Direct Embedded CO2 + Indirect Grid CO2", Value: v(agg.totalEmbeddedCO2), Unit: "tCO2", "Governance note": "Direct + indirect grid CO2", "QA Source": "Calculations" },
    { Metric: "SEE Clinker", "Formula / Link": "Direct Embedded CO2 ÷ Clinker Produced", Value: v(agg.seeClinker), Unit: "tCO2/t clinker", "Governance note": "Direct embedded emissions per tonne clinker", "QA Source": "Calculations" },
    { Metric: "Specific Embedded Emissions Cement", "Formula / Link": "Total Embedded CO2 ÷ Cement Produced", Value: v(agg.seeCement), Unit: "tCO2/t cement", "Governance note": "Final cement product intensity", "QA Source": "Calculations" },
    { Metric: "Specific Heat Consumption", "Formula / Link": "Total Fuel Energy GJ ÷ Clinker Produced", Value: v(agg.shc), Unit: "GJ/t clinker", "Governance note": "Fuel energy per tonne clinker", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Evidence Status", "Formula / Link": "Evidence register mapping status", Value: evStatus, Unit: "status", "Governance note": "Mapping only — not external verification", "QA Source": "Evidence_Register" },
    { Metric: "Clinker Stockpile Delta", "Formula / Link": "Clinker Produced − Clinker Used", Value: v(agg.clinkerStockpileDelta), Unit: "t", "Governance note": "Reconciled only when inventory movements are supplied (MB-04)", "QA Source": "Production_Input" },
    { Metric: "Total Fuel Energy", "Formula / Link": "Σ Quantity × NCV", Value: v(agg.totalFuelEnergyGJ), Unit: "GJ", "Governance note": "Sum of all fuel thermal energy", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Alt Fuel Energy", "Formula / Link": "Σ energy of alternative & biomass fuels", Value: v(agg.altFuelEnergyGJ), Unit: "GJ", "Governance note": "RDF + Tyre Chips + Biomass energy", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Thermal Substitution Rate (TSR)", "Formula / Link": "Alt Fuel Energy ÷ Total Fuel Energy × 100", Value: v(agg.tsr), Unit: "%", "Governance note": "Alt fuel energy as % of total fuel energy", "QA Source": "Calculations" },
  ];

  const qaqc = runQaChecks(ctx);
  const overallQA = overallStatus(qaqc.map((r) => String(r.Status)));
  const passCount = qaqc.filter((r) => r.Status === "PASS").length;
  const qaPassPct = qaqc.length > 0 ? Math.floor((passCount / qaqc.length) * 100) : 0;
  calcRows.push({ Metric: "QA/QC Overall Status", "Formula / Link": "FAIL > INCOMPLETE (not evaluated) > WARNING > PASS", Value: overallQA, Unit: "status", "Governance note": "Computed by the platform; workbook statuses are comparison-only", "QA Source": "QAQC_Checks" });

  const completeness = computeCompleteness(input);
  const readiness = computeReadiness({ completeness, issues, qaqc, synthetic: input.meta.synthetic });

  const calculations: Record<string, SheetRow> = {};
  calcRows.forEach((r) => {
    calculations[String(r.Metric)] = r;
  });

  const s = setupText;
  const reportOutputs: SheetRow[] = [
    { "Output Field": "Quarter", Value: s(input.setup, "Reporting quarter"), Unit: null, Source: "Setup", "Report Label": "Reporting period", "Governance Position": "Selected-period lock" },
    { "Output Field": "Period Start", Value: s(input.setup, "Period start"), Unit: "date", Source: "Setup", "Report Label": "Period start", "Governance Position": "Selected-period lock" },
    { "Output Field": "Period End", Value: s(input.setup, "Period end"), Unit: "date", Source: "Setup", "Report Label": "Period end", "Governance Position": "Selected-period lock" },
    { "Output Field": "Product", Value: s(input.setup, "Primary product"), Unit: null, Source: "Setup", "Report Label": "Product selected", "Governance Position": "Product boundary" },
    { "Output Field": "Clinker Production", Value: v(agg.clinkerProduced), Unit: "t", Source: "Calculations", "Report Label": "Clinker production", "Governance Position": "Production boundary" },
    { "Output Field": "Cement Production", Value: v(agg.cementProduced), Unit: "t", Source: "Calculations", "Report Label": "Cement production", "Governance Position": "Product boundary" },
    { "Output Field": "Clinker Factor", Value: v(agg.clinkerFactor), Unit: "ratio", Source: "Calculations", "Report Label": "Clinker factor", "Governance Position": "Product allocation" },
    { "Output Field": "Process CO2", Value: v(agg.selectedProcessCO2), Unit: "tCO2", Source: "Calculations", "Report Label": "Process CO2", "Governance Position": "Direct embedded emissions" },
    { "Output Field": "Fuel Combustion CO2", Value: v(agg.fuelCombustionCO2), Unit: "tCO2", Source: "Calculations", "Report Label": "Fuel combustion CO2", "Governance Position": "Direct embedded emissions" },
    { "Output Field": "Biogenic CO2 Memo", Value: v(agg.biogenicCO2Memo), Unit: "tCO2", Source: "Calculations", "Report Label": "Biogenic CO2 memo", "Governance Position": "Reported separately; not counted" },
    { "Output Field": "Direct Embedded CO2", Value: v(agg.directEmbeddedCO2), Unit: "tCO2", Source: "Calculations", "Report Label": "Direct embedded CO2", "Governance Position": "Process + fossil combustion" },
    { "Output Field": "Grid Electricity MWh", Value: v(agg.gridMWh), Unit: "MWh", Source: "Calculations", "Report Label": "Purchased grid electricity", "Governance Position": "Indirect activity data" },
    { "Output Field": "Indirect Grid CO2", Value: v(agg.indirectGridCO2), Unit: "tCO2", Source: "Calculations", "Report Label": "Indirect grid CO2", "Governance Position": "Purchased electricity" },
    { "Output Field": "Total Embedded CO2", Value: v(agg.totalEmbeddedCO2), Unit: "tCO2", Source: "Calculations", "Report Label": "Total embedded CO2", "Governance Position": "Direct + indirect grid" },
    { "Output Field": "SEE Clinker", Value: v(agg.seeClinker), Unit: "tCO2/t clinker", Source: "Calculations", "Report Label": "SEE clinker", "Governance Position": "Clinker product intensity" },
    { "Output Field": "Specific Embedded Emissions Cement", Value: v(agg.seeCement), Unit: "tCO2/t cement", Source: "Calculations", "Report Label": "Specific embedded emissions", "Governance Position": "Final cement product intensity" },
    { "Output Field": "QA/QC Overall Status", Value: overallQA, Unit: "status", Source: "QAQC_Checks", "Report Label": "QA/QC status", "Governance Position": "Internal QA only" },
    { "Output Field": "Required Data Completeness", Value: completeness.pct, Unit: "%", Source: "Completeness", "Report Label": "Required data completeness", "Governance Position": "Separate from QA pass rate" },
    { "Output Field": "Readiness", Value: readiness.status, Unit: "status", Source: "Readiness", "Report Label": "Internal review readiness", "Governance Position": "Not external verification" },
    { "Output Field": "Evidence Status", Value: evStatus, Unit: "status", Source: "Evidence_Register", "Report Label": "Evidence mapping status", "Governance Position": "Mapping only — not external verification" },
    { "Output Field": "Specific Heat Consumption", Value: v(agg.shc), Unit: "GJ/t clinker", Source: "Calculations", "Report Label": "Specific heat consumption", "Governance Position": "Kiln thermal efficiency" },
    { "Output Field": "Thermal Substitution Rate", Value: v(agg.tsr), Unit: "%", Source: "Calculations", "Report Label": "TSR", "Governance Position": "Alt fuel energy share" },
  ];
  reportOutputs.forEach((r) => {
    r.outputField = r["Output Field"];
  });

  const total = agg.totalEmbeddedCO2;
  const components: [string, Dec][] = [
    ["Process CO2", agg.selectedProcessCO2],
    ["Fuel Combustion CO2", agg.fuelCombustionCO2],
    ["Indirect Grid CO2", agg.indirectGridCO2],
  ];
  const co2Breakdown =
    total !== null && total.gt(0)
      ? components.map(([component, t]) => ({ component, tCO2: (t as Decimal).toNumber(), share: (t as Decimal).div(total).toNumber() }))
      : [];

  const { meta: _meta, ...dataOnly } = input;
  void _meta;

  return {
    meta: {
      filename: input.meta.filename ?? (input.meta.origin === "manual" ? "Online entry" : null),
      uploadedAt: input.meta.importedAt ?? new Date().toISOString(),
      origin: input.meta.origin,
      synthetic: input.meta.synthetic,
      revision: contentRevision({ ...dataOnly, synthetic: input.meta.synthetic }),
    },
    readme: input.readme,
    setup: input.setup,
    setupRows: input.setupRows,
    dcsMap: input.dcsMap,
    production: production.map((r) => r.row),
    rawMaterial: rawMaterial.map((r) => r.row),
    kilnFuel: kilnFuel.map((r) => r.row),
    electricity: electricity.map((r) => r.row),
    inventory: inventory.map((r) => r.row),
    constants: input.constants,
    fuelDefaults: input.fuelDefaults,
    calculations,
    calcRows,
    qaqc,
    reportOutputs,
    evidence: input.evidence.map((r) => ({ ...r, evidenceId: r["Evidence ID"] })),
    regulatory: input.regulatory,
    dashboard: {
      co2Breakdown,
      kpis: {
        "Direct Embedded CO2": { value: v(agg.directEmbeddedCO2), unit: "tCO2", govPos: null },
        "Total Embedded CO2": { value: v(agg.totalEmbeddedCO2), unit: "tCO2", govPos: null },
        "SEE Cement": { value: v(agg.seeCement), unit: "tCO2/t cement", govPos: null },
      },
    },
    inputs: input,
    inputIssues: issues,
    assertions: [],
    completeness,
    readiness,
    qaPassPct,
    _valid: true,
    _errors: [],
  };
}
