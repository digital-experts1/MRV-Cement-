import Decimal from "decimal.js";
import { parseStrictNumber } from "./numeric";
import type { SheetRow } from "./types";

/** Display-only series. A missing value invalidates its entire bucket; no partial totals are shown. */
export function overviewSeries(rows: SheetRow[], key: (r: SheetRow) => string | null, field: string) {
  const groups = new Map<string, { total: Decimal; complete: boolean }>();
  let unlabelled = 0;
  for (const row of rows) {
    const label = key(row);
    if (!label) { unlabelled++; continue; }
    const group = groups.get(label) ?? { total: new Decimal(0), complete: true };
    const value = parseStrictNumber(row[field]);
    if (value.kind !== "ok") group.complete = false;
    else group.total = group.total.plus(value.value);
    groups.set(label, group);
  }
  const entries = [...groups].sort(([a], [b]) => a.localeCompare(b));
  return { labels: entries.filter(([, v]) => v.complete).map(([k]) => k), values: entries.filter(([, v]) => v.complete).map(([, v]) => v.total.toNumber()), incomplete: entries.filter(([, v]) => !v.complete).length, unlabelled };
}
export function productionInterval(row: SheetRow): string | null {
  const start = row["Interval Start"] ?? row.Date;
  const end = row["Interval End"] ?? row.Date;
  if (!start || !end) return null;
  return start === end ? String(start) : `${start} – ${end}`;
}
