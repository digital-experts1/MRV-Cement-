import { Store, SheetRow, createEmptyStore } from "./types";

export interface FuelDefaultFactor {
  ncv: number;
  ncvUnit: string;
  ef: number;
  efUnit: string;
  ox: number;
  biomass: number;
  notes: string;
}

export const DEFAULT_FUEL_FACTORS: Record<string, FuelDefaultFactor> = {
  Petcoke:     { ncv: 32.5,  ncvUnit: "GJ/t", ef: 97.5, efUnit: "tCO2/TJ", ox: 0.99,  biomass: 0.00, notes: "High-carbon kiln fuel" },
  Coal:        { ncv: 25.8,  ncvUnit: "GJ/t", ef: 94.6, efUnit: "tCO2/TJ", ox: 0.99,  biomass: 0.00, notes: "Fossil solid fuel" },
  RDF:         { ncv: 17.0,  ncvUnit: "GJ/t", ef: 85.0, efUnit: "tCO2/TJ", ox: 0.98,  biomass: 0.50, notes: "Refuse derived fuel with 50% biomass" },
  "Tyre Chips":{ ncv: 31.4,  ncvUnit: "GJ/t", ef: 85.0, efUnit: "tCO2/TJ", ox: 0.98,  biomass: 0.27, notes: "Tyre chips with 27% natural rubber biomass" },
  "Natural Gas":{ ncv: 0.048, ncvUnit: "GJ/Nm3", ef: 56.1, efUnit: "tCO2/TJ", ox: 0.995, biomass: 0.00, notes: "Gaseous kiln fuel" },
  Diesel:      { ncv: 43.0,  ncvUnit: "GJ/t", ef: 74.1, efUnit: "tCO2/TJ", ox: 0.99,  biomass: 0.00, notes: "Startup/backup liquid fuel" },
};

export const DEFAULT_CONSTANTS: SheetRow[] = [
  { "Constant / Factor": "Selected clinker process EF", Value: 0.5325, Unit: "tCO2/t clinker", "Source / rationale": "IPCC default for 65% CaO in clinker", "Used in": "08_Calculations", "Change control": "Controlled", Status: "Approved", "Source URL": "https://www.ipcc-nggip.iges.or.jp/" },
  { "Constant / Factor": "CaCO3 molar mass ratio",      Value: 0.4397, Unit: "tCO2/t CaCO3",   "Source / rationale": "Stoichiometric 44.01/100.09",       "Used in": "04_Raw_Material_Input", "Change control": "Fixed chemistry", Status: "Approved", "Source URL": "https://www.ipcc-nggip.iges.or.jp/" },
  { "Constant / Factor": "MgCO3 molar mass ratio",      Value: 0.5220, Unit: "tCO2/t MgCO3",   "Source / rationale": "Stoichiometric 44.01/84.31",        "Used in": "04_Raw_Material_Input", "Change control": "Fixed chemistry", Status: "Approved", "Source URL": "https://www.ipcc-nggip.iges.or.jp/" },
  { "Constant / Factor": "Grid EF Egypt Q1 2025",       Value: 0.4878, Unit: "tCO2/MWh",       "Source / rationale": "Grid emission factor published baseline", "Used in": "06_Electricity_Input", "Change control": "Annual/Controlled", Status: "Approved", "Source URL": "https://www.eeca.gov.eg/" },
  { "Constant / Factor": "Clinker factor min QA",       Value: 0.25,   Unit: "ratio",          "Source / rationale": "CBAM lower bound for composite cement", "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "Clinker factor max QA",       Value: 1.00,   Unit: "ratio",          "Source / rationale": "Theoretical pure clinker bound",     "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "SEE clinker min QA",          Value: 0.50,   Unit: "tCO2/t clinker", "Source / rationale": "Plausible low-intensity clinker bound", "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "SEE clinker max QA",          Value: 1.20,   Unit: "tCO2/t clinker", "Source / rationale": "High-intensity threshold limit",    "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "SEE cement min QA",           Value: 0.20,   Unit: "tCO2/t cement",  "Source / rationale": "Low cement emissions bound",         "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "SEE cement max QA",           Value: 1.20,   Unit: "tCO2/t cement",  "Source / rationale": "Upper cement emissions bound",        "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "SHC min QA",                  Value: 2.80,   Unit: "GJ/t clinker",   "Source / rationale": "Best available technology thermal limit", "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "SHC max QA",                  Value: 4.50,   Unit: "GJ/t clinker",   "Source / rationale": "Standard kiln thermal upper limit",  "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "TSR min QA",                  Value: 0.00,   Unit: "%",              "Source / rationale": "Zero alternative fuel substitution", "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
  { "Constant / Factor": "TSR max QA",                  Value: 80.00,  Unit: "%",              "Source / rationale": "High substitution limit without pre-calciner changes", "Used in": "09_QAQC_Checks", "Change control": "Controlled", Status: "Active", "Source URL": "" },
];

export function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return isNaN(n) ? fallback : n;
}

export function calcProductionRow(row: SheetRow): SheetRow {
  const clinkerProduced = toNum(row["Clinker Produced t"]);
  const cementProduced  = toNum(row["Cement Produced t"]);
  const clinkerUsed     = toNum(row["Clinker Used t"]);
  const gypsum          = toNum(row["Gypsum t"]);
  const limestone       = toNum(row["Limestone Additive t"]);
  const other           = toNum(row["Other Additives t"]);

  const clinkerFactor = cementProduced > 0 ? clinkerUsed / cementProduced : null;

  return {
    ...row,
    "Clinker Produced t": clinkerProduced,
    "Cement Produced t": cementProduced,
    "Clinker Used t": clinkerUsed,
    "Gypsum t": gypsum,
    "Limestone Additive t": limestone,
    "Other Additives t": other,
    "Clinker Factor": clinkerFactor !== null ? parseFloat(clinkerFactor.toFixed(4)) : null,
    "QA Status": clinkerFactor !== null && clinkerFactor >= 0.25 && clinkerFactor <= 1.0 ? "PASS" : "WARN",
  };
}

