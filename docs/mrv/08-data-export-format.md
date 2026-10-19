# 08 — Data Export Format (re-importable) vs Presentation Reports

## Two distinct export families

| Export | Button | File | Re-importable | Contains |
|---|---|---|---|---|
| **Data package** | "Export Data (.json)" | `TRACE_FORCE_MRV_Data_<quarter>.json` | **Yes** (upload dialog accepts `.json`) | Inputs + per-row provenance. No calculated values. |
| Presentation workbook | "Report (.xlsx)" | `TRACE_FORCE_MRV_Report_<quarter>.xlsx` | **No** — importer rejects it explicitly | Inputs, computed results, QA, assertions; `_EXPORT_INFO` marker sheet |
| PDF report | "Get Report" | `TRACE_FORCE_MRV_Internal_Report_<quarter>_<date>.pdf` | No | Internal QA/QC working report |

Synthetic datasets prefix every filename with `SYNTHETIC_DEMO_` and carry a synthetic banner/notice in every format.

## Data package schema (version 1)

```jsonc
{
  "format": "trace-force-mrv/data-package",   // required, exact
  "version": 1,                               // required; other versions rejected
  "exportedAt": "2026-10-19T10:00:00.000Z",
  "synthetic": false,                         // true for demo data; preserved on re-import
  "notice": "…",                              // human-readable statement (synthetic notice when applicable)
  "source": { "origin": "workbook", "filename": "plant.xlsx", "revision": "r-1a2b3c4d" },
  "inputs": {
    "meta": { "origin": "workbook", "synthetic": false, "filename": "plant.xlsx", "importedAt": "…" },
    "setup": { "Installation / site": "…", "Period start": "2025-01-01", "…": "…" },
    "setupRows": [], "readme": [], "dcsMap": [], "fuelDefaults": [], "regulatory": [],
    "production":  [ { "Date": "2025-01-31", "Clinker Produced t": 520000, "…": "…", "_source": { … } } ],
    "rawMaterial": [ … ], "kilnFuel": [ … ], "electricity": [ … ],
    "inventory":   [ { "Date": "…", "Material": "Clinker", "Opening Stock t": …, "Purchased t": …, "Dispatched t": …, "Closing Stock t": …, "Evidence ID": "…" } ],
    "constants":   [ { "Constant / Factor": "Selected clinker process EF", "Value": 0.5325, "…": "…" } ],
    "evidence":    [ { "Evidence ID": "…", "Status": "Mapped|Pending|Missing", "…": "…" } ]
  }
}
```

### Row provenance (`_source`)

| Field | Meaning |
|---|---|
| `origin` | `workbook` · `manual` · `demo` · `data-package` (origin of the row, preserved across re-imports) |
| `file`, `sheet`, `row` | Source workbook, sheet and 1-based spreadsheet row |
| `raw` | Original cell values **before** normalization (e.g. `"520,000"`), including workbook-computed columns that the engine ignores |
| `previous` | Original provenance when the row was later edited in manual entry |

### Import rules

1. `format` and `version` must match; required input arrays must exist; otherwise the file is rejected and the active
   dataset is kept.
2. Inputs are recalculated by the shared engine; no calculated value is read from the package.
3. Dataset `meta.origin` becomes `data-package`; row `_source` is kept unchanged; `synthetic` is preserved.
4. Values are parsed with the same strict numeric rules as workbooks (ambiguous text such as `520.000` is rejected).

Acceptance coverage: AT-A10 (round-trip of inputs, provenance and identical results), AT-A11 (synthetic flag survives).
