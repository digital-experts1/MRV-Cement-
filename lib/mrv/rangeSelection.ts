/**
 * Which persisted readings belong to a calculation range (Directives 04 §6, 06 §3–4). Pure; every exclusion is reported.
 *
 * SELECTION_POLICY (trace-range-selection/v2):
 *  - Only current, accepted, explicitly-mapped interval totals are eligible. Withdrawn readings, readings stored under the
 *    retired date-based inference (no mapping version), and non-total measurement types are excluded and listed.
 *  - A reading is included only when its interval lies entirely inside the range. Boundary-crossing totals are excluded
 *    and listed (never prorated — no approved estimation policy exists).
 *  - Within one series, overlapping totals form a cluster. If one interval contains all others (e.g. a monthly total and
 *    daily totals of the same month), the coarser total is used and the finer ones are excluded AND reconciled against it:
 *    a full set of finer totals that disagrees beyond tolerance is a discrepancy that blocks completeness. Any other overlap
 *    (two totals for the same period, partially overlapping intervals) is a conflict: none of them is used, and the range
 *    is incomplete until the data is corrected.
 *  - Inventory statements are used only when, per material, they chain without gaps from the range start to the range end
 *    and each opening stock equals the previous closing stock. Otherwise that material's statements are excluded.
 *
 * COVERAGE_POLICY (trace-coverage/v2): day-level, not "a month has a record". Electricity meters and raw materials are
 * expected per series (every series seen for the facility in the 12 months before the range end must cover every day);
 * production and kiln fuel are expected at section level (the union of their series must cover every day).
 */
import Decimal from "decimal.js";
import { parseStrictNumber } from "@/lib/numeric";
import { addDays, daysBetweenInclusive, monthsInRange } from "./dateRanges";

export const SELECTION_POLICY = "trace-range-selection/v2";
export const COVERAGE_POLICY = "trace-coverage/v2";
export const RECONCILIATION_TOLERANCE = 0.001; // relative (0.1 %), with an absolute floor of 0.001 units
const PER_SERIES_SECTIONS = ["electricity", "rawMaterial"];

export const ADDITIVE_FIELDS: Record<string, string[]> = {
  production: ["Clinker Produced t", "Cement Produced t", "Clinker Used t", "Gypsum t", "Limestone Additive t", "Other Additives t"],
  rawMaterial: ["Quantity t"],
  kilnFuel: ["Quantity"],
  electricity: ["Grid MWh", "Self-generation MWh", "Renewable MWh"],
  inventory: ["Purchased t", "Dispatched t"],
};

export interface RangeReading {
  id: string;
  section: string;
  series_key: string;
  interval_start: string;
  interval_end: string;
  granularity: string;
  measurement_type?: string | null;
  mapping_version?: string | null;
  quality_state?: string | null;
  payload?: Record<string, unknown>;
}

export type ExclusionReason =
  | "partial_overlap"
  | "superseded_by_coarser_total"
  | "conflict"
  | "withdrawn"
  | "not_accepted"
  | "legacy_inferred_interval"
  | "unsupported_measurement"
  | "inventory_anchor";

export interface Excluded {
  id: string;
  section: string;
  series_key: string;
  interval: string;
  reason: ExclusionReason;
}

export interface Reconciliation {
  section: string;
  series_key: string;
  coarse: { id: string; interval: string };
  finerIds: string[];
  daysCovered: number;
  daysInInterval: number;
  status: "consistent" | "discrepancy" | "partial_finer";
  fields: { field: string; coarse: string | null; finerSum: string | null; diff: string | null }[];
}

export interface Conflict {
  section: string;
  series_key: string;
  ids: string[];
  intervals: string[];
}

export interface AnchorIssue {
  series_key: string;
  detail: string;
}

export interface RangeSelection<T extends RangeReading> {
  /** Every current reading overlapping the range (ids) — pinned so a concurrent change is detectable. */
  considered: string[];
  included: T[];
  excluded: Excluded[];
  reconciliations: Reconciliation[];
  conflicts: Conflict[];
  anchorIssues: AnchorIssue[];
}

