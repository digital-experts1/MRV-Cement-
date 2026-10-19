# TRACE FORCE — Cement MRV Programme Documentation

Durable project documentation for the 10-sprint gated programme.
Assessment date: Sprint 1 (baseline commit `eba7e43`).

## Status

| Sprint | Title | Status |
|---|---|---|
| 1 | Baseline, architecture audit, gap analysis | **Submitted for review — STOP** |
| 2 | Canonical data model, units, period foundation | Blocked: awaiting Sprint 1 approval + decisions D-01…D-04 |
| 3–10 | See [06-backlog-risks-tests.md](06-backlog-risks-tests.md) | Not started |

## Documents

| # | Document | Purpose |
|---|---|---|
| 01 | [Architecture assessment](01-architecture-assessment.md) | Inventory, data flow, trust assessment |
| 02 | [Gap register](02-gap-register.md) | Evidence-backed findings, F01–F09 and AT-01–AT-10 mapping |
| 03 | [Coverage matrix](03-coverage-matrix.md) | Cement process and reporting-boundary coverage |
| 04 | [Target architecture & ADRs](04-target-architecture-adrs.md) | Module boundaries, preserve/refactor/replace, ADR-001…ADR-008 |
| 05 | [Proposed data model](05-proposed-data-model.md) | Canonical entities for Sprint 2 |
| 06 | [Backlog, risks, test strategy](06-backlog-risks-tests.md) | 10-sprint backlog, risk register, test strategy |
| 07 | [Sprint 1 test evidence](07-sprint1-test-evidence.md) | Tests actually executed, expected vs actual |

Documents still to be created in later sprints: domain & unit dictionary (S2), methodology & factor register (S4),
Q1 reference calculation package (S4), discrepancy investigation register (S4), permissions & workflow matrix (S7),
deployment & recovery runbooks (S10).

## Evidence classification used throughout

- **CONFIRMED** — reproduced by an executed test or unambiguous in code.
- **PARTIALLY VERIFIED** — code path confirmed, runtime impact or external fact not yet tested.
- **UNVERIFIED** — no evidence available; a verification task is recorded.
- **NOT APPLICABLE** — outside the current system.

## Decisions required before Sprint 2 (owner: product/MRV lead)

| ID | Decision | Why it blocks |
|---|---|---|
| D-01 | Approve introducing a server tier (Next.js route handlers / server actions) + PostgreSQL + object storage + authentication. This contradicts the current `AI_RULES.md` rule "all processing stays client-side; no backend". | Server-side permissions, persistence, tenancy, locking and evidence storage are impossible in the current static client-only app (G-09). |
| D-02 | Supply the audit document containing F01–F09 and AT-01–AT-10. | F07–F09 and all AT definitions are UNVERIFIED (not in repository or chat history). |
| D-03 | Supply the real Q1 2025 source workbook(s) and the 9-/13-/14-sheet reference versions, with owner and confidentiality rules. | No plant data exists in the repository (`*.xlsx` is git-ignored); only synthetic demo data. Final acceptance depends on it. |
| D-04 | Declare reporting profiles in scope for Q1 2025 (e.g. corporate GHG inventory, CBAM transitional-period product report, internal KPIs) and the authoritative basis for each. | Methodology, boundary and electricity treatment cannot be validated without a declared basis (G-13, G-18). |
| D-05 | Approve dev dependencies for testing (e.g. Vitest) and a decimal library (e.g. decimal.js). | No test framework exists (G-23); numeric policy (G-19). |
