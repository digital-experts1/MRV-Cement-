import Decimal from "decimal.js";
import { toIsoDate } from "./dates";
import { strictNumberOrNull } from "./numeric";
import type { SheetRow } from "./types";

export type Grain = "daily" | "weekly" | "monthly" | "interval";
export type TrendMetric = { label: string; field: string; group?: string; value?: (row: SheetRow) => number | null };
export function readingInterval(row: SheetRow) {
  const start = toIsoDate(row["Interval Start"] ?? row.Date);
  const end = toIsoDate(row["Interval End"] ?? row.Date);
  return start && end && start <= end ? { start, end } : null;
}
const nextDay = (s: string) => new Date(Date.parse(s + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
function bucket(date: string, grain: Grain) {
  if (grain === "monthly") return date.slice(0, 7);
  if (grain === "weekly") {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7);
    return d.toISOString().slice(0, 10);
  }
  return date;
}
/** Display-only aggregation. Never prorates intervals, replaces missing values, or changes stored inputs. */
export function readingTrends(rows: SheetRow[], metrics: TrendMetric[], requested: Grain, start: string, end: string) {
  const dated = rows.map((row, index) => ({ row, index, interval: readingInterval(row) }));
  const selected = dated.filter(x => x.interval && (!start || x.interval.start >= start) && (!end || x.interval.end <= end));
  const grain = selected.some(x => x.interval!.start !== x.interval!.end) ? "interval" : requested;
  const labels = new Set<string>();
  if (grain !== "interval" && start && end && start <= end) {
    // UI date range is bounded to the loaded dataset; protect against malformed enormous ranges.
    for (let day = start, count = 0; day <= end && count < 36600; day = nextDay(day), count++) labels.add(bucket(day, grain));
  }
  const groups = new Map<string, typeof selected>();
  for (const item of selected) {
    const iv = item.interval!;
    const key = grain === "interval" ? (iv.start === iv.end ? iv.start : `${iv.start} – ${iv.end}`) : bucket(iv.start, grain);
    labels.add(key); groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const ordered = [...labels].sort();
  const series = metrics.map(metric => ({ label: metric.label, data: ordered.map(label => {
    const items = (groups.get(label) ?? []).filter(x => !metric.group || String(x.row[metric.group] ?? "Unspecified") === metric.label);
    if (!items.length) return null;
    const values = items.map(x => metric.value ? metric.value(x.row) : strictNumberOrNull(x.row[metric.field]));
    if (values.some(x => x === null)) return null;
    return values.reduce<Decimal>((sum, value) => sum.plus(value!), new Decimal(0)).toNumber();
  }) }));
  return { grain, labels: ordered, series, indices: ordered.map(label => (groups.get(label) ?? []).map(x => x.index)),
    undated: dated.filter(x => !x.interval).length,
    excluded: dated.filter(x => x.interval && !selected.includes(x)).length,
    selected: selected.length,
    // An aggregate can have observations while some days are absent. Report coverage, never imply completeness.
    observedDays: new Set(selected.filter(x => x.interval!.start === x.interval!.end).map(x => x.interval!.start)).size };
}
export function fuelEnergy(row: SheetRow): number | null {
  const quantity = strictNumberOrNull(row.Quantity), ncv = strictNumberOrNull(row["NCV GJ/unit"]);
  return quantity === null || ncv === null ? null : new Decimal(quantity).times(ncv).toNumber();
}
