import Decimal from "decimal.js";
import type { Dec, EngineContext, RowCalc } from "./calcEngine";
import { toIsoDate } from "./dates";
import type { CheckStatus, RowSource, SheetRow } from "./types";

interface CheckDef {
  id: string;
  category: string;
  name: string;
  rule: string;
  severity: "Fail" | "Warning";
  owner: string;
}

function check(def: CheckDef, status: CheckStatus, result: unknown, comment: string): SheetRow {
  return {
    "Check ID": def.id,
    Category: def.category,
    "Check Name": def.name,
    Rule: def.rule,
    Result: result,
    Status: status,
    Severity: def.severity,
    Owner: def.owner,
    Comment: comment,
  };
}

const n = (d: Dec) => (d === null ? "missing" : Number(d.toDecimalPlaces(4).toString()));

/** Range check on a single aggregate. Missing → NOT_EVALUATED, never PASS. */
function rangeCheck(def: CheckDef, value: Dec, min: number, max: number, outStatus: CheckStatus, label: string): SheetRow {
  if (value === null) return check(def, "NOT_EVALUATED", "missing", `${label} could not be calculated: required inputs missing`);
  const ok = value.gte(min) && value.lte(max);
  return check(def, ok ? "PASS" : outStatus, n(value), ok ? `${label} within ${min}–${max}` : `${label} outside ${min}–${max}`);
}

/** Every row must have the value present and > 0. No rows → NOT_EVALUATED. */
function populatedCheck(def: CheckDef, rows: RowCalc[], field: string): SheetRow {
  if (rows.length === 0) return check(def, "NOT_EVALUATED", "no rows", "No records supplied");
  const values = rows.map((r) => r.d[field]);
  const missing = values.filter((v) => v === null).length;
  const nonPositive = values.filter((v) => v !== null && v.lte(0)).length;
  if (missing > 0 || nonPositive > 0) {
    return check(def, "FAIL", missing > 0 ? `${missing} missing` : `${nonPositive} ≤ 0`, `${field}: ${missing} missing, ${nonPositive} not positive, of ${rows.length} rows`);
  }
  const min = values.reduce<Decimal>((a, v) => Decimal.min(a, v as Decimal), values[0] as Decimal);
  return check(def, "PASS", n(min), `${field} present and positive on all ${rows.length} rows`);
}

/** Per-row bounds. Any present value out of range → outStatus; else any missing → NOT_EVALUATED. */
function rowRangeCheck(def: CheckDef, rows: RowCalc[], field: string, min: number, max: number, outStatus: CheckStatus): SheetRow {
  if (rows.length === 0) return check(def, "NOT_EVALUATED", "no rows", "No records supplied");
  const values = rows.map((r) => r.d[field]);
  const present = values.filter((v): v is Decimal => v !== null);
  const bad = present.filter((v) => v.lt(min) || v.gt(max)).length;
  const missing = values.length - present.length;
  const result = present.length > 0 ? `${n(Decimal.min(...present))} to ${n(Decimal.max(...present))}` : "missing";
  if (bad > 0) return check(def, outStatus, result, `${bad} row(s) outside ${min}–${max}`);
  if (missing > 0) return check(def, "NOT_EVALUATED", result, `${missing} row(s) missing ${field}`);
  return check(def, "PASS", result, `All rows within ${min}–${max}`);
}

function rowLabel(sheet: string, row: SheetRow, idx: number): string {
  const ref = (row._source as RowSource | undefined)?.row;
  return ref ? `${sheet} row ${ref}` : `${sheet} record ${idx + 1}`;
}

