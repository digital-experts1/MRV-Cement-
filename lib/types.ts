import { strictNumberOrNull } from "./numeric";

export type SheetRow = Record<string, unknown>;

/** Where a dataset (or an individual row) came from. */
export type DataOrigin = "workbook" | "manual" | "demo" | "data-package";

/** Authoritative status of a computed QA/QC check. */
export type CheckStatus = "PASS" | "WARNING" | "FAIL" | "NOT_EVALUATED";
export type OverallQaStatus = "PASS" | "WARNING" | "FAIL" | "INCOMPLETE";

/** Provenance attached to every input row as `_source`. `raw` keeps the original cell values before normalization. */
export interface RowSource {
  origin: DataOrigin;
  file?: string | null;
  sheet?: string;
  /** 1-based spreadsheet row number when imported from a workbook. */
  row?: number;
  raw?: Record<string, unknown>;
  /** Original provenance when a row was later edited manually. */
  previous?: RowSource;
}

export interface InputIssue {
  section: string;
  row: number | null;
  field: string;
  raw: unknown;
  reason: string;
}

/** Canonical input dataset: the only thing the calculation engine reads. */
export interface MrvInput {
  meta: { origin: DataOrigin; synthetic: boolean; filename: string | null; importedAt: string | null };
  readme: SheetRow[];
  setup: Record<string, unknown>;
  setupRows: SheetRow[];
  dcsMap: SheetRow[];
  production: SheetRow[];
  rawMaterial: SheetRow[];
  kilnFuel: SheetRow[];
  electricity: SheetRow[];
  /** Explicit clinker inventory movements (opening/closing stock, purchases, dispatches). */
  inventory: SheetRow[];
  constants: SheetRow[];
  fuelDefaults: SheetRow[];
  evidence: SheetRow[];
  regulatory: SheetRow[];
}

/** Workbook-provided totals/statuses compared against computed results. They never override computed values. */
export interface AssertionResult {
  sheet: string;
  field: string;
  workbookValue: unknown;
  computedValue: unknown;
  outcome: "MATCH" | "MISMATCH" | "NOT_COMPARABLE";
  note?: string;
}

/** Required-data completeness. Deliberately separate from QA pass percentage. */
export interface Completeness {
  required: number;
  present: number;
  pct: number;
  missing: string[];
}

export interface Readiness {
  status: "READY_FOR_INTERNAL_REVIEW" | "NOT_READY";
  reasons: string[];
}

export interface StoreMeta {
  filename: string | null;
  uploadedAt: string | null;
  origin: DataOrigin | null;
  synthetic: boolean;
  /** Deterministic hash of the input dataset; used to detect stale drafts. */
  revision: string | null;
}

export interface Co2BreakdownItem {
  component: string;
  tCO2: number;
  share: number;
}

export interface DashboardKpi {
  value: number | null;
  unit: unknown;
  govPos: unknown;
}

export interface Dashboard {
  co2Breakdown: Co2BreakdownItem[];
  kpis: Record<string, DashboardKpi>;
}

export interface Store {
  meta: StoreMeta;
  readme: SheetRow[];
  setup: Record<string, unknown>;
  setupRows: SheetRow[];
  dcsMap: SheetRow[];
  production: SheetRow[];
  rawMaterial: SheetRow[];
  kilnFuel: SheetRow[];
  electricity: SheetRow[];
  constants: SheetRow[];
  fuelDefaults: SheetRow[];
  calculations: Record<string, SheetRow>;
  calcRows: SheetRow[];
  qaqc: SheetRow[];
  reportOutputs: SheetRow[];
  evidence: SheetRow[];
  regulatory: SheetRow[];
  dashboard: Dashboard;
  inventory: SheetRow[];
  inputs: MrvInput;
  inputIssues: InputIssue[];
  assertions: AssertionResult[];
  completeness: Completeness;
  readiness: Readiness;
  qaPassPct: number;
  _valid: boolean;
  _errors: string[];
}

export function createEmptyInput(origin: DataOrigin = "manual"): MrvInput {
  return {
    meta: { origin, synthetic: false, filename: null, importedAt: null },
    readme: [],
    setup: {},
    setupRows: [],
    dcsMap: [],
    production: [],
    rawMaterial: [],
    kilnFuel: [],
    electricity: [],
    inventory: [],
    constants: [],
    fuelDefaults: [],
    evidence: [],
    regulatory: [],
  };
}

export function createEmptyStore(): Store {
  return {
    meta: { filename: null, uploadedAt: null, origin: null, synthetic: false, revision: null },
    readme: [],
    setup: {},
    setupRows: [],
    dcsMap: [],
    production: [],
    rawMaterial: [],
    kilnFuel: [],
    electricity: [],
    constants: [],
    fuelDefaults: [],
    calculations: {},
    calcRows: [],
    qaqc: [],
    reportOutputs: [],
    evidence: [],
    regulatory: [],
    dashboard: { co2Breakdown: [], kpis: {} },
    inventory: [],
    inputs: createEmptyInput(),
    inputIssues: [],
    assertions: [],
    completeness: { required: 0, present: 0, pct: 0, missing: [] },
    readiness: { status: "NOT_READY", reasons: ["No dataset loaded"] },
    qaPassPct: 0,
    _valid: false,
    _errors: [],
  };
}

export function getCalc(store: Store | null, metricName: string): SheetRow | null {
  if (!store?.calcRows) return null;
  return store.calcRows.find((r) => r.metric === metricName || r.Metric === metricName) || null;
}

export function getSetup(store: Store | null, param: string): unknown {
  if (!store?.setup) return null;
  return store.setup[param] ?? null;
}

export function getReport(store: Store | null, fieldName: string): SheetRow | null {
  if (!store?.reportOutputs) return null;
  return store.reportOutputs.find((r) => r.outputField === fieldName || r["Output Field"] === fieldName) || null;
}

export function getEvidence(store: Store | null, evId: string): SheetRow | null {
  if (!store?.evidence) return null;
  return store.evidence.find((r) => r.evidenceId === evId || r["Evidence ID"] === evId) || null;
}

export function cell(row: SheetRow | undefined, key: string): unknown {
  return row?.[key];
}

export function cellStr(row: SheetRow | undefined, key: string, fallback = ""): string {
  const value = row?.[key];
  if (value === null || value === undefined) return fallback;
  return String(value);
}

export function cellNum(row: SheetRow | undefined, key: string): number | null {
  return strictNumberOrNull(row?.[key]);
}
