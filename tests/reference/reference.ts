/**
 * Independent reference calculations (Directive 06 §6). Deliberately does NOT import lib/calcEngine, lib/qaChecks or
 * lib/numeric: formulas are re-implemented from the methodology text (IPCC 2006 Vol. 3 Ch. 2 carbonate stoichiometry,
 * fuel energy × EF × oxidation, grid MWh × EF) directly on raw input rows.
 *
 * STATUS: the original Q1 2025 workbooks and the audit report are NOT available in this repository or in the chat
 * attachments. This register therefore runs ONLY on the labelled SYNTHETIC fixture and is NOT a real-Q1 validation.
 * When the real files are supplied, run `discrepancyRegister(realInput, appStore, sourceCells)` on them.
 */
import Decimal from "decimal.js";

type Row = Record<string, unknown>;
export interface ReferenceInput {
  setup: Row;
  production: Row[];
  rawMaterial: Row[];
  kilnFuel: Row[];
  electricity: Row[];
  inventory: Row[];
  constants: Row[];
}

export interface RegisterRow {
  metric: string;
  source: string;
  unit: string;
  formula: string;
  reference: string | null;
  application: string | null;
  absDiff: string | null;
  pctDiff: string | null;
  tolerance: string;
  status: "within_tolerance" | "discrepancy" | "not_comparable";
  cause: string;
  resolution: string;
}