function periodCheck(ctx: EngineContext): SheetRow {
  const def: CheckDef = { id: "PR-01", category: "Period Lock", name: "Input dates within reporting period", rule: "Every activity date within Setup period start–end", severity: "Fail", owner: "Sustainability" };
  const start = toIsoDate(ctx.input.setup["Period start"]);
  const end = toIsoDate(ctx.input.setup["Period end"]);
  if (!start || !end) return check(def, "NOT_EVALUATED", "no period", "Reporting period start/end missing or not an unambiguous date");

  const groups: [string, SheetRow[]][] = [
    ["03_Production_Input", ctx.input.production],
    ["04_Raw_Material_Input", ctx.input.rawMaterial],
    ["05_Kiln_Fuel_Input", ctx.input.kilnFuel],
    ["06_Electricity_Input", ctx.input.electricity],
    ["14_Inventory_Movements", ctx.input.inventory],
  ];
  const outside: string[] = [];
  const undated: string[] = [];
  let count = 0;
  for (const [sheet, rows] of groups) {
    rows.forEach((row, idx) => {
      count++;
      // A row with an explicit interval is checked by its whole interval; otherwise by its Date.
      const is = toIsoDate(row["Interval Start"]);
      const ie = toIsoDate(row["Interval End"]);
      const d = toIsoDate(row.Date);
      if (is && ie) {
        if (is < start || ie > end) outside.push(`${rowLabel(sheet, row, idx)} (${is} – ${ie})`);
      } else if (!d) undated.push(rowLabel(sheet, row, idx));
      else if (d < start || d > end) outside.push(`${rowLabel(sheet, row, idx)} (${d})`);
    });
  }
  if (count === 0) return check(def, "NOT_EVALUATED", "no rows", "No activity records supplied");
  const result = `${outside.length} outside, ${undated.length} undated of ${count}`;
  if (outside.length > 0) return check(def, "FAIL", result, `Out of period ${start}–${end}: ${outside.slice(0, 5).join("; ")}${outside.length > 5 ? " …" : ""}`);
  if (undated.length > 0) return check(def, "NOT_EVALUATED", result, `Missing/ambiguous dates: ${undated.slice(0, 5).join("; ")}`);
  return check(def, "PASS", result, `All ${count} activity dates within ${start}–${end}`);
}

function stockCheck(ctx: EngineContext): SheetRow {
  const def: CheckDef = { id: "MB-04", category: "Mass Balance", name: "Clinker stockpile reconciliation", rule: "Opening + Produced + Purchased − Used − Dispatched = Closing (±0.5% of produced)", severity: "Warning", owner: "Production" };
  const rows = ctx.inventory.filter((r) => /clinker/i.test(String(r.row.Material ?? "")));
  if (rows.length === 0) return check(def, "NOT_EVALUATED", "no inventory", "No clinker inventory movements (opening/closing stock) supplied");
  if (rows.some((r) => r.missing.length > 0)) return check(def, "NOT_EVALUATED", "incomplete inventory", "Inventory movement rows have missing values");
  const { clinkerProduced, clinkerUsed } = ctx.agg;
  if (clinkerProduced === null || clinkerUsed === null) return check(def, "NOT_EVALUATED", "missing production", "Clinker produced/used not available");

  const when = (r: (typeof rows)[number]) => String(toIsoDate(r.row["Interval Start"]) ?? toIsoDate(r.row.Date) ?? "");
  const sorted = [...rows].sort((a, b) => when(a).localeCompare(when(b)));
  const opening = sorted[0].d["Opening Stock t"] as Decimal;
  const closing = sorted[sorted.length - 1].d["Closing Stock t"] as Decimal;
  const purchased = sorted.reduce((a, r) => a.plus(r.d["Purchased t"] as Decimal), new Decimal(0));
  const dispatched = sorted.reduce((a, r) => a.plus(r.d["Dispatched t"] as Decimal), new Decimal(0));
  const expected = opening.plus(clinkerProduced).plus(purchased).minus(clinkerUsed).minus(dispatched);
  const diff = closing.minus(expected);
  const tol = Decimal.max(1, clinkerProduced.mul("0.005"));
  const ok = diff.abs().lte(tol);
  return check(def, ok ? "PASS" : "WARNING", n(diff), `Expected closing ${n(expected)} t, recorded ${n(closing)} t (difference ${n(diff)} t, tolerance ${n(tol)} t)`);
}

