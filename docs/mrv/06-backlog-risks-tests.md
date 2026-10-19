# 06 — Prioritized Backlog, Risk Register and Test Strategy (Sprint 1)

Effort: S ≈ ≤1 wk, M ≈ 1–2 wk, L ≈ 2–4 wk for one full-stack engineer with MRV reviewer support. Estimates are
planning figures, not commitments.

## 10-sprint backlog

| Sprint | Scope (smallest coherent increment) | Key gaps closed | Depends on | Effort | Owner |
|---|---|---|---|---|---|
| 1 | Assessment & plan (this package) | — | — | done | Architect |
| 1b (optional quick wins, ≤2 days) | Remove fabricated PASS/Mapped from blank template; parse raw numeric values; label demo as synthetic with fictitious plant name; remove unsupported "verified/compliant" copy | G-02, G-03, G-10, G-11 | Approval | S | Engineer |
| 2 | Server tier + Postgres + auth skeleton; tenant/facility/period/basis; units & conversions; decimal policy; test runner + CI | G-05, G-09, G-12, G-19, G-22, G-23 | D-01, D-05 | L | Architect + Eng |
| 3 | Server-side import: preserved file + SHA-256, staging, row-level errors, duplicate detection, schema versions, manual entry via same path | G-01, G-08, G-15, G-20, G-24, G-25, G-27 | S2, VT-02, VT-06 | L | Data Eng |
| 4 | Frozen Q1 reference set, independent oracle, factor register, discrepancy register F01–F06 | G-13, G-14, G-16, G-17, G-18 | S3, VT-01…VT-04 | M–L | MRV Calc Eng |
| 5 | Versioned pure engine, calculation runs, clinker balance, allocation, stale detection | G-06, G-07, G-13, G-16 | S4 | L | MRV Calc Eng |
| 6 | QA/QC rule registry, issues, waivers, approval blocking | G-04 | S5 | M | QA Lead |
| 7 | Evidence files, roles & SoD, period lifecycle, locking, revisions | G-26, G-09 | S6 | L | Security Eng |
| 8 | Full Q1 2025 cycle, report from frozen run, AT-01…AT-10 executed | G-10, G-11 | S7, D-02, D-03 | M | QA + MRV |
| 9 | Engineer-focused UI/workflow on top of persisted data | UX | S8 | M | UX |
| 10 | Security review, backup/restore, monitoring, pilot runbooks, 2nd-plant config | G-21 | S9 | M–L | Ops/Sec |

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
