# AI Rules — TRACE FORCE MRV

## Tech Stack
- **Next.js 16 (App Router)** with **React 19** and **TypeScript** (strict mode), run as a **modular monolith**.
- Routing is file-based: each page lives in `app/<route>/page.tsx`; the root layout is `app/layout.tsx`.
- Client UI state (active dataset cache, sidebar, upload dialog) lives in React Context under `context/`, wired in `app/providers.tsx`.
- **decimal.js** for all authoritative arithmetic. **SheetJS (`xlsx`)** for workbook parsing (`lib/parser.ts`).
- **Chart.js 4** via `components/charts/ChartCanvas.tsx`. **jsPDF** (+ `xlsx`) for exports (`lib/export.ts`).
- **Vitest** for tests (`npm test`, `tests/**/*.test.ts`).
- Plain CSS design system in `styles/` (`main.css`, `components.css`, `print.css`) imported via `app/globals.css`.
- Fonts via `next/font/google` (Inter + JetBrains Mono). Imports use the `@/` alias (project root).

## Architecture (Supervisor Directive 02 — see `docs/mrv/04-target-architecture-adrs.md`)
- Target: **server-side authoritative calculation and authorization**, **PostgreSQL** persistence, **private** evidence storage. Not yet implemented; provider not yet selected — inspect existing deployment/database configuration first. Never provision paid services, reset databases or assume no deployed data exists.
- Until the server tier exists, the pure engine in `lib/` is the single calculation path. Keep it free of browser APIs so it can move server-side unchanged.
- Data model design: `docs/mrv/05-proposed-data-model.md` (tenant scoping via composite FKs + RLS, immutable snapshots, verification events).

## Multi-tenancy (Directive 03 — see `docs/mrv/10-multi-tenant-foundation.md`)
- Tenant = customer organisation; facility = factory; periods are facility-specific. Schema: `db/migrations/` (additive only, never reset).
- All tenant data access goes through `withTenant` (`lib/server/authz/authorize.ts`) → `asUser` (transaction-local `trace_app` role + context). Never query tenant tables as owner outside migrations/seed/session issuance.
- Every tenant-owned table: `tenant_id` + `facility_id`, composite FKs to parents, RLS policies. Browser-supplied IDs are claims only; reject unknown body keys.
- Membership grants nothing; permissions only from `lib/tenancy/permissions.ts` role assignments. Only `approver` approves.
- API: add routes to `lib/server/api/router.ts` only. Client: `useScope()` / `scopedFetch`; cache/draft keys via `lib/tenancy/scopeKeys.ts`.
- Isolation suite `tests/isolation/cases.ts` must stay green (`npm test` or dev `GET /api/dev/isolation`); add cases for new persisted modules.

## Calculation & data rules (non-negotiable)
- Workbook import, manual entry, demo and data-package re-import all go through `calculateStore` (`lib/calcEngine.ts`). Workbook totals/statuses are comparison assertions only (`lib/assertions.ts`).
- Parse numbers only with `lib/numeric.ts` (strict; ambiguous text rejected). Dates via `lib/dates.ts`.
- Missing is never zero: missing inputs give `null` results and `NOT_EVALUATED`/`FAIL`, never PASS. No silent defaults.
- Required-data completeness (`lib/completeness.ts`) is separate from QA pass %.
- Preserve source values and provenance (`_source`) on every input row.
- A failed import never replaces the active dataset (`lib/importResolution.ts`).
- Synthetic/demo data is always flagged `synthetic` and labelled on every screen and export.
- Never claim "verified", "certified" or "compliant". "Mapped" evidence means linked only. External verification requires a separate evidence-backed verification event.
- AI features are advisory only: never compute authoritative totals, invent savings, approve reports or modify source data.

## Project Structure
- `app/` — pages; register nav entries in `lib/routes.ts`. `app/dev/` — development-only harnesses (404 in production).
- `components/layout/`, `components/ui/`, `components/charts/`, `components/icons/`, `components/dataentry/`.
- `lib/` — pure logic: parsing, engine, QA checks, completeness, exports, data package, drafts, types. `lib/server/` — server-only DB, authz, services, API router.
- `tests/` — Vitest suites; fixtures must be synthetic and labelled as such.
- `docs/mrv/` — architecture, model, backlog, test evidence.

## Library Rules
- **UI:** reuse/extend `components/ui/`. No shadcn/ui, MUI, Chakra or other component libraries.
- **Styling:** existing CSS classes/variables; new styles in `styles/components.css` (print in `styles/print.css`). No Tailwind, CSS-in-JS or CSS modules.
- **Icons:** `components/icons/Icon.tsx` only. **Charts:** Chart.js via `ChartCanvas.tsx` only.
- **Excel:** `xlsx` only. **PDF:** `jspdf` only. **State:** React Context (no Redux/Zustand/React Query).
- **Formatting:** `lib/formatter.ts`, `components/ui/Fmt.tsx`. **Shared types:** `lib/types.ts`.

## Conventions
- Components using hooks, browser APIs or Chart.js start with `"use client"`.
- Keep calculation/parsing logic out of components.
- Keep `.env*` out of Git (only the placeholder `.env.example` is tracked); never print secrets.
- Keep files small and focused; add dependencies only when clearly necessary.