const d = (v: unknown): Decimal | null => {
  if (typeof v === "number" && Number.isFinite(v)) return new Decimal(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return new Decimal(v.trim());
  return null;
};
const sum = (rows: Row[], f: (r: Row) => Decimal | null): Decimal | null => {
  let acc = new Decimal(0);
  for (const r of rows) {
    const v = f(r);
    if (v === null) return null;
    acc = acc.plus(v);
  }
  return rows.length ? acc : null;
};
const mul = (...xs: (Decimal | null)[]) => (xs.some((x) => x === null) ? null : xs.reduce((a, x) => a!.mul(x!), new Decimal(1)));

export function referenceMetrics(inp: ReferenceInput) {
  const CO2 = new Decimal("44.01");
  const caco3 = CO2.div("100.09");
  const mgco3 = CO2.div("84.31");
  const clinker = sum(inp.production, (r) => d(r["Clinker Produced t"]));
  const cement = sum(inp.production, (r) => d(r["Cement Produced t"]));
  const used = sum(inp.production, (r) => d(r["Clinker Used t"]));
  const methodA = sum(inp.rawMaterial, (r) => {
    const q = d(r["Quantity t"]);
    const ca = d(r["CaCO3 %"]);
    const mg = d(r["MgCO3 %"]);
    const conv = d(r["Calcination Conversion"]);
    return q && ca && mg && conv ? q.mul(ca.div(100).mul(caco3).plus(mg.div(100).mul(mgco3))).mul(conv) : null;
  });
  const efRow = inp.constants.find((r) => r["Constant / Factor"] === "Selected clinker process EF");
  const methodB = mul(clinker, d(efRow?.Value));
  const method = String(inp.setup["Selected calcination method"] ?? "");
  const process = method.includes("Method A") ? methodA : method.includes("Method B") ? methodB : null;
  const fuel = (part: "fossil" | "bio") =>
    sum(inp.kilnFuel, (r) => {
      const gj = mul(d(r.Quantity), d(r["NCV GJ/unit"]));
      const bio = d(r["Biomass Fraction"]);
      const base = mul(gj?.div(1000) ?? null, d(r["EF tCO2/TJ"]), d(r["Oxidation Factor"]));
      if (!base || !bio) return null;
      return part === "fossil" ? base.mul(Decimal.max(0, new Decimal(1).minus(bio))) : base.mul(bio);
    });
  const energy = sum(inp.kilnFuel, (r) => mul(d(r.Quantity), d(r["NCV GJ/unit"])));
  const grid = sum(inp.electricity, (r) => mul(d(r["Grid MWh"]), d(r["Grid EF tCO2/MWh"])));
  const clinkerInv = inp.inventory.filter((r) => /clinker/i.test(String(r.Material ?? "")));
  const opening = clinkerInv.length ? d(clinkerInv[0]["Opening Stock t"]) : null;
  const closing = clinkerInv.length ? d(clinkerInv[clinkerInv.length - 1]["Closing Stock t"]) : null;
  const purchased = sum(clinkerInv, (r) => d(r["Purchased t"]));
  const dispatched = sum(clinkerInv, (r) => d(r["Dispatched t"]));
  const stockGap = opening && closing && clinker && used && purchased && dispatched ? closing.minus(opening.plus(clinker).plus(purchased).minus(used).minus(dispatched)) : null;
  return {
    "Process CO2 Method A": methodA,
    "Process CO2 Method B": methodB,
    "Selected Process CO2": process,
    "Fuel Combustion CO2": fuel("fossil"),
    "Biogenic CO2 Memo": fuel("bio"),
    "Indirect Grid CO2": grid,
    "Clinker Stockpile Delta": clinker && used ? clinker.minus(used) : null,
    "Stock movement closing difference": stockGap,
    "Specific Heat Consumption": energy && clinker && !clinker.isZero() ? energy.div(clinker) : null,
    "Clinker Factor": used && cement && !cement.isZero() ? used.div(cement) : null,
    "Product allocation (per cement type)": null as Decimal | null,
  };
}

const META: Record<string, { unit: string; formula: string; source: string }> = {
  "Process CO2 Method A": { unit: "tCO2", formula: "Σ Qty × (CaCO3%/100 × 44.01/100.09 + MgCO3%/100 × 44.01/84.31) × conversion", source: "04_Raw_Material_Input rows" },
  "Process CO2 Method B": { unit: "tCO2", formula: "Σ clinker produced × selected clinker EF", source: "03_Production_Input; 07_Constants" },
  "Selected Process CO2": { unit: "tCO2", formula: "Method selected in Setup", source: "01_Setup" },
  "Fuel Combustion CO2": { unit: "tCO2", formula: "Σ Qty × NCV / 1000 × EF × Ox × (1 − biomass)", source: "05_Kiln_Fuel_Input rows" },
  "Biogenic CO2 Memo": { unit: "tCO2", formula: "Σ Qty × NCV / 1000 × EF × Ox × biomass", source: "05_Kiln_Fuel_Input rows" },
  "Indirect Grid CO2": { unit: "tCO2", formula: "Σ grid MWh × grid EF", source: "06_Electricity_Input rows" },
  "Clinker Stockpile Delta": { unit: "t", formula: "Σ clinker produced − Σ clinker used", source: "03_Production_Input" },
  "Stock movement closing difference": { unit: "t", formula: "closing − (opening + produced + purchased − used − dispatched)", source: "14_Inventory_Movements; 03_Production_Input" },
  "Specific Heat Consumption": { unit: "GJ/t clinker", formula: "Σ Qty × NCV ÷ Σ clinker produced", source: "05_Kiln_Fuel_Input; 03_Production_Input" },
  "Clinker Factor": { unit: "ratio", formula: "Σ clinker used ÷ Σ cement produced", source: "03_Production_Input" },
  "Product allocation (per cement type)": { unit: "tCO2/t product", formula: "not defined by an approved methodology document", source: "—" },
};

/** Application values are passed in as plain numbers (taken from the stored run), so this module stays engine-independent. */
export function discrepancyRegister(inp: ReferenceInput, app: Record<string, number | null>, relTol = 1e-9): RegisterRow[] {
  const ref = referenceMetrics(inp);
  return Object.entries(ref).map(([metric, rv]) => {
    const meta = META[metric];
    const av = app[metric] ?? null;
    const appD = av === null ? null : new Decimal(av);
    const base = { metric, source: meta.source, unit: meta.unit, formula: meta.formula, tolerance: `relative ${relTol}` };
    if (rv === null || appD === null) {
      return {
        ...base, reference: rv?.toString() ?? null, application: appD?.toString() ?? null, absDiff: null, pctDiff: null, status: "not_comparable" as const,
        cause: metric.startsWith("Product allocation") ? "The application has no per-product allocation; only SEE per tonne of total cement." : "A value is missing on one side (missing is never zero).",
        resolution: metric.startsWith("Product allocation") ? "Requires an approved allocation methodology before implementation." : "Investigate the missing input.",
      };
    }
    const diff = appD.minus(rv).abs();
    const pct = rv.isZero() ? null : diff.div(rv.abs()).mul(100);
    const within = diff.lte(Decimal.max(new Decimal(relTol).mul(rv.abs()), 1e-9));
    return {
      ...base, reference: rv.toSignificantDigits(15).toString(), application: appD.toString(), absDiff: diff.toSignificantDigits(6).toString(),
      pctDiff: pct ? pct.toSignificantDigits(6).toString() : null, status: within ? ("within_tolerance" as const) : ("discrepancy" as const),
      cause: within ? "—" : "Difference exceeds tolerance; to be explained (never hardcoded).", resolution: within ? "—" : "Open",
    };
  });
}