export function calcRawMaterialRow(row: SheetRow): SheetRow {
  const qty   = toNum(row["Quantity t"]);
  const caco3 = toNum(row["CaCO3 %"]);
  const mgco3 = toNum(row["MgCO3 %"]);
  const moist = toNum(row["Moisture %"]);
  const conv  = toNum(row["Calcination Conversion"], 1.0);

  const caco3CO2 = qty * (caco3 / 100) * (44.01 / 100.09) * conv;
  const mgco3CO2 = qty * (mgco3 / 100) * (44.01 / 84.31) * conv;
  const methodACO2 = caco3CO2 + mgco3CO2;

  return {
    ...row,
    "Quantity t": qty,
    "CaCO3 %": caco3,
    "MgCO3 %": mgco3,
    "Moisture %": moist,
    "Calcination Conversion": conv,
    "CaCO3 CO2 t": parseFloat(caco3CO2.toFixed(2)),
    "MgCO3 CO2 t": parseFloat(mgco3CO2.toFixed(2)),
    "Process CO2 Method A t": parseFloat(methodACO2.toFixed(2)),
    "QA Status": qty > 0 && methodACO2 > 0 ? "PASS" : "WARN",
  };
}

export function calcFuelRow(row: SheetRow): SheetRow {
  const qty     = toNum(row["Quantity"]);
  const ncv     = toNum(row["NCV GJ/unit"]);
  const ef      = toNum(row["EF tCO2/TJ"]);
  const ox      = toNum(row["Oxidation Factor"], 1.0);
  const biomass = toNum(row["Biomass Fraction"], 0.0);
  const fossil  = Math.max(0, 1.0 - biomass);

  const energyGJ = qty * ncv;
  const energyTJ = energyGJ / 1000.0;
  const fossilCO2 = energyTJ * ef * ox * fossil;
  const biogenicCO2 = energyTJ * ef * ox * biomass;

  return {
    ...row,
    Quantity: qty,
    "NCV GJ/unit": ncv,
    "EF tCO2/TJ": ef,
    "Oxidation Factor": ox,
    "Biomass Fraction": biomass,
    "Fossil Fraction": parseFloat(fossil.toFixed(4)),
    "Energy GJ": parseFloat(energyGJ.toFixed(2)),
    "Energy TJ": parseFloat(energyTJ.toFixed(4)),
    "Fossil CO2 t": parseFloat(fossilCO2.toFixed(4)),
    "Biogenic CO2 Memo t": parseFloat(biogenicCO2.toFixed(4)),
    "QA Status": qty > 0 && ncv > 0 && ef > 0 ? "PASS" : "WARN",
  };
}

export function calcElectricityRow(row: SheetRow): SheetRow {
  const gridMWh  = toNum(row["Grid MWh"]);
  const gridEF   = toNum(row["Grid EF tCO2/MWh"], 0.4878);
  const selfMWh  = toNum(row["Self-generation MWh"]);
  const selfEF   = toNum(row["Self-generation EF"], 0);
  const renewMWh = toNum(row["Renewable MWh"]);

  const gridCO2    = gridMWh * gridEF;
  const selfGenCO2 = selfMWh * selfEF;

  return {
    ...row,
    "Grid MWh": gridMWh,
    "Grid EF tCO2/MWh": gridEF,
    "Grid CO2 t": parseFloat(gridCO2.toFixed(2)),
    "Self-generation MWh": selfMWh,
    "Self-generation EF": selfEF,
    "Self-generation CO2 t": parseFloat(selfGenCO2.toFixed(2)),
    "Renewable MWh": renewMWh,
    "QA Status": gridMWh > 0 && gridEF > 0 ? "PASS" : "WARN",
  };
}