const iv = (r: RangeReading) => `${r.interval_start} – ${r.interval_end}`;
const contains = (a: RangeReading, b: RangeReading) => a.interval_start <= b.interval_start && a.interval_end >= b.interval_end;
const overlaps = (a: RangeReading, b: RangeReading) => a.interval_start <= b.interval_end && b.interval_start <= a.interval_end;
const days = (r: RangeReading) => daysBetweenInclusive(r.interval_start, r.interval_end);

function num(r: RangeReading, field: string): Decimal | null {
  const p = parseStrictNumber(r.payload?.[field]);
  return p.kind === "ok" ? p.value : null;
}

function reconcile(coarse: RangeReading, finer: RangeReading[]): Reconciliation {
  const daysCovered = finer.reduce((a, r) => a + days(r), 0);
  const daysInInterval = days(coarse);
  const fields = (ADDITIVE_FIELDS[coarse.section] ?? [])
    .map((field) => {
      const c = num(coarse, field);
      const parts = finer.map((r) => num(r, field));
      const sum = parts.some((p) => p === null) ? null : parts.reduce<Decimal>((a, p) => a.plus(p as Decimal), new Decimal(0));
      return { field, c, sum, diff: c !== null && sum !== null ? sum.minus(c) : null, reported: c !== null || parts.some((p) => p !== null) };
    })
    .filter((f) => f.reported); // a field reported by neither side is not compared; reported by one side only → discrepancy
  let status: Reconciliation["status"] = "consistent";
  if (daysCovered < daysInInterval) status = "partial_finer";
  else if (
    fields.some((f) => f.diff === null || f.diff.abs().gt(Decimal.max(RECONCILIATION_TOLERANCE, (f.c ?? new Decimal(0)).abs().mul(RECONCILIATION_TOLERANCE))))
  ) {
    status = "discrepancy";
  }
  return {
    section: coarse.section,
    series_key: coarse.series_key,
    coarse: { id: coarse.id, interval: iv(coarse) },
    finerIds: finer.map((r) => r.id),
    daysCovered,
    daysInInterval,
    status,
    fields: fields.map((f) => ({ field: f.field, coarse: f.c?.toString() ?? null, finerSum: f.sum?.toString() ?? null, diff: f.diff?.toString() ?? null })),
  };
}

/** Readings that are maximal (not contained in another reading of the list). Assumes no identical intervals. */
function maximal<T extends RangeReading>(list: T[]): T[] {
  return list.filter((r) => !list.some((o) => o !== r && contains(o, r)));
}

/** Two finer totals conflict when they overlap without strict nesting (identical or partially overlapping intervals). */
function finerConflict(list: RangeReading[]): boolean {
  return list.some((a, i) => list.some((b, j) => i < j && overlaps(a, b) && (iv(a) === iv(b) || !(contains(a, b) || contains(b, a)))));
}

