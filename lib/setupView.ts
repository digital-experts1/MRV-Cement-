import type { SheetRow } from "./types";

/** Display the calculation's effective values while preserving workbook metadata. */
export function setupViewRows(setup: Record<string, unknown>, rows: SheetRow[]): SheetRow[] {
  const seen = new Set<string>();
  const result = rows.map(row => {
    const key = String(row.Parameter ?? "");
    seen.add(key);
    return Object.prototype.hasOwnProperty.call(setup, key) ? { ...row, Value: setup[key] } : { ...row };
  });
  for (const [Parameter, Value] of Object.entries(setup)) {
    if (!seen.has(Parameter)) result.push({ Parameter, Value });
  }
  return result;
}

export function setupDisplay(value: unknown): string {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return "Not supplied";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
