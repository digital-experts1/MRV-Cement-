import { DEFAULT_CONSTANTS } from "./calcEngine";
import type { MrvInput, SheetRow } from "./types";

export const SYNTHETIC_SITE_NAME = "SYNTHETIC DEMO PLANT (fictitious)";
export const SYNTHETIC_NOTICE = "SYNTHETIC DEMO DATA — fictitious values for demonstration only. Not plant data. Not for reporting.";

function ev(id: string, type: string, description: string, system: string, sheet: string, owner: string, frequency: string): SheetRow {
  return {
    "Evidence ID": id,
    "Evidence Type": type,
    Description: `[Synthetic] ${description}`,
    "Source System": system,
    "Mapped Sheet": sheet,
    Status: "Mapped",
    Owner: owner,
    Reviewer: "Demo reviewer",
    Frequency: frequency,
    Notes: "Synthetic demo record — no real document exists",
  };
}

/** Fully synthetic demonstration dataset. Always flagged `synthetic: true`; every report/export derived from it is labelled. */
export function createSampleDataset(): MrvInput {
  return {
    meta: { origin: "demo", synthetic: true, filename: "SYNTHETIC_DEMO_DATASET", importedAt: null },
    readme: [{ Control: "Dataset type", Value: "SYNTHETIC DEMO", "Governance note": SYNTHETIC_NOTICE }],
    setupRows: [],
    dcsMap: [],
    fuelDefaults: [],
    regulatory: [],
    setup: {
      "Workbook mode": "Cement_QAQC_V28_Online",
      "Installation / site": SYNTHETIC_SITE_NAME,
      Country: "Egypt",
      "Reporting quarter": "Q1 2025",
      "Period start": "2025-01-01",
      "Period end": "2025-03-31",
      "Primary product": "CEM II/A-L 42.5N",
      "Boundary approach": "Operational control",
      "Selected calcination method": "Method B - clinker output",
      "Assurance status": "Synthetic demo — not externally verified",
      "Submission status": "Demo only",
      "CKD correction applied": "No",
    },
    production: [
      { Date: "2025-01-31", Quarter: "Q1 2025", "Kiln Line": "Kiln 1", "Cement Type": "CEM II/A-L 42.5N", "Clinker Produced t": 175000, "Cement Produced t": 230000, "Clinker Used t": 175100, "Gypsum t": 11500, "Limestone Additive t": 43400, "Other Additives t": 0, "Evidence ID": "EV-PROD-JAN", Notes: "Synthetic" },
      { Date: "2025-02-28", Quarter: "Q1 2025", "Kiln Line": "Kiln 1", "Cement Type": "CEM II/A-L 42.5N", "Clinker Produced t": 165000, "Cement Produced t": 215000, "Clinker Used t": 165050, "Gypsum t": 10750, "Limestone Additive t": 39200, "Other Additives t": 0, "Evidence ID": "EV-PROD-FEB", Notes: "Synthetic" },
      { Date: "2025-03-31", Quarter: "Q1 2025", "Kiln Line": "Kiln 1", "Cement Type": "CEM II/A-L 42.5N", "Clinker Produced t": 180000, "Cement Produced t": 235000, "Clinker Used t": 180050, "Gypsum t": 11750, "Limestone Additive t": 43200, "Other Additives t": 0, "Evidence ID": "EV-PROD-MAR", Notes: "Synthetic" },
    ],
    rawMaterial: [
      { Date: "2025-01-31", Material: "Raw Meal", "Quantity t": 275000, "CaCO3 %": 78.5, "MgCO3 %": 2.1, "Moisture %": 0.8, "Calcination Conversion": 1.0, "Evidence ID": "EV-RAW-JAN" },
      { Date: "2025-02-28", Material: "Raw Meal", "Quantity t": 260000, "CaCO3 %": 78.2, "MgCO3 %": 2.0, "Moisture %": 0.9, "Calcination Conversion": 1.0, "Evidence ID": "EV-RAW-FEB" },
      { Date: "2025-03-31", Material: "Raw Meal", "Quantity t": 282000, "CaCO3 %": 78.6, "MgCO3 %": 2.2, "Moisture %": 0.8, "Calcination Conversion": 1.0, "Evidence ID": "EV-RAW-MAR" },
    ],
    kilnFuel: [
      { Date: "2025-01-31", "Fuel Type": "Petcoke", Quantity: 38000, Unit: "t", "NCV GJ/unit": 32.5, "EF tCO2/TJ": 97.5, "Oxidation Factor": 0.99, "Biomass Fraction": 0, "Evidence ID": "EV-FUEL-PETCOKE-Q1" },
      { Date: "2025-02-28", "Fuel Type": "Coal", Quantity: 24000, Unit: "t", "NCV GJ/unit": 25.8, "EF tCO2/TJ": 94.6, "Oxidation Factor": 0.99, "Biomass Fraction": 0, "Evidence ID": "EV-FUEL-COAL-Q1" },
      { Date: "2025-03-31", "Fuel Type": "RDF", Quantity: 12000, Unit: "t", "NCV GJ/unit": 17.0, "EF tCO2/TJ": 85.0, "Oxidation Factor": 0.98, "Biomass Fraction": 0.5, "Evidence ID": "EV-FUEL-RDF-Q1" },
      { Date: "2025-03-31", "Fuel Type": "Tyre Chips", Quantity: 1300, Unit: "t", "NCV GJ/unit": 31.4, "EF tCO2/TJ": 85.0, "Oxidation Factor": 0.98, "Biomass Fraction": 0.27, "Evidence ID": "EV-FUEL-TYRE-Q1" },
    ],
    electricity: [
      { Date: "2025-01-31", "Meter / Source": "Main Substation M-01", "Grid MWh": 32000, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": "EV-ELEC-JAN" },
      { Date: "2025-02-28", "Meter / Source": "Main Substation M-01", "Grid MWh": 30500, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": "EV-ELEC-FEB" },
      { Date: "2025-03-31", "Meter / Source": "Main Substation M-01", "Grid MWh": 32500, "Grid EF tCO2/MWh": 0.4878, "Self-generation MWh": 0, "Self-generation EF": 0, "Renewable MWh": 0, "Evidence ID": "EV-ELEC-MAR" },
    ],
    inventory: [
      { Date: "2025-03-31", Material: "Clinker", "Opening Stock t": 30000, "Purchased t": 0, "Dispatched t": 0, "Closing Stock t": 29800, "Evidence ID": "EV-STOCK-Q1" },
    ],
    constants: DEFAULT_CONSTANTS.map((r) => ({ ...r })),
    evidence: [
      ev("EV-PROD-JAN", "Production log", "January clinker and cement weighbridge log", "Kiln DCS / ERP", "03_Production_Input", "Production", "Monthly"),
      ev("EV-PROD-FEB", "Production log", "February clinker and cement weighbridge log", "Kiln DCS / ERP", "03_Production_Input", "Production", "Monthly"),
      ev("EV-PROD-MAR", "Production log", "March clinker and cement weighbridge log", "Kiln DCS / ERP", "03_Production_Input", "Production", "Monthly"),
      ev("EV-RAW-JAN", "Lab report", "January raw meal carbonate analysis", "LIMS", "04_Raw_Material_Input", "Lab", "Monthly"),
      ev("EV-RAW-FEB", "Lab report", "February raw meal carbonate analysis", "LIMS", "04_Raw_Material_Input", "Lab", "Monthly"),
      ev("EV-RAW-MAR", "Lab report", "March raw meal carbonate analysis", "LIMS", "04_Raw_Material_Input", "Lab", "Monthly"),
      ev("EV-FUEL-PETCOKE-Q1", "Fuel record", "Petcoke delivery weigh tickets and NCV lab results", "Fuel ERP", "05_Kiln_Fuel_Input", "Energy", "Quarterly"),
      ev("EV-FUEL-COAL-Q1", "Fuel record", "Coal delivery weigh tickets and lab results", "Fuel ERP", "05_Kiln_Fuel_Input", "Energy", "Quarterly"),
      ev("EV-FUEL-RDF-Q1", "Alt fuel record", "RDF biomass content and moisture reports", "Alt Fuel Feeder", "05_Kiln_Fuel_Input", "Energy", "Quarterly"),
      ev("EV-FUEL-TYRE-Q1", "Alt fuel record", "Tyre chips delivery and rubber biomass data", "Alt Fuel Feeder", "05_Kiln_Fuel_Input", "Energy", "Quarterly"),
      ev("EV-ELEC-JAN", "Electricity bill", "January utility invoice and meter export", "Electricity Meter", "06_Electricity_Input", "Utilities", "Monthly"),
      ev("EV-ELEC-FEB", "Electricity bill", "February utility invoice and meter export", "Electricity Meter", "06_Electricity_Input", "Utilities", "Monthly"),
      ev("EV-ELEC-MAR", "Electricity bill", "March utility invoice and meter export", "Electricity Meter", "06_Electricity_Input", "Utilities", "Monthly"),
      ev("EV-STOCK-Q1", "Stock survey", "Quarter-end clinker stockpile survey", "Production", "14_Inventory_Movements", "Production", "Quarterly"),
    ],
  };
}