export function selectForRange<T extends RangeReading>(readings: T[], start: string, end: string): RangeSelection<T> {
  const considered: string[] = [];
  const excluded: Excluded[] = [];
  const eligible: T[] = [];
  const exclude = (r: RangeReading, reason: ExclusionReason) =>
    excluded.push({ id: r.id, section: r.section, series_key: r.series_key, interval: iv(r), reason });

  for (const r of readings) {
    if (r.interval_end < start || r.interval_start > end) continue;
    considered.push(r.id);
    if (r.quality_state === "withdrawn") exclude(r, "withdrawn");
    else if (r.quality_state && r.quality_state !== "accepted") exclude(r, "not_accepted");
    else if (!r.mapping_version) exclude(r, "legacy_inferred_interval");
    else if ((r.measurement_type ?? "interval_total") !== "interval_total") exclude(r, "unsupported_measurement");
    else if (r.interval_start < start || r.interval_end > end) exclude(r, "partial_overlap");
    else eligible.push(r);
  }

  const included: T[] = [];
  const reconciliations: Reconciliation[] = [];
  const conflicts: Conflict[] = [];
  const bySeries = new Map<string, T[]>();
  for (const r of eligible) {
    const k = `${r.section}\u0000${r.series_key}`;
    bySeries.set(k, [...(bySeries.get(k) ?? []), r]);
  }
  for (const list of bySeries.values()) {
    list.sort((a, b) => (a.interval_start < b.interval_start ? -1 : a.interval_start > b.interval_start ? 1 : b.interval_end.localeCompare(a.interval_end)));
    // Connected components of overlapping intervals.
    const clusters: T[][] = [];
    let cur: T[] = [];
    let curEnd = "";
    for (const r of list) {
      if (cur.length && r.interval_start <= curEnd) {
        cur.push(r);
        if (r.interval_end > curEnd) curEnd = r.interval_end;
      } else {
        if (cur.length) clusters.push(cur);
        cur = [r];
        curEnd = r.interval_end;
      }
    }
    if (cur.length) clusters.push(cur);

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        included.push(cluster[0]);
        continue;
      }
      const containers = cluster.filter((c) => cluster.every((o) => contains(c, o)));
      const rest = containers.length === 1 ? cluster.filter((r) => r !== containers[0]) : [];
      if (containers.length !== 1 || finerConflict(rest)) {
        conflicts.push({ section: cluster[0].section, series_key: cluster[0].series_key, ids: cluster.map((r) => r.id), intervals: cluster.map(iv) });
        for (const r of cluster) exclude(r, "conflict");
        continue;
      }
      const coarse = containers[0];
      included.push(coarse);
      for (const r of cluster) if (r !== coarse) exclude(r, "superseded_by_coarser_total");
      reconciliations.push(reconcile(coarse, maximal(rest).sort((a, b) => a.interval_start.localeCompare(b.interval_start))));
    }
  }

  // Inventory anchors: per material, statements must chain from range start to range end.
  const anchorIssues: AnchorIssue[] = [];
  const inv = new Map<string, T[]>();
  for (const r of included.filter((x) => x.section === "inventory")) inv.set(r.series_key, [...(inv.get(r.series_key) ?? []), r]);
  const dropped = new Set<string>();
  for (const [series, rows] of inv) {
    rows.sort((a, b) => a.interval_start.localeCompare(b.interval_start));
    const problems: string[] = [];
    if (rows[0].interval_start !== start) problems.push(`first statement starts ${rows[0].interval_start}, not at the range start ${start} (no opening-stock anchor)`);
    if (rows[rows.length - 1].interval_end !== end) problems.push(`last statement ends ${rows[rows.length - 1].interval_end}, not at the range end ${end} (no closing-stock anchor)`);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const next = rows[i];
      if (addDays(prev.interval_end, 1) !== next.interval_start) problems.push(`gap/overlap between ${iv(prev)} and ${iv(next)}`);
      const close = num(prev, "Closing Stock t");
      const open = num(next, "Opening Stock t");
      if (close === null || open === null || close.minus(open).abs().gt(RECONCILIATION_TOLERANCE)) {
        problems.push(`opening stock ${open?.toString() ?? "missing"} t on ${next.interval_start} ≠ previous closing ${close?.toString() ?? "missing"} t`);
      }
    }
    if (problems.length) {
      anchorIssues.push({ series_key: series, detail: problems.join("; ") });
      for (const r of rows) {
        dropped.add(r.id);
        exclude(r, "inventory_anchor");
      }
    }
  }

  return { considered, included: included.filter((r) => !dropped.has(r.id)), excluded, reconciliations, conflicts, anchorIssues };
}

export interface CoverageGap {
  section: string;
  series_key: string | null;
  month: string;
  missingDays: number;
  daysInRange: number;
}

