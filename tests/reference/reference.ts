/**
 * Independent reference calculations (Directive 06 §6). Deliberately does NOT import lib/calcEngine, lib/qaChecks or
 * lib/numeric: formulas are re-implemented from the methodology text (IPCC 2006 Vol. 3 Ch. 2 carbonate stoichiometry,
 * fuel energy × EF × oxidation, grid MWh × EF) directly on raw input rows.
 *
 * Runs on the labelled SYNTHETIC fixture (tests/mrv/cases.ts RF-01) and on the supplied Q1 2025 collection workbook
 * (tests/reference/q1.ts). That workbook is itself labelled DEMO ("Cement_QAQC_V28_Demo", "Demo Cement Plant"), so the
 * Q1 register is a reconciliation against a demo workbook — not a validation against real plant records.
 *
 * Unit rule (Directive 06B §3, revised): an explicit declaration (`units`) wins; undeclared, the "%" header applies —
 * small values are never reinterpreted. `requiredUnits` lists declarations the source itself requires (its headers are
 * not authoritative); if one is missing, Method A is not comparable (null). Mass basis: "wet" deducts moisture;
 * "dry" or undeclared uses the quantity as entered.
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
  units?: { carbonate?: "percent" | "fraction"; moisture?: "percent" | "fraction"; massBasis?: "dry" | "wet" };
  requiredUnits?: ("carbonate" | "moisture" | "massBasis")[];
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
  const carbUnit = inp.units?.carbonate;
  const unresolved = (inp.requiredUnits ?? []).some((k) => !inp.units?.[k]);
  const share = (v: Decimal | null, unit: "percent" | "fraction" | undefined) => (v === null ? null : unit === "fraction" ? v : v.div(100));
  const methodA = unresolved ? null : sum(inp.rawMaterial, (r) => {
    const q0 = d(r["Quantity t"]);
    const moist = share(d(r["Moisture %"]), inp.units?.moisture);
    const q = inp.units?.massBasis === "wet" ? (q0 && moist ? q0.mul(new Decimal(1).minus(moist)) : null) : q0;
    const ca = share(d(r["CaCO3 %"]), carbUnit);
    const mg = share(d(r["MgCO3 %"]), carbUnit);
    const conv = d(r["Calcination Conversion"]);
    return q && ca && mg && conv ? q.mul(ca.mul(caco3).plus(mg.mul(mgco3))).mul(conv) : null;
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
  const gridMWh = sum(inp.electricity, (r) => d(r["Grid MWh"]));
  // Alternative fuel = any biomass content, or a waste-derived fuel by name (RDF, tyres, biomass, waste).
  const altEnergy = sum(inp.kilnFuel, (r) => {
    const bio = d(r["Biomass Fraction"]);
    const alt = (bio !== null && bio.gt(0)) || /rdf|tyre|tire|biomass|waste/i.test(String(r["Fuel Type"] ?? ""));
    return alt ? mul(d(r.Quantity), d(r["NCV GJ/unit"])) : new Decimal(0);
  });
  const fossil = fuel("fossil");
  const direct = process && fossil ? process.plus(fossil) : null;
  const total = direct && grid ? direct.plus(grid) : null;
  const per = (a: Decimal | null, b: Decimal | null) => (a && b && !b.isZero() ? a.div(b) : null);
  const clinkerInv = inp.inventory.filter((r) => /clinker/i.test(String(r.Material ?? "")));
  const opening = clinkerInv.length ? d(clinkerInv[0]["Opening Stock t"]) : null;
  const closing = clinkerInv.length ? d(clinkerInv[clinkerInv.length - 1]["Closing Stock t"]) : null;
  const purchased = sum(clinkerInv, (r) => d(r["Purchased t"]));
  const dispatched = sum(clinkerInv, (r) => d(r["Dispatched t"]));
  const stockGap = opening && closing && clinker && used && purchased && dispatched ? closing.minus(opening.plus(clinker).plus(purchased).minus(used).minus(dispatched)) : null;
  return {
    "Clinker Produced": clinker,
    "Cement Produced": cement,
    "Process CO2 Method A": methodA,
    "Process CO2 Method B": methodB,
    "Selected Process CO2": process,
    "Fuel Combustion CO2": fossil,
    "Biogenic CO2 Memo": fuel("bio"),
    "Direct Embedded CO2": direct,
    "Grid Electricity MWh": gridMWh,
    "Indirect Grid CO2": grid,
    "Total Embedded CO2": total,
    "SEE Clinker": per(direct, clinker),
    "Specific Embedded Emissions Cement": per(total, cement),
    "Total Fuel Energy": energy,
    "Thermal Substitution Rate (TSR)": energy && altEnergy ? per(altEnergy, energy)?.mul(100) ?? null : null,
    "Clinker Stockpile Delta": clinker && used ? clinker.minus(used) : null,
    "Stock movement closing difference": stockGap,
    "Specific Heat Consumption": energy && clinker && !clinker.isZero() ? energy.div(clinker) : null,
    "Clinker Factor": used && cement && !cement.isZero() ? used.div(cement) : null,
    "Product allocation (per cement type)": null as Decimal | null,
  };
}

const META: Record<string, { unit: string; formula: string; source: string }> = {
  "Clinker Produced": { unit: "t", formula: "Σ clinker produced", source: "03_Production_Input rows" },
  "Cement Produced": { unit: "t", formula: "Σ cement produced", source: "03_Production_Input rows" },
  "Direct Embedded CO2": { unit: "tCO2", formula: "selected process CO2 + fossil fuel CO2", source: "derived" },
  "Grid Electricity MWh": { unit: "MWh", formula: "Σ grid MWh", source: "06_Electricity_Input rows" },
  "Total Embedded CO2": { unit: "tCO2", formula: "direct + indirect grid CO2", source: "derived" },
  "SEE Clinker": { unit: "tCO2/t clinker", formula: "direct ÷ clinker produced", source: "derived" },
  "Specific Embedded Emissions Cement": { unit: "tCO2/t cement", formula: "total ÷ cement produced", source: "derived" },
  "Total Fuel Energy": { unit: "GJ", formula: "Σ Qty × NCV", source: "05_Kiln_Fuel_Input rows" },
  "Thermal Substitution Rate (TSR)": { unit: "%", formula: "alt-fuel energy ÷ total fuel energy × 100 (alt = biomass > 0 or RDF/tyre/waste by name)", source: "05_Kiln_Fuel_Input rows" },
  "Process CO2 Method A": { unit: "tCO2", formula: "Σ Qty(dry basis) × (CaCO3 fraction × 44.01/100.09 + MgCO3 fraction × 44.01/84.31) × conversion (units as declared)", source: "04_Raw_Material_Input rows" },
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
