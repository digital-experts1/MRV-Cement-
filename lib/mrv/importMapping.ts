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

export const INTERVAL_MAPPINGS = ["declared_columns", "calendar_month_of_date", "calendar_quarter_of_date", "single_day_of_date"] as const;
export type IntervalMapping = (typeof INTERVAL_MAPPINGS)[number];

export const MAPPING_LABELS: Record<IntervalMapping, string> = {
  declared_columns: "Every row states its own 'Interval Start' and 'Interval End' columns",
  calendar_month_of_date: "Each row is the total for the calendar month containing its Date",
  calendar_quarter_of_date: "Each row is the total for the calendar quarter containing its Date",
  single_day_of_date: "Each row is the total for the single day of its Date",
};

/** Sections that can carry their own mapping (same list as READING_SECTIONS; kept here so this file stays browser-safe). */
export const MAPPABLE_SECTIONS = ["production", "rawMaterial", "kilnFuel", "electricity", "inventory"] as const;
export type MappableSection = (typeof MAPPABLE_SECTIONS)[number];

export const MEASUREMENT_TYPES = ["interval_total", "cumulative_meter", "sample"] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];
export type Granularity = "day" | "month" | "quarter" | "year" | "custom" | "instant";

export interface ImportMapping {
  version: typeof MAPPING_VERSION;
  /** Applies to every section without its own entry; null = no default (such rows need their own columns or a section entry). */
  interval: IntervalMapping | null;
  /** Per-sheet declarations, e.g. monthly production rows next to quarter-total fuel rows in one workbook. */
  sections?: Partial<Record<MappableSection, IntervalMapping>>;
}

const isInterval = (v: string): v is IntervalMapping => (INTERVAL_MAPPINGS as readonly string[]).includes(v);

/**
 * Parses the transport form: either a single mapping name (all sections), or `default=<m>;kilnFuel=<m>;…` pairs.
 * Anything unknown, duplicated or empty is rejected (null) — never partially applied.
 */
export function parseMapping(value: unknown): ImportMapping | null {
  if (typeof value !== "string" || value.length > 400) return null;
  if (isInterval(value)) return { version: MAPPING_VERSION, interval: value };
  let interval: IntervalMapping | null = null;
  const sections: Partial<Record<MappableSection, IntervalMapping>> = {};
  const seen = new Set<string>();
  for (const pair of value.split(";")) {
    const [key, v, extra] = pair.split("=");
    if (extra !== undefined || !key || !v || !isInterval(v) || seen.has(key)) return null;
    seen.add(key);
    if (key === "default") interval = v;
    else if ((MAPPABLE_SECTIONS as readonly string[]).includes(key)) sections[key as MappableSection] = v;
    else return null;
  }
  if (!interval && Object.keys(sections).length === 0) return null;
  return Object.keys(sections).length ? { version: MAPPING_VERSION, interval, sections } : { version: MAPPING_VERSION, interval };
}

/** Inverse of parseMapping (client → API). Returns "" when nothing is declared. */
export function serializeMapping(interval: IntervalMapping | "", sections: Partial<Record<MappableSection, IntervalMapping | "">>): string {
  const pairs = MAPPABLE_SECTIONS.filter((s) => sections[s]).map((s) => `${s}=${sections[s]}`);
  if (!pairs.length) return interval;
  return [...(interval ? [`default=${interval}`] : []), ...pairs].join(";");
}

/** The mapping that governs one section, or null when nothing was declared for it. */
export function mappingFor(mapping: ImportMapping | null, section: MappableSection | undefined): IntervalMapping | null {
  if (!mapping) return null;
  return (section && mapping.sections?.[section]) || mapping.interval;
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
export function resolveRowInterval(row: Record<string, unknown>, importMapping: ImportMapping | null, section?: MappableSection): ResolvedInterval | string {
  const mapping = mappingFor(importMapping, section);
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
    if (!mapping) return "the row has only a Date and no import mapping was declared for this sheet; choose how its dated rows are interpreted (never inferred)";
    if (mapping === "declared_columns") return "missing Interval Start / Interval End (required by the declared mapping)";
    if (!date) return "missing Date";
    const implied = impliedByMapping(date, mapping);
    start = implied.start;
    end = implied.end;
    basis = mapping;
  }
  return { interval_start: start, interval_end: end, granularity: granularityOf(start, end, measurement), measurement_type: measurement, interval_basis: basis };
}

function impliedByMapping(date: string, interval: Exclude<IntervalMapping, "declared_columns">): { start: string; end: string } {
  const p = parseDate(date)!;
  if (interval === "calendar_month_of_date") return { start: ymd(p.y, p.m, 1), end: ymd(p.y, p.m, daysInMonth(p.y, p.m)) };
  if (interval === "calendar_quarter_of_date") {
    const qs = p.m - ((p.m - 1) % 3);
    return { start: ymd(p.y, qs, 1), end: ymd(p.y, qs + 2, daysInMonth(p.y, qs + 2)) };
  }
  return { start: date, end: date };
}
