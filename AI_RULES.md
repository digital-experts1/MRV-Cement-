# AI Rules — TRACE FORCE MRV

## Tech Stack
- **Next.js 16 (App Router)** with **React 19** and **TypeScript** (strict mode).
- Routing is file-based: each page lives in `app/<route>/page.tsx`; the root layout is `app/layout.tsx`.
- Global client state (uploaded workbook, sidebar state) lives in React Context under `context/` (`StoreContext`, `ExplainerContext`), wired up in `app/providers.tsx`.
- **SheetJS (`xlsx`)** parses the uploaded Excel workbook entirely in the browser (`lib/parser.ts`).
- **Chart.js 4** renders all charts via canvas wrappers in `components/charts/ChartCanvas.tsx`.
- **jsPDF** (plus `xlsx` for spreadsheets) generates client-side exports (`lib/export.ts`).
- Styling uses **plain CSS** design-system files in `styles/` (`main.css`, `components.css`, `print.css`), imported once via `app/globals.css`.
- Fonts are loaded with `next/font/google` (Inter + JetBrains Mono) in `app/layout.tsx`.
- Imports use the `@/` path alias, which maps to the project root.

## Project Structure
- `app/` — pages (App Router). Add new routes here and register nav entries in `lib/routes.ts`.
- `components/layout/` — app shell, sidebar, topbar, footer.
- `components/ui/` — shared UI primitives (Badge, Chip, KpiCard, PageHeader, EmptyState, etc.).
- `components/charts/` — Chart.js wrappers. `components/icons/` — inline SVG icon set.
- `lib/` — pure logic: parsing, calculations (`calcEngine.ts`), formatting, exports, types, chart config.

## Library Rules
- **UI components:** Reuse/extend components in `components/ui/`. Do NOT add shadcn/ui, MUI, Chakra, or other component libraries.
- **Styling:** Use the existing CSS classes and variables in `styles/`. Add new styles to `styles/components.css` (print rules to `styles/print.css`). Do NOT introduce Tailwind, CSS-in-JS, or CSS modules.
- **Icons:** Use `components/icons/Icon.tsx`; add new SVG paths there. Do NOT install lucide-react or other icon packages.
- **Charts:** Use Chart.js through `ChartCanvas.tsx` and shared colors/defaults from `lib/charts.ts`. Do NOT add Recharts, D3, or other chart libraries.
- **Excel input/output:** Use `xlsx` only, keeping parsing logic in `lib/parser.ts`.
- **PDF output:** Use `jspdf` only, keeping export logic in `lib/export.ts`.
- **State:** Use React Context + hooks (`useStore`-style access via `context/`). Do NOT add Redux, Zustand, or React Query.
- **Number/date formatting:** Use helpers in `lib/formatter.ts` and `components/ui/Fmt.tsx`.
- **Types:** Shared types belong in `lib/types.ts`.

## Conventions
- Components using hooks, browser APIs, or Chart.js must start with `"use client"`.
- Keep calculation and parsing logic out of components — put it in `lib/`.
- All processing stays client-side; there is no backend or database.
- Keep files small and focused; avoid adding new dependencies unless clearly necessary.