function evidenceCheck(ctx: EngineContext): SheetRow {
  const def: CheckDef = { id: "EV-01", category: "Evidence", name: "Evidence register linkage", rule: "Every activity row cites an Evidence ID mapped in the register", severity: "Warning", owner: "QA/QC" };
  const register = new Map(ctx.input.evidence.map((r) => [String(r["Evidence ID"] ?? ""), String(r.Status ?? "")]));
  const rows = [...ctx.input.production, ...ctx.input.rawMaterial, ...ctx.input.kilnFuel, ...ctx.input.electricity];
  if (rows.length === 0 && register.size === 0) return check(def, "NOT_EVALUATED", "no data", "No activity rows or evidence register");
  let noId = 0;
  let unknown = 0;
  let unmapped = 0;
  for (const r of rows) {
    const id = String(r["Evidence ID"] ?? "").trim();
    if (!id) noId++;
    else if (!register.has(id)) unknown++;
    else if (register.get(id) !== "Mapped") unmapped++;
  }
  const ok = rows.length > 0 && noId + unknown + unmapped === 0;
  return check(def, ok ? "PASS" : "WARNING", noId + unknown + unmapped, `${noId} without ID, ${unknown} not in register, ${unmapped} not mapped. Mapped = linked in register; not external verification.`);
}

