# TRACE FORCE MRV — Cement QA/QC Analytics Platform

A React + Next.js analytics platform for cement plant emissions reporting. Upload your MRV collection workbook and the platform parses all 14 sheets, runs automated quality checks, calculates emissions, and produces compliance-ready outputs — entirely in the browser.

Built to meet the data traceability and quality standards of ISO 14064, the GCCA/CSI Cement CO2 and Energy Protocol, and EU CBAM reporting requirements.

---

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and upload a schema-compatible `TRACE_FORCE_MRV_Cement_QAQC_V28_Collection_Workbook.xlsx` file.

---

## Project structure

```
app/                 Next.js App Router pages
components/          Layout, charts, and shared UI
context/             Workbook store and explainer state
lib/                 Parser, formatter, export, routes
styles/              Design system CSS
```

---

## Technology

- **Next.js 16** (App Router) + **React 19** + TypeScript
- **SheetJS (xlsx)** — in-browser Excel parsing
- **Chart.js 4** — charts and gauges
- **jsPDF** — client-side PDF report generation
