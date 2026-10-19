/**
 * Explicit source-unit semantics for raw-material rows (Directive 06B §3). Browser-safe.
 *
 * Column headers ("CaCO3 %", "Moisture %") are documentation, but a source can contradict its own headers (e.g. the demo
 * Q1 workbook stores 0.95 under "CaCO3 %" and its formula uses it as a fraction). Nothing is rescaled by guessing:
 *  - the importer declares the unit per import (`carbonate=percent|fraction`, `moisture=percent|fraction`,
 *    `massBasis=dry|wet`), or the row carries its own `Carbonate Unit` / `Moisture Unit` / `Mass Basis` columns;
 *  - the declaration is stamped on every raw-material row with UNIT_MAPPING_VERSION; the original values are never changed;
 *  - a row declaring a different unit than the import is an error (contradiction), never silently overridden;
 *  - the engine converts explicitly and reports values that contradict their declared unit (e.g. 95 declared as fraction).
 * Rows without a declaration fall back to the header unit (%) and are flagged by QA check CP-03; if every CaCO3 value of
 * such rows is ≤ 1 (header says % but values look like fractions) Method A is not calculated until the unit is declared.
 * 0.5 declared as percent is a valid 0.5 % — it is never rejected for being below 1.
 */
export const UNIT_MAPPING_VERSION = "trace-source-units/v1";

export const SHARE_UNITS = ["percent", "fraction"] as const;
export type ShareUnit = (typeof SHARE_UNITS)[number];
export const MASS_BASES = ["dry", "wet"] as const;
export type MassBasis = (typeof MASS_BASES)[number];

export interface UnitMapping {
  carbonate?: ShareUnit;
  moisture?: ShareUnit;
  massBasis?: MassBasis;
}

export const UNIT_KEYS = { carbonate: "Carbonate Unit", moisture: "Moisture Unit", massBasis: "Mass Basis" } as const;
export type UnitKey = keyof typeof UNIT_KEYS;

export const UNIT_LABELS: Record<UnitKey, string> = {
  carbonate: "CaCO3 / MgCO3 values are",
  moisture: "Moisture values are",
  massBasis: "Raw-material quantity is",
};
export const UNIT_OPTION_LABELS: Record<string, string> = {
  percent: "percent (95 = 95 %)",
  fraction: "fractions (0.95 = 95 %)",
  dry: "dry mass",
  wet: "wet (as received) mass — moisture is deducted",
};

export const isUnitValue = (key: UnitKey, v: string): boolean =>
  key === "massBasis" ? (MASS_BASES as readonly string[]).includes(v) : (SHARE_UNITS as readonly string[]).includes(v);

const norm = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim().toLowerCase());

/** Reads a row's declared unit; "" = undeclared; null = unrecognised text (an error). */
export function rowUnit(row: Record<string, unknown>, key: UnitKey): string | null {
  const v = norm(row[UNIT_KEYS[key]]);
  if (v === "" || isUnitValue(key, v)) return v;
  return null;
}

/** Stamps the import's unit declaration onto a raw-material row. Returns an error string on contradiction. */
export function applyUnitMapping(row: Record<string, unknown>, units: UnitMapping | undefined): Record<string, unknown> | string {
  const out: Record<string, unknown> = { ...row };
  let declared = false;
  for (const key of Object.keys(UNIT_KEYS) as UnitKey[]) {
    const own = rowUnit(row, key);
    if (own === null) return `unrecognised ${UNIT_KEYS[key]} "${String(row[UNIT_KEYS[key]])}"`;
    const imp = units?.[key];
    if (own && imp && own !== imp) return `${UNIT_KEYS[key]} "${own}" on the row contradicts the import declaration "${imp}"`;
    const v = own || imp;
    if (v) {
      out[UNIT_KEYS[key]] = v;
      declared = true;
    }
  }
  if (declared) out["Unit Mapping Version"] = UNIT_MAPPING_VERSION;
  return out;
}
