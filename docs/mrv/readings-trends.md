# Readings & trends

Replaces the two source charts on Overview with the approved Inter-font trend workspace. Uses only the Store already supplied to Overview by the existing authorized factory/reporting scope. No API, calculation, import, authentication or database schema changes.

Controls: Production/Fuel/Electricity/Raw materials, local date subset, daily/Monday-week/month aggregation, trend/table switch, chart-point inspection, keyboard-accessible period inspection, reset dates, and production companion charts for fuel/electricity. Source inspection retains original fields and provenance. Factory/reporting-period selection remains in the existing application scope bar.

Data semantics:
- Absent daily buckets and invalid quantities remain null. Recorded zero remains zero.
- Weekly/monthly sums describe available observations, not certified period completeness. The UI explicitly says they may be incomplete.
- Multi-day source intervals automatically use source-interval bars. They are never prorated or stretched into daily measurements.
- Chart date filtering includes only whole intervals. Crossing/outside and undated row counts are disclosed.
- Fuel energy is quantity × supplied NCV in GJ/unit; incomplete inputs remain missing. It is a display calculation only.
- Electricity source bars are grouped, not stacked: renewable/self-generation inputs can overlap.
- The UI inherits the application Inter font, including canvas text from computed styles. No chart dependency was added.

## Recovery point

Before any edits, remote branch `recovery/before-readings-charts-2026-11-04` was created at `8dface9a433e4973f14c5ae383fb9f1184c0291e` (main after PR #19).

If a merged change must be rolled back, revert this feature's merge commit through a new PR, run Verify, then deploy the revert. Do not force-reset main or restore an older database: this change does not write data. The recovery branch preserves the previous source tree for comparison.

## Validation

- New regression suite covers missing days, measured zero, invalid bucket values, decimal sums, Monday weeks, monthly intervals, crossing date ranges, invalid dates, fuel conversion and original row indices.
- Local suite: 161 passed, hosted staging suite skipped because credentials were not configured. Embedded PostgreSQL concurrency suite excluded locally because it requires a non-root PostgreSQL runtime; GitHub Verify runs that suite.
- Production build, TypeScript, changed-file ESLint and production bundle scan passed.
- Isolated browser preview uses synthetic fixtures and actual components; tested category tabs, local dates/reset, all aggregations, chart/table modes, point-click source inspection, source provenance, companion navigation, missing/zero display, 390px mobile overflow and runtime errors.
- Preview is not a signed-in production acceptance test. Deployment and live acceptance follow review/merge.
