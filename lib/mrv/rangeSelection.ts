/**
 * Which persisted readings belong to a calculation range (Directive 04 §6). Pure.
 *
 *  - Included: the reading's covered interval lies entirely inside [start, end].
 *  - Partial overlap: the interval crosses a range boundary. Such readings are EXCLUDED and reported — monthly totals
 *    are never prorated into shorter ranges (no approved estimation policy exists).
 *  - Granularity: when a monthly summary and daily records of the same series cover the same month, the monthly
 *    summary is authoritative and the daily records are excluded and reported (prevents double counting).
 *  - Coverage: required sections without any included reading in a month are reported as missing; missing is never 0.
 */
import { monthsInRange } from "./dateRanges";

export interface RangeReading {
  id: string;
  section: string;
  series_key: string;
  interval_start: string;
  interval_end: string;
  granularity: "day" | "month";
}

export interface RangeSelection<T extends RangeReading> {
  included: T[];
  partial: T[];
  supersededByMonthly: T[];
}

export function selectForRange<T extends RangeReading>(readings: T[], start: string, end: string): RangeSelection<T> {
  const inside: T[] = [];
  const partial: T[] = [];
  for (const r of readings) {
    if (r.interval_end < start || r.interval_start > end) continue;
    if (r.interval_start >= start && r.interval_end <= end) inside.push(r);
    else partial.push(r);
  }
  const monthly = new Set(
    [...inside, ...partial].filter((r) => r.granularity === "month").map((r) => `${r.series_key}@${r.interval_start.slice(0, 7)}`)
  );
  const included: T[] = [];
  const supersededByMonthly: T[] = [];
  for (const r of inside) {
    if (r.granularity === "day" && monthly.has(`${r.series_key}@${r.interval_start.slice(0, 7)}`)) supersededByMonthly.push(r);
    else included.push(r);
  }
  return { included, partial, supersededByMonthly };
}

export interface Coverage {
  start: string;
  end: string;
  requiredSections: string[];
  /** section → months (YYYY-MM) in range without any included reading. */
  missing: Record<string, string[]>;
  /** Latest date through which every required section has data (min over sections of their latest covered day). */
  coverageThrough: string | null;
  includedCount: number;
  partialOverlaps: { id: string; section: string; interval: string }[];
  supersededDaily: number;
  extendsIntoFuture: boolean;
  complete: boolean;
}

export function computeCoverage(
  sel: RangeSelection<RangeReading>,
  range: { start: string; end: string; extendsIntoFuture: boolean },
  requiredSections: string[]
): Coverage {
  const months = monthsInRange(range.start, range.end);
  const missing: Record<string, string[]> = {};
  let through: string | null = null;
  let anyMissingSection = false;
  for (const section of requiredSections) {
    const rows = sel.included.filter((r) => r.section === section);
    const covered = new Set<string>();
    for (const r of rows) for (const m of monthsInRange(r.interval_start, r.interval_end)) covered.add(m);
    const gaps = months.filter((m) => !covered.has(m));
    if (gaps.length) missing[section] = gaps;
    const last = rows.reduce<string | null>((acc, r) => (acc === null || r.interval_end > acc ? r.interval_end : acc), null);
    if (last === null) anyMissingSection = true;
    else if (through === null || last < through) through = last;
  }
  return {
    start: range.start,
    end: range.end,
    requiredSections,
    missing,
    coverageThrough: anyMissingSection ? null : through,
    includedCount: sel.included.length,
    partialOverlaps: sel.partial.map((r) => ({ id: r.id, section: r.section, interval: `${r.interval_start} – ${r.interval_end}` })),
    supersededDaily: sel.supersededByMonthly.length,
    extendsIntoFuture: range.extendsIntoFuture,
    complete: Object.keys(missing).length === 0 && sel.partial.length === 0 && !range.extendsIntoFuture,
  };
}

/** Required activity sections for an emissions result; raw-material data is required only for calcination Method A. */
export function requiredSectionsFor(setup: Record<string, unknown>): string[] {
  const method = String(setup["Selected calcination method"] ?? "");
  return method.includes("Method A") ? ["production", "rawMaterial", "kilnFuel", "electricity"] : ["production", "kilnFuel", "electricity"];
}
