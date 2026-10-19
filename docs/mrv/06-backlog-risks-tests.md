# 06 — Prioritized Backlog, Risk Register and Test Strategy (Sprint 1)

Effort: S ≈ ≤1 wk, M ≈ 1–2 wk, L ≈ 2–4 wk for one full-stack engineer with MRV reviewer support. Estimates are
planning figures, not commitments.

## 10-sprint backlog (revised per Directive 02)

| Sprint | Scope (smallest coherent increment) | Key gaps closed | Depends on | Effort | Owner |
|---|---|---|---|---|---|
| 1 | Assessment & plan | — | — | done | Architect |
| 1b | **Foundation repairs (mandatory, delivered with Directive 02):** strict numeric parsing; no fabricated PASS/Mapped; NOT_EVALUATED for missing period/stock inputs; single calculation path with workbook values as assertions; failed import keeps dataset; explicit draft resolution; synthetic labelling; wording; re-importable data package; provenance; Vitest + decimal.js | G-01–G-05, G-08, G-10, G-11, G-19 (engine), G-23 | — | done (see 09) | Engineer |
| 2 | Server tier + Postgres (provider chosen after deployment inspection) + auth skeleton; tenant/facility scope with composite FKs + RLS; ref units; move engine server-side; CI running `npm test` | G-05, G-09, G-12, G-22 | D-01 decision recorded (AD-02/03), deployment inspection | L | Architect + Eng |
| 3 | Server-side import: preserved file + SHA-256, staging, raw_source_record, row-level errors, duplicate detection, schema versions; manual entry posts to the same endpoint | G-15, G-20, G-24, G-25, G-27 | S2, VT-06 | L | Data Eng |
| 4 | Frozen Q1 reference set, independent oracle, factor register, discrepancy register F01–F06; **WP-AI-1 design** | G-13, G-14, G-16–G-18 | S3, VT-01…VT-04 (real data) | M–L | MRV Calc Eng |
| 5 | Versioned engine, calculation_job vs immutable calculation_snapshot (+ snapshot inputs), lineage JSON, product_allocation, inventory reconciliation for all materials; **WP-AI-1 build** | G-06, G-07, G-13, G-16 | S4 | L | MRV Calc Eng |
| 6 | QA/QC rule registry, issues, waivers, approval blocking; completeness rules in `ref.completeness_rule`; **WP-AI-3 engine scenario API** | G-04 | S5 | M | QA Lead |
| 7 | Evidence files (private storage), role_assignment scopes, SoD, period lifecycle, locking, verification_statement events | G-26, G-09 | S6 | L | Security Eng |
| 8 | Full Q1 2025 cycle on real data, report from frozen snapshot, AT-01…AT-10; **WP-AI-2 report assessment** | G-10, G-11 | S7, D-02, D-03 | M | QA + MRV |
| 9 | Engineer-focused UI/workflow; **WP-AI-3 scenario UI**; AI features behind feature flag with audit log | UX | S8 | M | UX |
| 10 | Security review (incl. AI prompt-injection / data-leak tests), backup/restore, monitoring, pilot runbooks, 2nd-plant config | G-21 | S9 | M–L | Ops/Sec |

## AI work packages (reserved; advisory only)

Hard rules for every AI package: AI **must not** calculate authoritative totals, invent savings or factors, approve
or verify reports, or modify official source data. AI reads immutable snapshots and lineage only; every AI output is
stored with model id, prompt version, input snapshot id and citations, and is labelled "AI-generated, advisory".

| WP | Deliverable | Inputs | Acceptance gate (must pass before release) |
|---|---|---|---|
| **WP-AI-1 Explain this number** (design S4, build S5) | Per-metric explanation: formula, contributing inputs with values/units, factors with sources, QA checks affecting it | `calculation_result.lineage`, snapshot inputs/factors | (a) Every number quoted in the explanation exists verbatim in the snapshot (automated diff); (b) every input cited resolves to a snapshot_input id; (c) metric with missing inputs is explained as "not calculated", never estimated; (d) 0 tolerance for numbers not in lineage on a 50-metric synthetic test set. |
| **WP-AI-2 Report assessment** (S8) | Findings list: issue, severity, cited evidence/QA ids, suggested action owner | Snapshot, QA results, completeness, evidence register, report version | (a) Each finding cites ≥1 resolvable id; uncited findings are discarded automatically; (b) never states "verified/compliant"; (c) detects seeded defects in synthetic fixtures (missing evidence, out-of-period row, stock imbalance) with recall ≥ 90 %; (d) human reviewer accepts/rejects each finding — AI cannot change status. |
| **WP-AI-3 Mitigation scenarios** (API S6, UI S9) | User/AI proposes parameter changes (e.g. TSR +10 pp, clinker factor −0.02); **the deterministic engine** computes results as a labelled scenario snapshot | Baseline snapshot + explicit parameter deltas | (a) Scenario numbers are produced only by `calculateStore`-equivalent engine (test: AI text numbers equal engine output); (b) scenarios are never written to official activity data; (c) every scenario shows its deltas and baseline id; (d) no savings figure is displayed without an engine run id. |

## Initial risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R-01 | Figures from current app already used externally (G-01/02/03) | Unknown | High | Inform stakeholders; treat prior outputs as unverified; Sprint 1b fixes | Product |
| R-02 | Real Q1 2025 data unavailable or incomplete | Medium | Blocks acceptance | VT-02 early; define minimum dataset | Plant data owner |
| R-03 | Reporting basis for Q1 2025 cannot be authoritatively confirmed | Medium | High | Mark profile "unvalidated" (ADR rules); no compliance claims | MRV lead |
| R-04 | Introducing backend changes deployment model (static → server) | High | Medium | ADR-002 review; staged rollout; keep static demo build | Architect |
| R-05 | Workbook variants (9/13/14 sheets) differ semantically | High | High | Versioned schema contracts; no assumed equivalence | Data Eng |
| R-06 | Floating-point/rounding differences vs Excel | Medium | Medium | Decimal policy; pre-declared tolerances | Calc Eng |
| R-07 | Confidential plant data in repo/logs | Medium | High | Keep `*.xlsx` ignored; add `.env*` to `.gitignore`; encrypted object storage | Security |
| R-08 | Vulnerable parser dependency processing untrusted files | Medium | High | VT-06; upgrade xlsx from SheetJS CDN build; server-side parsing with size limits | Security |
| R-09 | Scope creep into ERP/dashboard features | Medium | Medium | Gate each sprint on exit evidence | Product |

## Test strategy

| Layer | Tooling (proposed, D-05) | Content |
|---|---|---|
| Unit (domain) | Vitest | Units/conversions, each formula, missing-vs-zero, rounding policy |
| Reference oracle | Independent spreadsheet/script, not importing `domain/calc` | Q1 reference cases with pre-declared tolerances |
| Property / perturbation | Vitest | Fuel/clinker/electricity perturbations change only dependent outputs |
| Import contract | Vitest + generated workbook fixtures (formatted numbers, dates, wrong schema, duplicates) | Reproduces T1–T3 as regression tests |
| API / authorization | Integration tests against test DB | Cross-tenant denial, role/SoD, approval blocking |
| End-to-end | Playwright | Upload → validate → calculate → QA → approve → report |
| Non-functional | Benchmarks, restore drills | S10 |

Sprint 1 tests T1–T6 (manual, browser-driven) are the first regression candidates. Synthetic fixtures are always
labelled synthetic; no fixture is described as plant data.