export function runQaChecks(ctx: EngineContext): SheetRow[] {
  const { agg } = ctx;
  const checks: SheetRow[] = [];

  checks.push(rangeCheck({ id: "MB-01", category: "Mass Balance", name: "Clinker factor range", rule: "0.25 <= Clinker Factor <= 1.00", severity: "Warning", owner: "Production" }, agg.clinkerFactor, 0.25, 1, "WARNING", "Clinker factor"));

  const mb02: CheckDef = { id: "MB-02", category: "Mass Balance", name: "Cement production >= clinker used", rule: "Cement Produced >= Clinker Used", severity: "Fail", owner: "Production" };
  if (agg.cementProduced === null || agg.clinkerUsed === null) checks.push(check(mb02, "NOT_EVALUATED", "missing", "Cement produced or clinker used missing"));
  else {
    const ok = agg.cementProduced.gte(agg.clinkerUsed);
    checks.push(check(mb02, ok ? "PASS" : "FAIL", ok ? "OK" : "MISMATCH", ok ? "Consistent" : "Cement production cannot be less than clinker consumed"));
  }

  const mb03: CheckDef = { id: "MB-03", category: "Mass Balance", name: "Cement mass balance tolerance", rule: "Clinker used + additives ≈ cement ±2%", severity: "Warning", owner: "Production" };
  const additiveFields = ["Gypsum t", "Limestone Additive t", "Other Additives t"];
  const additives = ctx.production.flatMap((r) => additiveFields.map((k) => r.d[k]));
  if (agg.cementProduced === null || agg.clinkerUsed === null || agg.cementProduced.isZero() || additives.some((v) => v === null)) {
    checks.push(check(mb03, "NOT_EVALUATED", "missing", "Cement, clinker used or additive quantities missing (blank additives are not assumed zero)"));
  } else {
    const totalIn = additives.reduce<Decimal>((a, v) => a.plus(v as Decimal), agg.clinkerUsed);
    const diff = totalIn.minus(agg.cementProduced).abs().div(agg.cementProduced);
    const ok = diff.lte("0.02");
    checks.push(check(mb03, ok ? "PASS" : "WARNING", `${diff.mul(100).toFixed(2)}%`, ok ? "Within 2% tolerance" : "Outside 2% tolerance"));
  }

  checks.push(rangeCheck({ id: "EI-01", category: "Emission Intensity", name: "SEE clinker expected range", rule: "0.50 <= SEE Clinker <= 1.20", severity: "Warning", owner: "Sustainability" }, agg.seeClinker, 0.5, 1.2, "WARNING", "SEE clinker"));
  checks.push(rangeCheck({ id: "EI-02", category: "Emission Intensity", name: "SEE cement not extreme", rule: "0.20 <= SEE Cement <= 1.20", severity: "Warning", owner: "Sustainability" }, agg.seeCement, 0.2, 1.2, "WARNING", "SEE cement"));
  checks.push(populatedCheck({ id: "FC-01", category: "Fuel", name: "All fuel NCV populated", rule: "NCV present and > 0 on every fuel line", severity: "Fail", owner: "Energy" }, ctx.kilnFuel, "NCV GJ/unit"));
  checks.push(populatedCheck({ id: "FC-02", category: "Fuel", name: "All fuel EF populated", rule: "EF present and > 0 on every fuel line", severity: "Fail", owner: "Sustainability" }, ctx.kilnFuel, "EF tCO2/TJ"));
  checks.push(rowRangeCheck({ id: "FC-03", category: "Fuel", name: "Biomass fraction valid", rule: "0 <= Biomass <= 1", severity: "Fail", owner: "Energy" }, ctx.kilnFuel, "Biomass Fraction", 0, 1, "FAIL"));
  checks.push(rowRangeCheck({ id: "FC-04", category: "Fuel", name: "Oxidation factor reasonable", rule: "0.95 <= OxFactor <= 1.00", severity: "Warning", owner: "Sustainability" }, ctx.kilnFuel, "Oxidation Factor", 0.95, 1, "WARNING"));
  checks.push(populatedCheck({ id: "EL-01", category: "Electricity", name: "Grid EF populated", rule: "Grid EF present and > 0 on every meter line", severity: "Fail", owner: "Utilities" }, ctx.electricity, "Grid EF tCO2/MWh"));

  const el02: CheckDef = { id: "EL-02", category: "Electricity", name: "Electricity present", rule: "Grid MWh > 0", severity: "Warning", owner: "Utilities" };
  if (agg.gridMWh === null) checks.push(check(el02, "NOT_EVALUATED", "missing", "Grid MWh missing"));
  else checks.push(check(el02, agg.gridMWh.gt(0) ? "PASS" : "WARNING", n(agg.gridMWh), "Scope 2 consumption"));

  const cp01: CheckDef = { id: "CP-01", category: "Completeness", name: "Process CO2 calculated", rule: "Selected Process CO2 calculable and > 0", severity: "Fail", owner: "Sustainability" };
  if (agg.selectedProcessCO2 === null) checks.push(check(cp01, "FAIL", "not calculable", "Selected process CO2 cannot be calculated: method or required inputs missing"));
  else checks.push(check(cp01, agg.selectedProcessCO2.gt(0) ? "PASS" : "FAIL", n(agg.selectedProcessCO2), "Selected-method process CO2"));

  checks.push(evidenceCheck(ctx));
  checks.push(periodCheck(ctx));
  checks.push(stockCheck(ctx));
  checks.push(rangeCheck({ id: "EI-03", category: "Emission Intensity", name: "SHC expected range", rule: "2.8 <= SHC <= 4.5 GJ/t clinker", severity: "Warning", owner: "Sustainability" }, agg.shc, 2.8, 4.5, "WARNING", "SHC"));
  checks.push(rangeCheck({ id: "FC-05", category: "Fuel", name: "TSR in expected range", rule: "0% <= TSR <= 80%", severity: "Warning", owner: "Energy" }, agg.tsr, 0, 80, "WARNING", "TSR"));

  const cp02: CheckDef = { id: "CP-02", category: "Completeness", name: "Method selection valid", rule: "Method A or B explicitly selected in Setup", severity: "Fail", owner: "Sustainability" };
  const method = String(ctx.input.setup["Selected calcination method"] ?? "");
  checks.push(check(cp02, ctx.method ? "PASS" : "FAIL", method || "not selected", ctx.method ? `Method ${ctx.method} selected` : "No calcination method selected (no default applied)"));

  return checks;
}
