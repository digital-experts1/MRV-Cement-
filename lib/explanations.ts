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
    whySeeing: "Establishes accountability and regulatory compliance under MRV governance protocols.",
  },
  "nav-setup": {
    title: "Setup & Reporting Period",
    whatIs: "Baseline plant configuration and verification timeframe.",
    whatDoes: "Defines the reporting quarter, facility boundary, kiln technology, and product lines.",
    whySeeing: "Sets the operational scope that governs all subsequent emission calculations.",
  },
  "nav-dcs": {
    title: "DCS / ERP / Lab Boundary",
    whatIs: "Plant instrumentation and data acquisition mapping register.",
    whatDoes: "Maps raw data streams from Distributed Control Systems, weighfeeders, and lab analyzers.",
    whySeeing: "Proves to third-party verifiers that data originates from calibrated physical meters.",
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
    whatDoes: "Transforms physical activity data into certified Scope 1 and Scope 2 CO₂ figures.",
    whySeeing: "Provides full mathematical transparency and audit traceability from raw inputs to reported totals.",
  },
  "nav-qaqc": {
    title: "QA/QC Checks",
    whatIs: "Automated 18-rule data quality assurance matrix.",
    whatDoes: "Validates mass balances, physical bounds, thermal efficiencies, and document completeness.",
    whySeeing: "Detects reporting discrepancies, instrumentation drift, or missing evidence before official filing.",
  },
  "nav-reportouts": {
    title: "Report Outputs",
    whatIs: "Structured compliance schedules formatted for regulatory bodies.",
    whatDoes: "Aggregates verified values into standard reporting templates (CBAM, EU ETS, national registry).",
    whySeeing: "Ready-to-submit summary required by competent authorities and verification bodies.",
  },
  "nav-evidence": {
    title: "Evidence Register",
    whatIs: "Auditable archive linking every number to physical documentation.",
    whatDoes: "Catalogs calibration certificates, weighbridge tickets, purchase invoices, and lab reports.",
    whySeeing: "Unsubstantiated data fails third-party verification; this provides proof of evidence readiness.",
  },
  "nav-regulatory": {
    title: "Regulatory References",
    whatIs: "Compendium of applicable climate standards and legal statutes.",
    whatDoes: "Maps plant operations to EU CBAM regulations, GCCA guidelines, and local environmental laws.",
    whySeeing: "Clarifies compliance thresholds, penalty triggers, and reporting obligations.",
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
    whatDoes: "Parses all 14 sheets of a schema-compliant TRACE FORCE MRV collection workbook.",
    whySeeing: "Allows you to load, validate, and analyze your plant dataset entirely inside your browser.",
  },
  "btn-download-pdf": {
    title: "Download Report",
    whatIs: "Executive PDF export utility.",
    whatDoes: "Generates a publication-grade MRV verification report with key KPIs, breakdown, and QA status.",
    whySeeing: "Enables quick sharing with plant leadership, environmental committees, and external auditors.",
  },
  "btn-export-excel": {
    title: "Export Excel",
    whatIs: "Verified workbook re-export generator.",
    whatDoes: "Compiles all parsed data, verified calculations, and QA check results into a structured spreadsheet.",
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
    whySeeing: "Official headline figure reported to regulatory bodies and international buyers.",
  },
  "kpi-see-cement": {
    title: "Specific Embedded Emissions — Cement",
    whatIs: "Emissions intensity metric expressed as tons of CO₂ per ton of finished cement produced.",
    whatDoes: "Normalizes plant emissions against production volume for benchmarking and carbon border adjustment.",
    whySeeing: "Benchmark figure that directly determines CBAM certificate purchase requirements.",
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
    whySeeing: "Zero-rated under EU ETS and CBAM rules, but mandatory to declare for carbon neutrality verification.",
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
    whatIs: "High-level health indicator summarizing results from all 18 automated quality rules.",
    whatDoes: "Returns PASS only when zero critical balance or physical integrity checks fail.",
    whySeeing: "Prevents filing non-compliant or inaccurate datasets with auditing authorities.",
  },
  "kpi-evidence-status": {
    title: "Evidence Readiness Status",
    whatIs: "Completeness rating of audit-trail documentation attached to input figures.",
    whatDoes: "Flags any unverified data points that lack supporting invoices or meter calibration sheets.",
    whySeeing: "Assures auditors that data is traceable to verified primary documentation.",
  },
};

export function getExplanation(key: string): Explanation {
  return (
    EXPLANATIONS[key] || {
      title: key.replace(/[-_]/g, " "),
      whatIs: "System metric or configuration parameter.",
      whatDoes: "Used in the MRV calculation pipeline or reporting view.",
      whySeeing: "Displayed as part of the plant collection and verification dataset.",
    }
  );
}
