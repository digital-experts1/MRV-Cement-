/**
 * Explicit import mapping (Directive 06 §3). Browser-safe (no node APIs).
 *
 * A row's covered interval and measurement type are NEVER inferred from what its date looks like. They come from:
 *   1. documented source metadata in the row itself: `Interval Start`, `Interval End`, `Measurement Type` columns; or
 *   2. an explicit import mapping declared by the importing user for rows that only carry a `Date`.
 * Rows that have neither are rejected with a mapping error. Self-describing rows (with interval columns) keep their own
 * interval; the declared mapping applies only to rows without them. A Date outside a row's stated interval is rejected.
 * The mapping, its version and the per-row basis are stored with the batch and every reading.
 */
import { toIsoDate } from "@/lib/dates";
import { daysInMonth, parseDate, ymd } from "./dateRanges";

export const MAPPING_VERSION = "trace-row-interval/v1";

export const INTERVAL_MAPPINGS = ["declared_columns", "calendar_month_of_date", "single_day_of_date"] as const;
export type IntervalMapping = (typeof INTERVAL_MAPPINGS)[number];

export const MAPPING_LABELS: Record<IntervalMapping, string> = {
  declared_columns: "Every row states its own 'Interval Start' and 'Interval End' columns",
  calendar_month_of_date: "Each row is the total for the calendar month containing its Date",
  single_day_of_date: "Each row is the total for the single day of its Date",
};

export const MEASUREMENT_TYPES = ["interval_total", "cumulative_meter", "sample"] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];
export type Granularity = "day" | "month" | "quarter" | "year" | "custom" | "instant";

export interface ImportMapping {
  version: typeof MAPPING_VERSION;
  interval: IntervalMapping;
}

export function parseMapping(value: unknown): ImportMapping | null {
  return typeof value === "string" && (INTERVAL_MAPPINGS as readonly string[]).includes(value)
    ? { version: MAPPING_VERSION, interval: value as IntervalMapping }
    : null;
}

export interface ResolvedInterval {
  interval_start: string;
  interval_end: string;
  granularity: Granularity;
  measurement_type: MeasurementType;
  interval_basis: "row_columns" | IntervalMapping;
}

/** Calendar granularity of an inclusive interval (derived from the interval, not from the date's position in a month). */
export function granularityOf(start: string, end: string, measurement: MeasurementType): Granularity {
  if (measurement !== "interval_total") return "instant";
  if (start === end) return "day";
  const s = parseDate(start)!;
  const e = parseDate(end)!;
  if (s.d === 1 && e.d === daysInMonth(e.y, e.m)) {
    if (s.y === e.y && s.m === e.m) return "month";
    if (s.y === e.y && (s.m - 1) % 3 === 0 && e.m === s.m + 2) return "quarter";
    if (s.y === e.y && s.m === 1 && e.m === 12) return "year";
  }
  return "custom";
}

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Resolves one row's interval. Returns an error string instead of guessing when the row is ambiguous or inconsistent.
 */
export function resolveRowInterval(row: Record<string, unknown>, mapping: ImportMapping | null): ResolvedInterval | string {
  const mtRaw = blank(row["Measurement Type"]) ? "interval_total" : String(row["Measurement Type"]).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!(MEASUREMENT_TYPES as readonly string[]).includes(mtRaw)) return `unknown Measurement Type "${String(row["Measurement Type"])}"`;
  const measurement = mtRaw as MeasurementType;
  if (measurement !== "interval_total") {
    return `Measurement Type "${measurement}" is not accepted for this sheet: its values are period totals. Cumulative meter registers and samples need a dedicated meter mapping.`;
  }

  const hasStart = !blank(row["Interval Start"]);
  const hasEnd = !blank(row["Interval End"]);
  const date = blank(row.Date) ? null : toIsoDate(row.Date);
  if (!blank(row.Date) && !date) return "invalid Date (use YYYY-MM-DD)";

  let start: string | null = null;
  let end: string | null = null;
  let basis: ResolvedInterval["interval_basis"];

  if (hasStart || hasEnd) {
    start = toIsoDate(row["Interval Start"]);
    end = toIsoDate(row["Interval End"]);
    if (!start || !end) return "Interval Start and Interval End must both be valid dates (YYYY-MM-DD)";
    if (end < start) return "Interval End is before Interval Start";
    if (date && (date < start || date > end)) return `Date ${date} lies outside the stated interval ${start} – ${end}`;
    basis = "row_columns";
  } else {
    if (!mapping) return "the row has only a Date and no import mapping was declared; choose how dated rows are interpreted (never inferred)";
    if (mapping.interval === "declared_columns") return "missing Interval Start / Interval End (required by the declared mapping)";
    if (!date) return "missing Date";
    const implied = impliedByMapping(date, mapping.interval);
    start = implied.start;
    end = implied.end;
    basis = mapping.interval;
  }
  return { interval_start: start, interval_end: end, granularity: granularityOf(start, end, measurement), measurement_type: measurement, interval_basis: basis };
}

function impliedByMapping(date: string, interval: Exclude<IntervalMapping, "declared_columns">): { start: string; end: string } {
  const p = parseDate(date)!;
  return interval === "calendar_month_of_date" ? { start: ymd(p.y, p.m, 1), end: ymd(p.y, p.m, daysInMonth(p.y, p.m)) } : { start: date, end: date };
}
