# TRACE FORCE MRV — Cement QA/QC Analytics Platform

A React + Next.js platform for cement plant emissions MRV work. Upload an MRV collection workbook, enter data online, or
re-import a data export; the platform validates inputs, recalculates emissions with decimal arithmetic, and runs QA/QC
checks. Workbook totals and statuses are used only as comparison assertions.

**Status:** internal working tool. Outputs are not externally verified and make no regulatory-compliance claim. No real
plant data has been validated in this repository (Q1 2025 acceptance is pending real data). Demo data is synthetic and
labelled as such everywhere.

---

## Getting started

```bash
npm install
npm run dev     # development server
npm test        # Vitest acceptance/regression suite (synthetic fixtures)
```

Copy `.env.example` to `.env.local` for local configuration (no variables are required yet). Never commit `.env*` files.

---

## Project structure

```
app/                 Next.js App Router pages
components/          Layout, charts, and shared UI
context/             Dataset store and explainer state
lib/                 Parser, calculation engine, QA checks, exports, data package
tests/               Vitest acceptance tests and synthetic fixtures
docs/mrv/            Architecture, data model, backlog, test evidence
```

## Data formats

- **Input workbook** (`.xlsx`/`.xlsm`): 14-sheet collection schema, optional `14_Inventory_Movements`.
- **Data export** (`.json`): re-importable inputs + provenance — see `docs/mrv/08-data-export-format.md`.
- **Report exports** (PDF / `.xlsx`): presentation only, not re-importable.

---

## Technology

- **Next.js 16** (App Router) + **React 19** + TypeScript
- **decimal.js** — authoritative arithmetic
- **SheetJS (xlsx)** — Excel parsing
- **Chart.js 4** — charts
- **jsPDF** — PDF report generation
- **Vitest** — tests
