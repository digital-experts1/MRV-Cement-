export type SheetRow = Record<string, unknown>;

export interface StoreMeta {
  filename: string | null;
  uploadedAt: string | null;
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
  _valid: boolean;
  _errors: string[];
}

export function createEmptyStore(): Store {
  return {
    meta: { filename: null, uploadedAt: null },
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
  const value = row?.[key];
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isNaN(n) ? null : n;
}