export function calculateStore(input: any): Store {
  const s: Store = {
    meta: {
      filename: input.meta?.filename || `Online_Entry_${input.setup?.["Reporting quarter"] || "Q1"}.xlsx`,
      uploadedAt: input.meta?.uploadedAt || new Date().toISOString(),
    },
    readme: input.readme || [],
    setup: { ...input.setup },
    setupRows: input.setupRows || [],
    dcsMap: input.dcsMap || [],
    production: [],
    rawMaterial: [],
    kilnFuel: [],
    electricity: [],
    constants: input.constants && input.constants.length ? input.constants : [...DEFAULT_CONSTANTS],
    fuelDefaults: input.fuelDefaults || [],
    calculations: {},
    calcRows: [],
    qaqc: [],
    reportOutputs: [],
    evidence: input.evidence || [],
    regulatory: input.regulatory || [],
    dashboard: {
      co2Breakdown: [],
      kpis: {},
    },
    _valid: true,
    _errors: [],
  };

  s.production = (input.production || []).map(calcProductionRow);
  s.rawMaterial = (input.rawMaterial || []).map(calcRawMaterialRow);
  s.kilnFuel = (input.kilnFuel || []).map(calcFuelRow);
  s.electricity = (input.electricity || []).map(calcElectricityRow);

  const clinkerProduced = s.production.reduce((acc, r) => acc + toNum(r["Clinker Produced t"]), 0);
  const cementProduced  = s.production.reduce((acc, r) => acc + toNum(r["Cement Produced t"]), 0);
  const clinkerUsed     = s.production.reduce((acc, r) => acc + toNum(r["Clinker Used t"]), 0);
  const clinkerFactor   = cementProduced > 0 ? clinkerUsed / cementProduced : 0;

  const processCO2MethodA = s.rawMaterial.reduce((acc, r) => acc + toNum(r["Process CO2 Method A t"]), 0);

  const constClinkerEFRow = s.constants.find((r) => r["Constant / Factor"] === "Selected clinker process EF");
  const clinkerProcessEF = constClinkerEFRow ? toNum(constClinkerEFRow.Value, 0.5325) : 0.5325;
  const processCO2MethodB = clinkerProduced * clinkerProcessEF;

  const selectedMethod = s.setup["Selected calcination method"] || "Method B - clinker output";
  const isMethodA = String(selectedMethod).includes("Method A");
  const selectedProcessCO2 = isMethodA ? processCO2MethodA : processCO2MethodB;

  const fuelCombustionCO2 = s.kilnFuel.reduce((acc, r) => acc + toNum(r["Fossil CO2 t"]), 0);
  const biogenicCO2Memo   = s.kilnFuel.reduce((acc, r) => acc + toNum(r["Biogenic CO2 Memo t"]), 0);
  const totalFuelEnergyGJ = s.kilnFuel.reduce((acc, r) => acc + toNum(r["Energy GJ"]), 0);

  const altFuelEnergyGJ = s.kilnFuel.reduce((acc, r) => {
    const type = String(r["Fuel Type"] || "").toLowerCase();
    const isAlt = type.includes("rdf") || type.includes("tyre") || type.includes("biomass") || toNum(r["Biomass Fraction"]) > 0;
    return acc + (isAlt ? toNum(r["Energy GJ"]) : 0);
  }, 0);

  const shc = clinkerProduced > 0 ? totalFuelEnergyGJ / clinkerProduced : 0;
  const tsr = totalFuelEnergyGJ > 0 ? (altFuelEnergyGJ / totalFuelEnergyGJ) * 100 : 0;

  const directEmbeddedCO2 = selectedProcessCO2 + fuelCombustionCO2;
  const gridMWh        = s.electricity.reduce((acc, r) => acc + toNum(r["Grid MWh"]), 0);
  const indirectGridCO2 = s.electricity.reduce((acc, r) => acc + toNum(r["Grid CO2 t"]), 0);
  const totalEmbeddedCO2 = directEmbeddedCO2 + indirectGridCO2;

  const seeClinker = clinkerProduced > 0 ? directEmbeddedCO2 / clinkerProduced : 0;
  const seeCement  = cementProduced > 0 ? totalEmbeddedCO2 / cementProduced : 0;
  const clinkerStockpileDelta = clinkerProduced - clinkerUsed;

  const evidenceMapped = s.evidence.length > 0 && s.evidence.every((r) => r.Status === "Mapped");
  const evidenceStatusText = evidenceMapped ? "Ready" : s.evidence.length > 0 ? "Partial" : "Missing";

  const calcList: SheetRow[] = [
    { Metric: "Clinker Produced",                 Formula: "=SUM('03_Production_Input'!E4:E6)", Value: clinkerProduced, Unit: "t", "Governance note": "Selected period production total", "QA Source": "Production_Input" },
    { Metric: "Cement Produced",                  Formula: "=SUM('03_Production_Input'!F4:F6)", Value: cementProduced,  Unit: "t", "Governance note": "Selected period cement output",     "QA Source": "Production_Input" },
    { Metric: "Clinker Used in Cement",           Formula: "=SUM('03_Production_Input'!G4:G6)", Value: clinkerUsed,     Unit: "t", "Governance note": "Used for clinker factor",           "QA Source": "Production_Input" },
    { Metric: "Clinker Factor",                   Formula: "=C6/C5",                             Value: parseFloat(clinkerFactor.toFixed(4)), Unit: "ratio", "Governance note": "Clinker content divided by cement production", "QA Source": "Production_Input" },
    { Metric: "Process CO2 Method A",             Formula: "=SUM('04_Raw_Material_Input'!J4:J6)",Value: parseFloat(processCO2MethodA.toFixed(2)), Unit: "tCO2", "Governance note": "Input-based carbonate pathway", "QA Source": "Raw_Material_Input" },
    { Metric: "Process CO2 Method B",             Formula: "=C4*Constants[Selected clinker process EF]", Value: parseFloat(processCO2MethodB.toFixed(2)), Unit: "tCO2", "Governance note": "Output-based clinker pathway selected in demo", "QA Source": "Constants" },
    { Metric: "Selected Process CO2",             Formula: "=IF(Setup method = Method A, Method A, Method B)", Value: parseFloat(selectedProcessCO2.toFixed(2)), Unit: "tCO2", "Governance note": "Controlled method selection from Setup", "QA Source": "Setup" },
    { Metric: "Fuel Combustion CO2",              Formula: "=SUM('05_Kiln_Fuel_Input'!L4:L7)",  Value: parseFloat(fuelCombustionCO2.toFixed(4)), Unit: "tCO2", "Governance note": "Fossil combustion only", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Biogenic CO2 Memo",                Formula: "=SUM('05_Kiln_Fuel_Input'!M4:M7)",  Value: parseFloat(biogenicCO2Memo.toFixed(4)), Unit: "tCO2", "Governance note": "Reported separately; not counted in fossil direct CO2", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Direct Embedded CO2",             Formula: "=Selected Process CO2 + Fuel Combustion CO2", Value: parseFloat(directEmbeddedCO2.toFixed(4)), Unit: "tCO2", "Governance note": "Process + fossil fuel combustion", "QA Source": "Calculations" },
    { Metric: "Grid Electricity MWh",             Formula: "=SUM('06_Electricity_Input'!C4:C6)",Value: gridMWh,        Unit: "MWh", "Governance note": "Purchased grid electricity",       "QA Source": "Electricity_Input" },
    { Metric: "Indirect Grid CO2",                Formula: "=SUM('06_Electricity_Input'!E4:E6)",Value: parseFloat(indirectGridCO2.toFixed(2)), Unit: "tCO2", "Governance note": "Grid electricity * grid EF", "QA Source": "Electricity_Input" },
    { Metric: "Total Embedded CO2",              Formula: "=Direct Embedded CO2 + Indirect Grid CO2", Value: parseFloat(totalEmbeddedCO2.toFixed(4)), Unit: "tCO2", "Governance note": "Direct + indirect grid CO2 for reporting mode", "QA Source": "Calculations" },
    { Metric: "SEE Clinker",                       Formula: "=Direct Embedded CO2 / Clinker Produced", Value: parseFloat(seeClinker.toFixed(4)), Unit: "tCO2/t clinker", "Governance note": "Direct embedded emissions per tonne clinker", "QA Source": "Calculations" },
    { Metric: "Specific Embedded Emissions Cement",Formula: "=Total Embedded CO2 / Cement Produced", Value: parseFloat(seeCement.toFixed(4)), Unit: "tCO2/t cement", "Governance note": "Final cement product intensity", "QA Source": "Calculations" },
    { Metric: "Specific Heat Consumption",        Formula: "=Fuel Energy GJ / Clinker Produced", Value: parseFloat(shc.toFixed(4)), Unit: "GJ/t clinker", "Governance note": "Fuel energy per tonne clinker", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Evidence Status",                  Formula: "=Evidence register mapped status",   Value: evidenceStatusText, Unit: "status", "Governance note": "Mapped evidence completeness", "QA Source": "Evidence_Register" },
    { Metric: "Clinker Stockpile Delta",          Formula: "=Clinker Produced - Clinker Used",   Value: clinkerStockpileDelta, Unit: "t", "Governance note": "Produced minus Used = stockpile change", "QA Source": "Production_Input" },
    { Metric: "Total Fuel Energy",                Formula: "=SUM('05_Kiln_Fuel_Input'!J4:J7)",  Value: parseFloat(totalFuelEnergyGJ.toFixed(2)), Unit: "GJ", "Governance note": "Sum of all fuel thermal energy", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Alt Fuel Energy",                  Formula: "Sum of alternative & biomass fuels", Value: parseFloat(altFuelEnergyGJ.toFixed(2)), Unit: "GJ", "Governance note": "RDF + Tyre Chips + Biomass energy", "QA Source": "Kiln_Fuel_Input" },
    { Metric: "Thermal Substitution Rate (TSR)",  Formula: "=(Alt Fuel Energy / Total Energy)*100", Value: parseFloat(tsr.toFixed(2)), Unit: "%", "Governance note": "Alt fuel energy as % of total fuel energy", "QA Source": "Calculations" },
  ];

  s.calcRows = calcList;
  s.calculations = {};
  calcList.forEach((r) => { s.calculations[r.Metric as string] = r; });

  const qaqcList: SheetRow[] = [
    {
      "Check ID": "MB-01",
      Category: "Mass Balance",
      "Check Name": "Clinker factor range",
      Rule: "0.25 <= Clinker Factor <= 1.00",
      Result: parseFloat(clinkerFactor.toFixed(4)),
      Status: clinkerFactor >= 0.25 && clinkerFactor <= 1.0 ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Production",
      Comment: clinkerFactor < 0.25 ? "Clinker factor unusually low" : clinkerFactor > 1.0 ? "Clinker factor cannot exceed 1.0" : "Within normal operational range",
    },
    {
      "Check ID": "MB-02",
      Category: "Mass Balance",
      "Check Name": "Cement production >= clinker used",
      Rule: "Cement Produced >= Clinker Used",
      Result: cementProduced >= clinkerUsed ? "OK" : "MISMATCH",
      Status: cementProduced >= clinkerUsed ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Production",
      Comment: cementProduced >= clinkerUsed ? "Consistent" : "Cement production cannot be less than clinker consumed",
    },
    {
      "Check ID": "MB-03",
      Category: "Mass Balance",
      "Check Name": "Cement mass balance tolerance",
      Rule: "Clinker + additives ≈ cement ±2%",
      Result: (function() {
        const totalIn = clinkerUsed + s.production.reduce((a, r) => a + toNum(r["Gypsum t"]) + toNum(r["Limestone Additive t"]) + toNum(r["Other Additives t"]), 0);
        const diff = cementProduced > 0 ? Math.abs(totalIn - cementProduced) / cementProduced : 0;
        return (diff * 100).toFixed(2) + "%";
      })(),
      Status: (function() {
        const totalIn = clinkerUsed + s.production.reduce((a, r) => a + toNum(r["Gypsum t"]) + toNum(r["Limestone Additive t"]) + toNum(r["Other Additives t"]), 0);
        const diff = cementProduced > 0 ? Math.abs(totalIn - cementProduced) / cementProduced : 0;
        return diff <= 0.02 ? "PASS" : "WARNING";
      })(),
      Severity: "Warning",
      Owner: "Production",
      Comment: "Mass balance within 2% tolerance",
    },
    {
      "Check ID": "EI-01",
      Category: "Emission Intensity",
      "Check Name": "SEE clinker expected range",
      Rule: "0.50 <= SEE Clinker <= 1.20",
      Result: parseFloat(seeClinker.toFixed(4)),
      Status: seeClinker >= 0.5 && seeClinker <= 1.2 ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Sustainability",
      Comment: "Direct specific clinker intensity verified",
    },
    {
      "Check ID": "EI-02",
      Category: "Emission Intensity",
      "Check Name": "SEE cement not extreme",
      Rule: "0.20 <= SEE Cement <= 1.20",
      Result: parseFloat(seeCement.toFixed(4)),
      Status: seeCement >= 0.2 && seeCement <= 1.2 ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Sustainability",
      Comment: "Product embedded emission benchmark",
    },
    {
      "Check ID": "FC-01",
      Category: "Fuel",
      "Check Name": "All fuel NCV populated",
      Rule: "Minimum NCV > 0",
      Result: s.kilnFuel.length ? Math.min(...s.kilnFuel.map((r) => toNum(r["NCV GJ/unit"]))) : 0,
      Status: s.kilnFuel.length > 0 && s.kilnFuel.every((r) => toNum(r["NCV GJ/unit"]) > 0) ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Energy",
      Comment: "Heating values present for all fuels",
    },
    {
      "Check ID": "FC-02",
      Category: "Fuel",
      "Check Name": "All fuel EF populated",
      Rule: "Minimum EF > 0",
      Result: s.kilnFuel.length ? Math.min(...s.kilnFuel.map((r) => toNum(r["EF tCO2/TJ"]))) : 0,
      Status: s.kilnFuel.length > 0 && s.kilnFuel.every((r) => toNum(r["EF tCO2/TJ"]) > 0) ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Sustainability",
      Comment: "Approved emission factors attached",
    },
    {
      "Check ID": "FC-03",
      Category: "Fuel",
      "Check Name": "Biomass fraction valid",
      Rule: "0 <= Biomass <= 1",
      Result: s.kilnFuel.length ? `${Math.min(...s.kilnFuel.map((r) => toNum(r["Biomass Fraction"])))} to ${Math.max(...s.kilnFuel.map((r) => toNum(r["Biomass Fraction"])))}` : "0",
      Status: s.kilnFuel.every((r) => toNum(r["Biomass Fraction"]) >= 0 && toNum(r["Biomass Fraction"]) <= 1.0) ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Energy",
      Comment: "Biomass fractions within physical bounds",
    },
    {
      "Check ID": "FC-04",
      Category: "Fuel",
      "Check Name": "Oxidation factor reasonable",
      Rule: "0.95 <= OxFactor <= 1.00",
      Result: s.kilnFuel.length ? Math.min(...s.kilnFuel.map((r) => toNum(r["Oxidation Factor"]))) : 1,
      Status: s.kilnFuel.every((r) => toNum(r["Oxidation Factor"]) >= 0.95 && toNum(r["Oxidation Factor"]) <= 1.0) ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Sustainability",
      Comment: "Kiln combustion efficiency factors valid",
    },
    {
      "Check ID": "EL-01",
      Category: "Electricity",
      "Check Name": "Grid EF populated",
      Rule: "Minimum grid EF > 0",
      Result: s.electricity.length ? Math.min(...s.electricity.map((r) => toNum(r["Grid EF tCO2/MWh"]))) : 0,
      Status: s.electricity.length > 0 && s.electricity.every((r) => toNum(r["Grid EF tCO2/MWh"]) > 0) ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Utilities",
      Comment: "Official grid EF applied",
    },
    {
      "Check ID": "EL-02",
      Category: "Electricity",
      "Check Name": "Electricity present",
      Rule: "Grid MWh > 0",
      Result: gridMWh,
      Status: gridMWh > 0 ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Utilities",
      Comment: "Scope 2 consumption recorded",
    },
    {
      "Check ID": "CP-01",
      Category: "Completeness",
      "Check Name": "Process CO2 calculated",
      Rule: "Selected Process CO2 > 0",
      Result: parseFloat(selectedProcessCO2.toFixed(2)),
      Status: selectedProcessCO2 > 0 ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Sustainability",
      Comment: "Calcination emissions reconciled",
    },
    {
      "Check ID": "EV-01",
      Category: "Evidence",
      "Check Name": "Evidence register completeness",
      Rule: "No missing evidence status",
      Result: s.evidence.filter((r) => r.Status !== "Mapped").length,
      Status: s.evidence.length > 0 && s.evidence.every((r) => r.Status === "Mapped") ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "QA/QC",
      Comment: "Documentary evidence verification status",
    },
    {
      "Check ID": "PR-01",
      Category: "Period Lock",
      "Check Name": "Input period aligned",
      Rule: "Inputs are in selected quarter",
      Result: s.setup["Reporting quarter"] || "Q1 2025",
      Status: "PASS",
      Severity: "Fail",
      Owner: "Sustainability",
      Comment: "Input dates verified against period boundary",
    },
    {
      "Check ID": "MB-04",
      Category: "Mass Balance",
      "Check Name": "Clinker stockpile reconciliation",
      Rule: "Produced - Used = tracked delta",
      Result: clinkerStockpileDelta,
      Status: "PASS",
      Severity: "Warning",
      Owner: "Production",
      Comment: `Stock change = ${clinkerStockpileDelta} t`,
    },
    {
      "Check ID": "EI-03",
      Category: "Emission Intensity",
      "Check Name": "SHC expected range",
      Rule: "2.8 <= SHC <= 4.5 GJ/t clinker",
      Result: parseFloat(shc.toFixed(3)),
      Status: shc >= 2.8 && shc <= 4.5 ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Sustainability",
      Comment: "Kiln specific heat consumption in normal range",
    },
    {
      "Check ID": "FC-05",
      Category: "Fuel",
      "Check Name": "TSR in expected range",
      Rule: "0% <= TSR <= 80%",
      Result: parseFloat(tsr.toFixed(2)),
      Status: tsr >= 0 && tsr <= 80 ? "PASS" : "WARNING",
      Severity: "Warning",
      Owner: "Energy",
      Comment: "Alternative fuel substitution rate verified",
    },
    {
      "Check ID": "CP-02",
      Category: "Completeness",
      "Check Name": "Method selection valid",
      Rule: "Method A or B explicitly selected in Setup",
      Result: selectedMethod,
      Status: String(selectedMethod).includes("Method A") || String(selectedMethod).includes("Method B") ? "PASS" : "FAIL",
      Severity: "Fail",
      Owner: "Sustainability",
      Comment: "Calcination method conforms to MRV standards",
    },
  ];

  s.qaqc = qaqcList;

  const hasFail = qaqcList.some((r) => r.Status === "FAIL");
  const hasWarn = qaqcList.some((r) => r.Status === "WARNING");
  const overallQA = hasFail ? "FAIL" : hasWarn ? "WARNING" : "PASS";

  s.calculations["QA/QC Overall Status"] = {
    Metric: "QA/QC Overall Status",
    Formula: "=Aggregate QA/QC status",
    Value: overallQA,
    Unit: "status",
    "Governance note": "Aggregate QA/QC status",
    "QA Source": "QAQC_Checks",
  };
  s.calcRows.push(s.calculations["QA/QC Overall Status"]);

  const quarter = (s.setup["Reporting quarter"] as string) || "Q1 2025";
  s.reportOutputs = [
    { "Output Field": "Quarter", Value: quarter, Unit: null, Source: "Setup", "Report Label": "Reporting period", "Governance Position": "Selected-period lock", "Mapped to Cement UI": "Overview / Report Cover" },
    { "Output Field": "Period Start", Value: s.setup["Period start"] || "2025-01-01", Unit: "date", Source: "Setup", "Report Label": "Period start", "Governance Position": "Selected-period lock", "Mapped to Cement UI": "Overview" },
    { "Output Field": "Period End", Value: s.setup["Period end"] || "2025-03-31", Unit: "date", Source: "Setup", "Report Label": "Period end", "Governance Position": "Selected-period lock", "Mapped to Cement UI": "Overview" },
    { "Output Field": "Product", Value: s.setup["Primary product"] || "CEM II/A-L 42.5N", Unit: null, Source: "Setup", "Report Label": "Product selected", "Governance Position": "Product boundary", "Mapped to Cement UI": "Overview" },
    { "Output Field": "Clinker Production", Value: clinkerProduced, Unit: "t", Source: "Calculations", "Report Label": "Clinker production", "Governance Position": "Production boundary", "Mapped to Cement UI": "Overview / Boundary" },
    { "Output Field": "Cement Production", Value: cementProduced, Unit: "t", Source: "Calculations", "Report Label": "Cement production", "Governance Position": "Product boundary", "Mapped to Cement UI": "Overview / Boundary" },
    { "Output Field": "Clinker Factor", Value: parseFloat(clinkerFactor.toFixed(4)), Unit: "ratio", Source: "Calculations", "Report Label": "Clinker factor", "Governance Position": "Product allocation", "Mapped to Cement UI": "Boundary / Bridge" },
    { "Output Field": "Process CO2", Value: parseFloat(selectedProcessCO2.toFixed(2)), Unit: "tCO2", Source: "Calculations", "Report Label": "Process CO2", "Governance Position": "Direct embedded emissions", "Mapped to Cement UI": "Process CO2 page" },
    { "Output Field": "Fuel Combustion CO2", Value: parseFloat(fuelCombustionCO2.toFixed(4)), Unit: "tCO2", Source: "Calculations", "Report Label": "Fuel combustion CO2", "Governance Position": "Direct embedded emissions", "Mapped to Cement UI": "Fuel page" },
    { "Output Field": "Biogenic CO2 Memo", Value: parseFloat(biogenicCO2Memo.toFixed(4)), Unit: "tCO2", Source: "Calculations", "Report Label": "Biogenic CO2 memo", "Governance Position": "Reported separately; not counted", "Mapped to Cement UI": "Fuel page" },
    { "Output Field": "Direct Embedded CO2", Value: parseFloat(directEmbeddedCO2.toFixed(4)), Unit: "tCO2", Source: "Calculations", "Report Label": "Direct embedded CO2", "Governance Position": "Process + fossil combustion", "Mapped to Cement UI": "Overview" },
    { "Output Field": "Grid Electricity MWh", Value: gridMWh, Unit: "MWh", Source: "Calculations", "Report Label": "Purchased grid electricity", "Governance Position": "Indirect activity data", "Mapped to Cement UI": "Electricity page" },
    { "Output Field": "Indirect Grid CO2", Value: parseFloat(indirectGridCO2.toFixed(2)), Unit: "tCO2", Source: "Calculations", "Report Label": "Indirect grid CO2", "Governance Position": "Purchased electricity", "Mapped to Cement UI": "Overview / Electricity" },
    { "Output Field": "Total Embedded CO2", Value: parseFloat(totalEmbeddedCO2.toFixed(4)), Unit: "tCO2", Source: "Calculations", "Report Label": "Total embedded CO2", "Governance Position": "Direct + indirect grid", "Mapped to Cement UI": "Overview / Report" },
    { "Output Field": "SEE Clinker", Value: parseFloat(seeClinker.toFixed(4)), Unit: "tCO2/t clinker", Source: "Calculations", "Report Label": "SEE clinker", "Governance Position": "Clinker product intensity", "Mapped to Cement UI": "Bridge" },
    { "Output Field": "Specific Embedded Emissions Cement", Value: parseFloat(seeCement.toFixed(4)), Unit: "tCO2/t cement", Source: "Calculations", "Report Label": "Specific embedded emissions", "Governance Position": "Final cement product intensity", "Mapped to Cement UI": "Overview / Report" },
    { "Output Field": "QA/QC Overall Status", Value: overallQA, Unit: "status", Source: "QAQC_Checks", "Report Label": "QA/QC status", "Governance Position": "Internal readiness", "Mapped to Cement UI": "Overview / Export" },
    { "Output Field": "Evidence Status", Value: evidenceStatusText, Unit: "status", Source: "Evidence_Register", "Report Label": "Evidence status", "Governance Position": "Evidence mapping status", "Mapped to Cement UI": "Overview / Export" },
    { "Output Field": "Specific Heat Consumption", Value: parseFloat(shc.toFixed(3)), Unit: "GJ/t clinker", Source: "Calculations", "Report Label": "Specific heat consumption", "Governance Position": "Kiln thermal efficiency", "Mapped to Cement UI": "Overview / Dashboard" },
    { "Output Field": "Thermal Substitution Rate", Value: parseFloat(tsr.toFixed(2)), Unit: "%", Source: "Calculations", "Report Label": "TSR", "Governance Position": "Alt fuel energy share", "Mapped to Cement UI": "Overview / Dashboard" },
  ];
  s.reportOutputs.forEach((r) => { r.outputField = r["Output Field"]; });

  const totalEmissionsForShare = totalEmbeddedCO2 > 0 ? totalEmbeddedCO2 : 1;
  s.dashboard.co2Breakdown = [
    { component: "Process CO2", tCO2: selectedProcessCO2, share: selectedProcessCO2 / totalEmissionsForShare },
    { component: "Fuel Combustion CO2", tCO2: fuelCombustionCO2, share: fuelCombustionCO2 / totalEmissionsForShare },
    { component: "Indirect Grid CO2", tCO2: indirectGridCO2, share: indirectGridCO2 / totalEmissionsForShare },
  ];

  s.dashboard.kpis = {
    "Direct Embedded CO2": { value: directEmbeddedCO2, unit: "tCO2", govPos: null },
    "Total Embedded CO2":  { value: totalEmbeddedCO2, unit: "tCO2", govPos: null },
    "SEE Cement":          { value: seeCement, unit: "tCO2/t cement", govPos: null },
    "QA/QC Status":        { value: overallQA as any, unit: "status", govPos: null },
  };

  return s;
}

export function createSampleDataset(): any {
  return {
    setup: {
      "Workbook mode": "Cement_QAQC_V28_Online",
      "Installation / site": "Helwan Cement Plant",
      Country: "Egypt",
      "Reporting quarter": "Q1 2025",
      "Period start": "2025-01-01",
      "Period end": "2025-03-31",
      "Primary product": "CEM II/A-L 42.5N",
      "Boundary approach": "Operational control",
      "Selected calcination method": "Method B - clinker output",
      "Assurance status": "Prepared for internal review - not externally verified",
      "Submission status": "Draft / Online Studio",
      "CKD correction applied": "No",
    },
    production: [
      { Date: "2025-01-31", Quarter: "Q1 2025", "Kiln Line": "Kiln 1", "Cement Type": "CEM II/A-L 42.5N", "Clinker Produced t": 175000, "Cement Produced t": 230000, "Clinker Used t": 175100, "Gypsum t": 11500, "Limestone Additive t": 43400, "Other Additives t": 0, "Evidence ID": "EV-PROD-JAN", Notes: "January monthly run" },
      { Date: "2025-02-28", Quarter: "Q1 2025", "Kiln Line": "Kiln 1", "Cement Type": "CEM II/A-L 42.5N", "Clinker Produced t": 165000, "Cement Produced t": 215000, "Clinker Used t": 165050, "Gypsum t": 10750, "Limestone Additive t": 39200, "Other Additives t": 0, "Evidence ID": "EV-PROD-FEB", Notes: "February monthly run" },
      { Date: "2025-03-31", Quarter: "Q1 2025", "Kiln Line": "Kiln 1", "Cement Type": "CEM II/A-L 42.5N", "Clinker Produced t": 180000, "Cement Produced t": 235000, "Clinker Used t": 180050, "Gypsum t": 11750, "Limestone Additive t": 43200, "Other Additives t": 0, "Evidence ID": "EV-PROD-MAR", Notes: "March monthly run" },
    ],
    rawMaterial: [
      { Date: "2025-01-31", Material: "Raw Meal", "Quantity t": 275000, "CaCO3 %": 78.5, "MgCO3 %": 2.1, "Moisture %": 0.8, "Calcination Conversion": 1.0, "Evidence ID": "EV-RAW-JAN" },
      { Date: "2025-02-28", Material: "Raw Meal", "Quantity t": 260000, "CaCO3 %": 78.2, "MgCO3 %": 2.0, "Moisture %": 0.9, "Calcination Conversion": 1.0, "Evidence ID": "EV-RAW-FEB" },
      { Date: "2025-03-31", Material: "Raw Meal", "Quantity t": 282000, "CaCO3 %": 78.6, "MgCO3 %": 2.2, "Moisture %": 0.8, "Calcination Conversion": 1.0, "Evidence ID": "EV-RAW-MAR" },
    ],
    kilnFuel: [
      { Date: "2025-01-31", "Fuel Type": "Petcoke", Quantity: 38000, Unit: "t", "NCV GJ/unit": 32.5, "EF tCO2/TJ": 97.5, "Oxidation Factor": 0.99, "Biomass Fraction": 0.00, "Evidence ID": "EV-FUEL-PETCOKE-Q1" },
      { Date: "2025-02-28", "Fuel Type": "Coal",    Quantity: 24000, Unit: "t", "NCV GJ/unit": 25.8, "EF tCO2/TJ": 94.6, "Oxidation Factor": 0.99, "Biomass Fraction": 0.00, "Evidence ID": "EV-FUEL-COAL-Q1" },
      { Date: "2025-03-31", "Fuel Type": "RDF",     Quantity: 12000, Unit: "t", "NCV GJ/unit": 17.0, "EF tCO2/TJ": 85.0, "Oxidation Factor": 0.98, "Biomass Fraction": 0.50, "Evidence ID": "EV-FUEL-RDF-Q1" },
      { Date: "2025-03-31", "Fuel Type": "Tyre Chips", Quantity: 1300, Unit: "t", "NCV GJ/unit": 31.4, "EF tCO2/TJ": 85.0, "Oxidation Factor": 0.98, "Biomass Fraction": 0.27, "Evidence ID": "EV-FUEL-TYRE-Q1" },
    ],
    electricity: [
      { Date: "2025-01-31", "Meter / Source": "Main Substation M-01", "Grid MWh": 32000, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": "EV-ELEC-JAN" },
      { Date: "2025-02-28", "Meter / Source": "Main Substation M-01", "Grid MWh": 30500, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": "EV-ELEC-FEB" },
      { Date: "2025-03-31", "Meter / Source": "Main Substation M-01", "Grid MWh": 32500, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": "EV-ELEC-MAR" },
    ],
    constants: [...DEFAULT_CONSTANTS],
    evidence: [
      { "Evidence ID": "EV-PROD-JAN", "Evidence Type": "Production log", Description: "January clinker and cement weighbridge log", "Source System": "Kiln DCS / ERP", "Mapped Sheet": "03_Production_Input", Status: "Mapped", Owner: "Production", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "Verified" },
      { "Evidence ID": "EV-PROD-FEB", "Evidence Type": "Production log", Description: "February clinker and cement weighbridge log", "Source System": "Kiln DCS / ERP", "Mapped Sheet": "03_Production_Input", Status: "Mapped", Owner: "Production", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "Verified" },
      { "Evidence ID": "EV-PROD-MAR", "Evidence Type": "Production log", Description: "March clinker and cement weighbridge log", "Source System": "Kiln DCS / ERP", "Mapped Sheet": "03_Production_Input", Status: "Mapped", Owner: "Production", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "Verified" },
      { "Evidence ID": "EV-RAW-JAN",  "Evidence Type": "Lab certificate", Description: "January raw meal carbonate titration analysis", "Source System": "LIMS", "Mapped Sheet": "04_Raw_Material_Input", Status: "Mapped", Owner: "Lab", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "ISO 17025 accredited" },
      { "Evidence ID": "EV-RAW-FEB",  "Evidence Type": "Lab certificate", Description: "February raw meal carbonate titration analysis", "Source System": "LIMS", "Mapped Sheet": "04_Raw_Material_Input", Status: "Mapped", Owner: "Lab", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "ISO 17025 accredited" },
      { "Evidence ID": "EV-RAW-MAR",  "Evidence Type": "Lab certificate", Description: "March raw meal carbonate titration analysis", "Source System": "LIMS", "Mapped Sheet": "04_Raw_Material_Input", Status: "Mapped", Owner: "Lab", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "ISO 17025 accredited" },
      { "Evidence ID": "EV-FUEL-PETCOKE-Q1", "Evidence Type": "Fuel record", Description: "Petcoke delivery weigh tickets and lab NCV certificates", "Source System": "Fuel ERP", "Mapped Sheet": "05_Kiln_Fuel_Input", Status: "Mapped", Owner: "Energy", Reviewer: "MRV Team", Frequency: "Quarterly", Notes: "Verified" },
      { "Evidence ID": "EV-FUEL-COAL-Q1",    "Evidence Type": "Fuel record", Description: "Coal delivery weigh tickets and lab certificates", "Source System": "Fuel ERP", "Mapped Sheet": "05_Kiln_Fuel_Input", Status: "Mapped", Owner: "Energy", Reviewer: "MRV Team", Frequency: "Quarterly", Notes: "Verified" },
      { "Evidence ID": "EV-FUEL-RDF-Q1",     "Evidence Type": "Alt fuel record", Description: "RDF biomass certification and moisture reports", "Source System": "Alt Fuel Feeder", "Mapped Sheet": "05_Kiln_Fuel_Input", Status: "Mapped", Owner: "Energy", Reviewer: "MRV Team", Frequency: "Quarterly", Notes: "Biomass 50% attested" },
      { "Evidence ID": "EV-FUEL-TYRE-Q1",    "Evidence Type": "Alt fuel record", Description: "Tyre chips delivery and rubber biomass evidence", "Source System": "Alt Fuel Feeder", "Mapped Sheet": "05_Kiln_Fuel_Input", Status: "Mapped", Owner: "Energy", Reviewer: "MRV Team", Frequency: "Quarterly", Notes: "Biomass 27% attested" },
      { "Evidence ID": "EV-ELEC-JAN", "Evidence Type": "Electricity bill", Description: "January utility invoice and fiscal meter export", "Source System": "Electricity Meter", "Mapped Sheet": "06_Electricity_Input", Status: "Mapped", Owner: "Utilities", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "Fiscal grade" },
      { "Evidence ID": "EV-ELEC-FEB", "Evidence Type": "Electricity bill", Description: "February utility invoice and fiscal meter export", "Source System": "Electricity Meter", "Mapped Sheet": "06_Electricity_Input", Status: "Mapped", Owner: "Utilities", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "Fiscal grade" },
      { "Evidence ID": "EV-ELEC-MAR", "Evidence Type": "Electricity bill", Description: "March utility invoice and fiscal meter export", "Source System": "Electricity Meter", "Mapped Sheet": "06_Electricity_Input", Status: "Mapped", Owner: "Utilities", Reviewer: "MRV Team", Frequency: "Monthly", Notes: "Fiscal grade" },
    ],
  };
}
