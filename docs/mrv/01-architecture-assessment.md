# 01 — Current Architecture Assessment (Sprint 1)

Baseline: commit `eba7e43`. Next.js 16.3.5, React 19, TypeScript strict, xlsx 0.18.5, jspdf 2.5.2, chart.js 4.

## 1. Inventory

| Concern | What exists | Evidence | Classification |
|---|---|---|---|
| Application type | Static client-side SPA. All 18 routes prerender as static (`○`). | `run_build` output, Sprint 1 | CONFIRMED |
| Backend / API | None. No route handlers, server actions or API calls. | No `app/api`, no `fetch(` to own API; build output | CONFIRMED |
| Database / migrations | None. | No ORM, SQL or migration files | CONFIRMED |
| Background jobs | None. | — | CONFIRMED |
| Authentication / authorization | None. Anyone with the URL has full use. | No auth library or session code | CONFIRMED |
| Tenancy / facilities | None. One in-memory "store" with a free-text site name. | `lib/types.ts` `Store` | CONFIRMED |
| Persistence | In-memory React state only; lost on refresh. Data-entry drafts in `localStorage`. | `context/StoreContext.tsx:29`; `app/dataentry/page.tsx:162` | CONFIRMED |
| Import | Browser-side SheetJS parse of one 14-sheet workbook schema. | `lib/parser.ts:192` | CONFIRMED |
| Manual entry | "Data Entry Studio" form → `calculateStore()`. | `app/dataentry/page.tsx:198-200, 306-308` | CONFIRMED |
| Calculations | `lib/calcEngine.ts` — but **only used for manual entry and demo data**, never for uploaded workbooks. | See §3 | CONFIRMED |
| QA/QC | 18 hardcoded checks inside `calculateStore`; uploaded workbooks use the workbook's own `09_QAQC_Checks` sheet verbatim. | `lib/calcEngine.ts:310-460`; `lib/parser.ts` `parse09` | CONFIRMED |
| Evidence | A register of evidence IDs/status strings. No files stored. | `parse11`; `11_Evidence_Register` | CONFIRMED |
| Reports | Client-side jsPDF (4 pages) and SheetJS export. | `lib/export.ts` | CONFIRMED |
| Tests / CI | None. No test script in `package.json`. | `package.json` scripts | CONFIRMED |
| Workbook version contract | Sheet names + header labels on row 3 for 13 sheets (`13_Dashboard` name only). Version label "V28" in copy; template README says "v0.2". | `lib/parser.ts:4-140`; `lib/export.ts:430` | CONFIRMED |

## 2. Data-flow diagram (as-is)

```
                ┌──────────────────────── Path U: workbook upload ─────────────────────────┐
 .xlsx/.xlsm ──►│ XLSX.read → sheet_to_json(raw:false = FORMATTED TEXT) → parseFloat        │
                │   03–06 input rows ──► store.production/rawMaterial/kilnFuel/electricity │ (display only)
                │   08_Calculations  ──► store.calculations   ◄── KPIs, PDF, export, charts │
                │   09_QAQC_Checks   ──► store.qaqc           ◄── QA badge, PDF             │
                │   10_Report_Outputs──► store.reportOutputs                               │
                │   13_Dashboard     ──► store.dashboard                                   │
                │   NO recalculation. NO cross-check between inputs and 08/09/10/13.       │
                └───────────────────────────────────────────────────────────────────────────┘
                ┌──────────────── Path M: manual entry / demo ────────────────┐
 form / demo ──►│ calculateStore(): per-row calc (rounded) → totals → 18 checks │──► same Store shape
                └──────────────────────────────────────────────────────────────┘
 Store (React context, memory only) ──► pages (some re-aggregate rows) ──► PDF / Excel export
```

**Two independent calculation sources feed the same screens and reports.** For Path U the figures are whatever
cached values Excel last wrote into `08_Calculations`; for Path M they are `calcEngine.ts`. They are never compared.

## 3. Representative value trace (workbook row → report)

Trace of "Clinker Produced" for an uploaded workbook (executed in Sprint 1, test T2):

