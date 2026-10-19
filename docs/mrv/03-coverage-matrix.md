# 03 — Cement Process & Reporting-Boundary Coverage Matrix (Sprint 1)

Status values: **Implemented** (works in code today, methodology not yet validated), **Partial**, **Missing**,
**Conditional** (needed only for some plants/profiles), **Outside boundary** (pending D-04).
No inclusion/exclusion decision is final until reporting profiles are declared (D-04).

## Industrial process coverage

| Process / data domain | Status | Current implementation | Gap |
|---|---|---|---|
| Raw-material receipt and preparation | Missing | — | No receipts, stock, moisture-corrected masses |
| Raw meal & carbonate-bearing materials | Partial | `04_Raw_Material_Input`: qty, CaCO₃ %, MgCO₃ %, conversion (Method A) | No organic carbon, non-carbonate CaO/MgO, dry/wet basis, per-material sources |
| Kiln / preheater / precalciner / clinker production | Partial | Clinker produced per row, single "Kiln Line" text field | No process-unit model; no kiln operating data |
| Conventional fuels | Implemented | Qty × NCV × EF × Ox | Units ignored (G-12); no lab-vs-default distinction |
| Alternative fuels | Partial | Same formula; "alt" detected by name or biomass > 0 | Classification heuristic (`calcEngine.ts:201`) |
| Fossil / biogenic fractions | Partial | Biomass fraction applied to whole-fuel EF; biogenic memo | No evidence of fraction determination method |
| Kiln dust / bypass dust / losses | Missing | Setup flag "CKD correction applied" read but unused | Not in any formula |
| Clinker storage, transfers, purchases, sales | Missing | Produced − used only (G-16) | — |
| Purchased clinker & precursor data | Missing | — | Needed for product allocation (G-13) |
| Cement grinding, blending, grades | Partial | Cement produced, one "Cement Type" text per row | No grade-level allocation; single primary product |
| Gypsum, limestone, slag, fly ash, others | Partial | Gypsum, limestone, "other" | No slag/fly ash/pozzolana columns; used only in MB-03 |
| Electricity imports | Implemented | Grid MWh × grid EF | EF provenance unverified (G-18) |
| Onsite generation / exports / internal consumption | Partial | Self-gen MWh × EF captured; exports absent | Self-gen CO₂ not added to totals; risk of double counting with fuel sheet |
| Waste-heat recovery | Missing | "Renewable MWh" column only | — |
| Auxiliary combustion | Missing | Not distinguished from kiln fuel (G-14) | — |
| Laboratory analyses, meter records | Partial | Evidence register IDs; DCS tag map sheet | No values linked to lab results or meter IDs |

## Core calculations and controls

| Calculation / control | Status | Note |
|---|---|---|
| Process CO₂ — Method A (input) | Partial | Raw-meal carbonate stoichiometry; see G-17 |
| Process CO₂ — Method B (output) | Partial | Clinker × constant EF 0.5325 (unverified, G-18) |
| Fuel energy & combustion CO₂ | Implemented | Arithmetic CONFIRMED on demo (T5) |
| Electricity emissions | Partial | Location-based single EF only; no market-based option |
| Specific Heat Consumption | Partial | Energy basis (NCV) implicit; denominator clinker produced; numerator all fuels (G-14) |
| Clinker-to-cement ratio | Implemented | Clinker used / cement produced; boundary undefined |
| Clinker material balance | Missing | (G-16) |
| Cement material balance | Partial | MB-03 ±2 % check |
| Product-level allocation | Missing | Single plant-wide intensity (G-13) |
| Fossil/biogenic separate disclosure | Partial | Biogenic memo shown separately |
| Double-counting prevention | Missing | No controls (e.g. self-generation vs fuel) |
| Missing/estimated/corrected/substituted data | Missing | Missing → 0 (G-05); no data status |
| Precision, rounding, uncertainty | Missing | (G-19); no uncertainty |

## Reporting scope separation

| Reporting profile | Status | Note |
|---|---|---|
| Facility corporate GHG inventory | Not separated | "Total Embedded CO₂" mixes facility totals and product language |
| Product embedded emissions (e.g. CBAM) | Not separated / unvalidated | Labels reference CBAM; rules not validated against the Q1 2025 basis (D-04, VT-03) |
| Internal operating KPIs (SHC, TSR, clinker factor) | Partial | Present; definitions undocumented |
| External verification status | Missing | "Assurance status" is free text in Setup; UI/PDF claim verification (G-10) |
