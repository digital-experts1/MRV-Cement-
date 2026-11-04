# Portfolio analytics dashboard

Recovery point: `recovery/before-portfolio-dashboard-2026-11-04` at `9781e5e42cb925ec3840f86d7084702f03fbe433`.

The dashboard reuses the existing authorized factory results, reporting range, search, and attention filter. It does not change authorization, calculation methods, automatic calculation permissions, or persisted data.

Production and emissions use paired bars. Energy switches between GJ and MWh instead of mixing units. Intensity uses each factory's saved value, never an average. Bars open a factory; Show values provides a keyboard-accessible exact-value table. The existing detailed results table retains all issues, evidence counts, timestamps, and actions.

KPI sums and composition/share donuts require the existing full-portfolio comparability gate. Missing metrics further withhold the relevant sum; stale values are null. Zero totals do not render a misleading donut. Production shares are omitted for a single factory or more than six factories. These are management sums before transfer reconciliation, not consolidated regulatory totals. No historical trend is inferred from period aggregates.

Chart fonts inherit the application font. Reduced-motion settings disable chart animation. Mobile panels stack; wide factory comparisons and exact-value tables scroll within their panel.

Validation: TypeScript, component ESLint, existing portfolio regression tests, production build, and a browser fixture covering metric switches, units, values, factory navigation, stale/missing results, zero totals, single/empty views, and mobile overflow. Fixture data is synthetic and not inserted into the application.