| Step | Location | Observed |
|---|---|---|
| Source cell | `03_Production_Input!E4` = 175000, number format `#,##0` | Excel shows `175,000` |
| Parse | `parser.ts:146` `raw:false` returns `"175,000"`; `parseNum` → `parseFloat` → **175** | Production page shows **175** |
| Aggregate | Not computed from inputs on Path U | — |
| KPI / report | `08_Calculations` "Clinker Produced" Value cell (template value 0) | Overview, PDF: **0 t** |

Trace for manual/demo (Path M): `calcProductionRow` → `calculateStore` sum (line ~172) → `calcRows` → PDF
`export.ts:146`. Arithmetic matches an independent hand calculation (test T5); methodology is not yet validated.

## 4. Frontend-only and duplicated logic

| Item | Location | Note |
|---|---|---|
| Fuel energy/CO₂ formula duplicated | `app/dataentry/page.tsx:912-922` vs `calcEngine.ts:calcFuelRow` | Live-preview copy in UI |
| Clinker factor + PASS rule duplicated | `app/dataentry/page.tsx:582-583` | Own 0.25–1.0 threshold |
| Raw-material & electricity CO₂ duplicated | `app/dataentry/page.tsx` (~780-823, ~1130-1163) | — |
| Re-aggregation of fuel/electricity rows | `app/kilnfuel/page.tsx:22-28`, `app/electricity/page.tsx:21-22`, `app/analytics/page.tsx:124-127` | Can disagree with `08_Calculations` on Path U |
| Fallback CO₂ breakdown | `lib/breakdown.ts` | Builds chart from calc rows when dashboard sheet empty |
| All calculation code runs in browser | `lib/calcEngine.ts` | No authoritative server implementation |

## 5. Mocked / hardcoded indicators

| Item | Location | Classification |
|---|---|---|
| Blank template ships `Status = PASS` on all 18 checks and `QA/QC Status = PASS` | `lib/export.ts:549-566, 608` | CONFIRMED (T1) |
| Template evidence rows pre-set to `Mapped` | `lib/export.ts:585-588` | CONFIRMED |
| PR-01 "Input period aligned" always `PASS` (no date check) | `lib/calcEngine.ts:401-410` | CONFIRMED (code) |
| MB-04 "Clinker stockpile reconciliation" always `PASS` | `lib/calcEngine.ts:412-421` | CONFIRMED (demo: −200 t → PASS) |
| PDF defaults missing QA status to `PASS`, evidence to `Mapped` | `lib/export.ts:78-79` | CONFIRMED (code) |
| Data-entry badge defaults to `PASS` | `app/dataentry/page.tsx:316` | CONFIRMED (code) |
| "Evidence covers: … Fuel (×4), Electricity (×3)…" static text | `app/overview/page.tsx:263` | CONFIRMED (T1 shows it with 4-row template) |
| Compliance/verification claims | `export.ts:57,122,276`; `layout.tsx:22`; `dataentry/page.tsx:330,1492`; `reportouts/page.tsx:48`; `calculations/page.tsx:108` | CONFIRMED |
| Synthetic demo uses a real plant name and accreditation notes | `calcEngine.ts:519, 557-559` | CONFIRMED |

## 6. What is trustworthy today

- **Trustworthy (with limits):** `calcEngine.ts` arithmetic for the synthetic demo matches independent hand
  calculation (T5). This says nothing about methodology, boundary or factor validity.
- **Not trustworthy:** any figure, QA/QC status or evidence status shown for an **uploaded** workbook (G-01, G-02, G-03).
- **Not trustworthy:** any "verified", "compliant" or "PASS" label in UI or PDF (G-04, G-10).
- **Preserved and working:** UI shell, navigation, upload dialog, schema/header check, demo flow, PDF/Excel generation mechanics, charts.

## 7. Security, tenancy and data-loss risks (summary)

See gap register G-09, G-20, G-21, G-22, G-25, G-27. Key points: no authentication or isolation (no multi-user
capability at all); no file-size limit; dependency advisories to confirm; refresh loses the loaded dataset; a
data-entry draft silently takes precedence over a loaded workbook.