export interface Coverage {
  policy: { selection: string; coverage: string };
  start: string;
  end: string;
  requiredSections: string[];
  /** section → months (YYYY-MM) in range that are not fully covered (any expected series/day missing). */
  missing: Record<string, string[]>;
  gaps: CoverageGap[];
  /** Latest date through which every required unit is covered without a gap from the range start. */
  coverageThrough: string | null;
  includedCount: number;
  consideredCount: number;
  excluded: Excluded[];
  excludedCounts: Partial<Record<ExclusionReason, number>>;
  reconciliations: Reconciliation[];
  conflicts: Conflict[];
  anchorIssues: AnchorIssue[];
  configGaps: string[];
  extendsIntoFuture: boolean;
  complete: boolean;
}

export function computeCoverage(
  sel: RangeSelection<RangeReading>,
  range: { start: string; end: string; extendsIntoFuture: boolean },
  requiredSections: string[],
  opts: { expectedSeries?: Record<string, string[]>; configGaps?: string[] } = {}
): Coverage {
  const totalDays = daysBetweenInclusive(range.start, range.end);
  const dayIndex = (d: string) => daysBetweenInclusive(range.start, d) - 1;
  const gaps: CoverageGap[] = [];
  const missing: Record<string, string[]> = {};
  let through: number | null = totalDays; // index of first uncovered day across all units

  for (const section of requiredSections) {
    const rows = sel.included.filter((r) => r.section === section);
    const units: (string | null)[] = PER_SERIES_SECTIONS.includes(section)
      ? [...new Set([...(opts.expectedSeries?.[section] ?? []), ...rows.map((r) => r.series_key)])].sort()
      : [null];
    if (!units.length) units.push(null);
    for (const unit of units) {
      const covered = new Uint8Array(totalDays);
      for (const r of rows) {
        if (unit !== null && r.series_key !== unit) continue;
        for (let i = dayIndex(r.interval_start); i <= dayIndex(r.interval_end); i++) covered[i] = 1;
      }
      const firstGap = covered.indexOf(0);
      if (firstGap !== -1 && (through === null || firstGap < through)) through = firstGap;
      for (const month of monthsInRange(range.start, range.end)) {
        const mStart = month + "-01" < range.start ? range.start : month + "-01";
        let missingDays = 0;
        let n = 0;
        for (let d = mStart; d <= range.end && d.startsWith(month); d = addDays(d, 1)) {
          n++;
          if (!covered[dayIndex(d)]) missingDays++;
        }
        if (missingDays) {
          gaps.push({ section, series_key: unit, month, missingDays, daysInRange: n });
          missing[section] = [...new Set([...(missing[section] ?? []), month])];
        }
      }
    }
  }
  const excludedCounts: Partial<Record<ExclusionReason, number>> = {};
  for (const e of sel.excluded) excludedCounts[e.reason] = (excludedCounts[e.reason] ?? 0) + 1;
  const discrepancies = sel.reconciliations.some((r) => r.status === "discrepancy");
  const configGaps = opts.configGaps ?? [];
  return {
    policy: { selection: SELECTION_POLICY, coverage: COVERAGE_POLICY },
    start: range.start,
    end: range.end,
    requiredSections,
    missing,
    gaps,
    coverageThrough: through === 0 || through === null ? null : addDays(range.start, through - 1),
    includedCount: sel.included.length,
    consideredCount: sel.considered.length,
    excluded: sel.excluded,
    excludedCounts,
    reconciliations: sel.reconciliations,
    conflicts: sel.conflicts,
    anchorIssues: sel.anchorIssues,
    configGaps,
    extendsIntoFuture: range.extendsIntoFuture,
    complete: gaps.length === 0 && sel.conflicts.length === 0 && !discrepancies && sel.anchorIssues.length === 0 && configGaps.length === 0 && !range.extendsIntoFuture,
  };
}

/** Required activity sections for an emissions result; raw-material data is required only for calcination Method A. */
export function requiredSectionsFor(setup: Record<string, unknown>): string[] {
  const method = String(setup["Selected calcination method"] ?? "");
  return method.includes("Method A") ? ["production", "rawMaterial", "kilnFuel", "electricity"] : ["production", "kilnFuel", "electricity"];
}
