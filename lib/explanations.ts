export interface Explanation {
  title: string;
  whatIs: string;
  whatDoes: string;
  whySeeing: string;
}

export const EXPLANATIONS: Record<string, Explanation> = {
  "nav-overview": {
    title: "Overview",
    whatIs: "Executive summary dashboard of plant performance and carbon accounting.",
    whatDoes: "Consolidates primary production volumes, total emissions, and QA/QC status in one screen.",
    whySeeing: "Gives managers and auditors an immediate high-level overview before inspecting detailed sheets.",
  },
  "nav-governance": {
    title: "Governance & Control",
    whatIs: "Workbook control sheet documenting versioning, signatories, and data integrity rules.",
    whatDoes: "Records authorized plant personnel, sign-off dates, and legal reporting postures.",
    whySeeing: "Establishes accountability for the MRV dataset and its controls.",
  },
  "nav-setup": {
    title: "Setup & Reporting Period",
    whatIs: "Baseline plant configuration and reporting timeframe.",
    whatDoes: "Defines the reporting quarter, facility boundary, kiln technology, and product lines.",
    whySeeing: "Sets the operational scope that governs all subsequent emission calculations.",
  },
  "nav-dcs": {
    title: "DCS / ERP / Lab Boundary",
    whatIs: "Plant instrumentation and data acquisition mapping register.",
    whatDoes: "Maps raw data streams from Distributed Control Systems, weighfeeders, and lab analyzers.",
    whySeeing: "Documents which systems and meters each input is intended to come from.",
  },
  "nav-production": {
    title: "Production Input",
    whatIs: "Monthly mass balance of clinker and cement production.",
    whatDoes: "Tracks kiln clinker output, silo opening/closing inventories, and cement dispatch.",
    whySeeing: "Production volumes form the activity baseline and denominator for all specific emission metrics.",
  },
  "nav-rawmaterial": {
    title: "Raw Material Input",
    whatIs: "Monthly consumption and chemical composition of kiln raw meal.",
    whatDoes: "Records raw meal to clinker ratios and carbonaceous contents used to calculate calcination CO₂.",
    whySeeing: "Process emissions from carbonate calcination represent over 60% of total cement plant emissions.",
  },
  "nav-kilnfuel": {
    title: "Kiln Fuel Input",
    whatIs: "Thermal energy activity data for conventional and alternative fuels.",
    whatDoes: "Measures fuel consumption (petcoke, gas, RDF, biomass) and calculates heat input.",
    whySeeing: "Fuel combustion is the second-largest direct emission source and determines Thermal Substitution (TSR).",
  },
  "nav-electricity": {
    title: "Electricity Input",
    whatIs: "Scope 2 indirect energy consumption registry.",
    whatDoes: "Logs grid power purchases, on-site generation, and transmission & distribution (T&D) losses.",
    whySeeing: "Required for embedded indirect emission accounting under CBAM and GHG Protocol.",
  },
  "nav-constants": {
    title: "Constants, EF & NCV",
    whatIs: "Reference library of emission factors, net calorific values, and oxidation factors.",
    whatDoes: "Provides standardized chemical conversion coefficients and permissible QA/QC ranges.",
    whySeeing: "Ensures reproducible calculations aligned with IPCC, GCCA, and national regulatory guidelines.",
  },
  "nav-calculations": {
    title: "Calculations",
    whatIs: "Mathematical engine and formula execution chain.",
    whatDoes: "Transforms activity data into calculated direct and indirect CO₂ figures (internal, not certified).",
    whySeeing: "Provides full mathematical transparency and audit traceability from raw inputs to reported totals.",
  },
  "nav-qaqc": {
    title: "QA/QC Checks",
    whatIs: "Automated data quality check register.",
    whatDoes: "Validates mass balances, physical bounds, thermal efficiencies, and document completeness.",
    whySeeing: "Detects reporting discrepancies, instrumentation drift, or missing evidence before official filing.",
  },
  "nav-reportouts": {
    title: "Report Outputs",
    whatIs: "Structured report output fields computed by the platform.",
    whatDoes: "Aggregates computed values into report fields for internal review.",
    whySeeing: "Working summary for internal review; not externally verified and not a submission.",
  },
  "nav-evidence": {
    title: "Evidence Register",
    whatIs: "Auditable archive linking every number to physical documentation.",
    whatDoes: "Catalogs calibration certificates, weighbridge tickets, purchase invoices, and lab reports.",
    whySeeing: "Shows which inputs have a linked document reference. Mapping is not verification.",
  },
  "nav-regulatory": {
    title: "Regulatory References",
    whatIs: "Compendium of applicable climate standards and legal statutes.",
    whatDoes: "Maps plant operations to EU CBAM regulations, GCCA guidelines, and local environmental laws.",
    whySeeing: "Reference context only; it does not establish compliance.",
  },
  "nav-analytics": {
    title: "Analytics Dashboard",
    whatIs: "Interactive performance benchmarking and visual intelligence console.",
    whatDoes: "Visualizes emission trends, fuel mix breakdowns, and benchmark comparisons with dynamic filters.",
    whySeeing: "Identifies decarbonization opportunities, alternative fuel potential, and operational outliers.",
  },
  "btn-upload": {
    title: "Upload Workbook",
    whatIs: "Excel file ingestion tool.",
    whatDoes: "Reads inputs from a TRACE FORCE MRV collection workbook or data export and recalculates all results.",
    whySeeing: "Allows you to load, validate, and analyze your plant dataset entirely inside your browser.",
  },
  "btn-download-pdf": {
    title: "Download Report",
    whatIs: "Executive PDF export utility.",
    whatDoes: "Generates an internal QA/QC working report with key KPIs and QA status (not a verification report).",
    whySeeing: "Enables quick internal sharing. Synthetic demo reports are clearly marked.",
  },
  "btn-export-excel": {
    title: "Export Excel",
    whatIs: "Presentation workbook of computed results (not re-importable).",
    whatDoes: "Compiles inputs, computed calculations and QA results into a spreadsheet. Use Export Data (.json) to re-import.",
    whySeeing: "Supports offline auditing, record archiving, and data migration into enterprise ERP systems.",
  },
  "kpi-clinker-prod": {
    title: "Clinker Production",
    whatIs: "Total metric tons of grey or white clinker produced in the rotary kiln during the period.",
    whatDoes: "Serves as the primary operational baseline for process calcination and kiln thermal calculations.",
    whySeeing: "Fundamental activity metric for cement manufacturing decarbonization tracking.",
  },
  "kpi-cement-prod": {
    title: "Cement Production",
    whatIs: "Total metric tons of finished cement ground and dispatched.",
    whatDoes: "Represents final commercial output used to compute Specific Embedded Emissions (SEE Cement).",
    whySeeing: "Standard product output metric required for CBAM trade declarations and sales accounting.",
  },
  "kpi-clinker-factor": {
    title: "Clinker Factor",
    whatIs: "The mass ratio of clinker incorporated per ton of finished cement produced.",
    whatDoes: "Measures clinker substitution efficiency with supplementary materials like slag, fly ash, or limestone.",
    whySeeing: "The most direct operational lever for reducing a plant’s carbon intensity.",
  },
  "kpi-specific-heat": {
    title: "Specific Heat Consumption (SHC)",
    whatIs: "Thermal energy consumed per ton of clinker produced, measured in GJ/t clinker.",
    whatDoes: "Evaluates kiln thermodynamic efficiency and burner thermal performance.",
    whySeeing: "Lower SHC indicates higher kiln efficiency and reduced fuel emissions.",
  },
  "kpi-direct-co2": {
    title: "Direct Embedded CO₂",
    whatIs: "Scope 1 greenhouse gas emissions originating from sources inside the plant boundary.",
    whatDoes: "Combines raw material calcination CO₂ and kiln/non-kiln fuel combustion CO₂.",
    whySeeing: "Forms the core liability for carbon border taxes and emissions trading systems.",
  },
  "kpi-total-co2": {
    title: "Total Embedded CO₂",
    whatIs: "Combined sum of Scope 1 direct emissions and Scope 2 indirect electricity emissions.",
    whatDoes: "Measures complete cradle-to-gate operational greenhouse gas footprint.",
    whySeeing: "Headline internal figure; reporting basis must be confirmed before external use.",
  },
  "kpi-see-cement": {
    title: "Specific Embedded Emissions — Cement",
    whatIs: "Emissions intensity metric expressed as tons of CO₂ per ton of finished cement produced.",
    whatDoes: "Normalizes plant emissions against production volume for benchmarking and carbon border adjustment.",
    whySeeing: "Key intensity metric for benchmarking; regulatory use depends on the confirmed reporting basis.",
  },
  "kpi-see-clinker": {
    title: "Specific Embedded Emissions — Clinker",
    whatIs: "Direct emissions intensity per ton of clinker produced (tCO₂/t clinker).",
    whatDoes: "Reflects raw meal chemistry and kiln fuel mix independent of downstream cement blending.",
    whySeeing: "Industry standard metric for comparing rotary kiln operational efficiency globally.",
  },
  "kpi-tsr": {
    title: "Thermal Substitution Rate (TSR)",
    whatIs: "Percentage of total kiln thermal heat supplied by alternative and waste-derived fuels.",
    whatDoes: "Tracks substitution of fossil fuels (petcoke, coal, gas) with biomass, RDF, and tyres.",
    whySeeing: "High TSR directly reduces fossil emissions and supports circular economy targets.",
  },
  "kpi-biogenic-co2": {
    title: "Biogenic CO₂ Memo",
    whatIs: "CO₂ emissions originating from sustainably sourced organic biomass fuels.",
    whatDoes: "Tracked as a separate memorandum item outside standard fossil accounting boundaries.",
    whySeeing: "Reported separately from fossil CO₂ as a memo item.",
  },
  "kpi-grid-mwh": {
    title: "Grid Electricity Consumption",
    whatIs: "Total electrical energy purchased from the public transmission grid in Megawatt-hours (MWh).",
    whatDoes: "Powers raw mills, finish grinding, kiln drives, blowers, and plant auxiliary systems.",
    whySeeing: "Multiplied by the grid emission factor to calculate Scope 2 indirect emissions.",
  },
  "kpi-indirect-co2": {
    title: "Indirect Grid CO₂",
    whatIs: "Scope 2 emissions resulting from off-site power generation imported into the facility.",
    whatDoes: "Accounts for the carbon footprint of electricity used during plant operations.",
    whySeeing: "Mandatory under CBAM Scope 2 requirements and corporate GHG accounting.",
  },
  "kpi-qaqc-status": {
    title: "QA/QC Overall Status",
    whatIs: "High-level indicator summarizing all automated quality checks.",
    whatDoes: "FAIL if any check fails; INCOMPLETE if any check cannot be evaluated because inputs are missing; PASS only when every check passes.",
    whySeeing: "Internal quality gate. It is not external verification.",
  },
  "kpi-evidence-status": {
    title: "Evidence Readiness Status",
    whatIs: "Completeness rating of audit-trail documentation attached to input figures.",
    whatDoes: "Flags activity rows without a linked evidence reference.",
    whySeeing: "Shows document linkage only; documents are not verified by this application.",
  },
};

export function getExplanation(key: string): Explanation {
  return (
    EXPLANATIONS[key] || {
      title: key.replace(/[-_]/g, " "),
      whatIs: "System metric or configuration parameter.",
      whatDoes: "Used in the MRV calculation pipeline or reporting view.",
      whySeeing: "Displayed as part of the plant collection dataset.",
    }
  );
}
