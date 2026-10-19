import { toIsoDate } from "./dates";
import { parseStrictNumber } from "./numeric";
import type { Completeness, InputIssue, MrvInput, Readiness, RowSource, SheetRow } from "./types";

const CLINKER_EF = "Selected clinker process EF";

interface Section {
  sheet: string;
  rows: SheetRow[];
  numeric: string[];
}

function label(sheet: string, row: SheetRow, idx: number): string {
  const ref = (row._source as RowSource | undefined)?.row;
  return ref ? `${sheet} row ${ref}` : `${sheet} record ${idx + 1}`;
}

/**
 * Required-data completeness: share of required cells that hold a valid value.
 * Independent from the QA pass percentage — a dataset can pass every evaluated check and still be incomplete.
 */
export function computeCompleteness(input: MrvInput): Completeness {
  const missing: string[] = [];
  let required = 0;
  const need = (present: boolean, what: string) => {
    required++;
    if (!present) missing.push(what);
  };
  const text = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

  const s = input.setup;
  need(text(s["Installation / site"]), "01_Setup: Installation / site");
  need(text(s["Reporting quarter"]), "01_Setup: Reporting quarter");
  need(toIsoDate(s["Period start"]) !== null, "01_Setup: Period start");
  need(toIsoDate(s["Period end"]) !== null, "01_Setup: Period end");
  const method = String(s["Selected calcination method"] ?? "");
  const isA = method.includes("Method A");
  const isB = method.includes("Method B");
  need(isA || isB, "01_Setup: Selected calcination method");

  const sections: Section[] = [
    { sheet: "03_Production_Input", rows: input.production, numeric: ["Clinker Produced t", "Cement Produced t", "Clinker Used t"] },
    { sheet: "05_Kiln_Fuel_Input", rows: input.kilnFuel, numeric: ["Quantity", "NCV GJ/unit", "EF tCO2/TJ", "Oxidation Factor", "Biomass Fraction"] },
    { sheet: "06_Electricity_Input", rows: input.electricity, numeric: ["Grid MWh", "Grid EF tCO2/MWh"] },
  ];
  if (isA) {
    sections.push({ sheet: "04_Raw_Material_Input", rows: input.rawMaterial, numeric: ["Quantity t", "CaCO3 %", "MgCO3 %", "Calcination Conversion"] });
  }
  if (isB) {
    const ef = input.constants.find((r) => r["Constant / Factor"] === CLINKER_EF);
    need(ef !== undefined && parseStrictNumber(ef.Value).kind === "ok", `07_Constants_EF_NCV: ${CLINKER_EF}`);
  }

  for (const sec of sections) {
    need(sec.rows.length > 0, `${sec.sheet}: at least one record`);
    sec.rows.forEach((row, idx) => {
      const where = label(sec.sheet, row, idx);
      need(toIsoDate(row.Date) !== null, `${where}: Date`);
      for (const f of sec.numeric) need(parseStrictNumber(row[f]).kind === "ok", `${where}: ${f}`);
      need(text(row["Evidence ID"]), `${where}: Evidence ID`);
    });
  }

  const present = required - missing.length;
  return { required, present, pct: required > 0 ? Math.floor((present / required) * 100) : 0, missing };
}

export function computeReadiness(args: { completeness: Completeness; issues: InputIssue[]; qaqc: SheetRow[]; synthetic: boolean }): Readiness {
  const reasons: string[] = [];
  const { completeness, issues, qaqc, synthetic } = args;
  if (synthetic) reasons.push("Synthetic demo data — never eligible for reporting");
  if (completeness.pct < 100) reasons.push(`Required data incomplete (${completeness.pct}%, ${completeness.missing.length} item(s) missing)`);
  if (issues.length > 0) reasons.push(`${issues.length} input value(s) rejected as non-numeric or ambiguous`);
  const fails = qaqc.filter((r) => r.Status === "FAIL").map((r) => String(r["Check ID"]));
  const notEval = qaqc.filter((r) => r.Status === "NOT_EVALUATED").map((r) => String(r["Check ID"]));
  if (fails.length > 0) reasons.push(`QA/QC failures: ${fails.join(", ")}`);
  if (notEval.length > 0) reasons.push(`QA/QC checks not evaluated: ${notEval.join(", ")}`);
  return { status: reasons.length === 0 ? "READY_FOR_INTERNAL_REVIEW" : "NOT_READY", reasons };
}
