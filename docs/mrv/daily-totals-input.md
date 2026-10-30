# Daily totals input and regulatory readiness

The daily import adapter maps Production, Fuel and Electricity sheets into the existing MRV input model. It accepts daily interval totals, not cumulative counters or instantaneous rates. Unknown populated fields fail validation. CSV uses a Section column. Optional Setup and Constants sheets explicitly version configuration; activity-only imports preserve configuration. Raw source rows and the original file are retained through the existing import history.

The sample is synthetic and is not a vendor-native SCADA export or an official CBAM submission template. A successful import or complete daily coverage does not establish regulatory completeness or verification.

## Requirements register

| Area | Implemented in daily input | Remaining before regulatory use |
| --- | --- | --- |
| Activity | Daily production tonnes, fuel quantities/units, electricity kWh/MWh | Site-specific tag mapping, reporting day/timezone, meter calibration and reconciliation |
| Factors | Explicit NCV, CO2 factors, oxidation and biomass fractions | Approved method, applicable factor sources/validity and laboratory evidence |
| Process emissions | Existing engine/configuration | Validate chemistry, corrections and all applicable emission sources |
| CBAM | Daily data useful for reporting-period calculations | Installation/goods identifiers, boundaries, production routes, product attribution, relevant precursors, heat flows, monitoring plan and verification |
| GHG Protocol | Activity and CO2 calculation inputs | Inventory boundaries, applicable gases, Scope 2 methods/instruments and complete inventory reporting |
| Audit | Source file/row provenance, existing reading revisions | Genuine evidence, reviewer decisions and required independent verification |

2025 demo data is historical test data. It must not be represented as demonstrating the definitive CBAM regime applying from 2026. CBAM product reporting and a GHG Protocol corporate inventory are distinct accounting outputs; they must not be conflated.

Sources checked 2026-10-30:
- https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism/cbam-legislation-and-guidance_en
- https://ghgprotocol.org/scope-2-guidance

## Verification

Daily adapter tests cover 365-day input, daily/weekly/monthly/quarterly/annual/custom aggregation, missing-day coverage, unit conversion, missing factors, invalid dates/quality, duplicate identities and stable re-import hashes. Database persistence and RLS continue to use the existing user-scoped import RPC; local parser tests do not substitute for a live authenticated end-to-end upload.
