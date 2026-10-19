/**
 * Cumulative meter registers → interval totals (Directive 06 §3). Pure.
 *
 * A register reading is the meter's cumulative value at the END of a day. Consumption for the days between two
 * consecutive readings is the difference. Decreases are never guessed:
 *  - an explicit reset (meter replaced/zeroed) must state the register value the old meter showed at removal
 *    (`finalBeforeReset`) and the new meter's starting value (`startAfterReset`);
 *  - a rollover is accepted only when the meter's declared rollover value is supplied;
 *  - any other decrease is an error and produces no interval (missing, not zero).
 */
import Decimal from "decimal.js";
import { addDays } from "./dateRanges";

export interface RegisterReading {
  id: string;
  /** Day on which the register value was read (end of day). */
  on: string;
  value: Decimal.Value;
  reset?: { finalBeforeReset: Decimal.Value; startAfterReset: Decimal.Value };
}

export interface DerivedInterval {
  start: string;
  end: string;
  total: string;
  fromIds: [string, string];
  basis: "difference" | "difference_with_reset" | "difference_with_rollover";
}

export interface CumulativeResult {
  intervals: DerivedInterval[];
  issues: { at: string; detail: string }[];
}

export function deriveIntervals(readings: RegisterReading[], opts: { rolloverAt?: Decimal.Value } = {}): CumulativeResult {
  const sorted = [...readings].sort((a, b) => a.on.localeCompare(b.on));
  const intervals: DerivedInterval[] = [];
  const issues: CumulativeResult["issues"] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.on === prev.on) {
      issues.push({ at: cur.on, detail: `two register readings on ${cur.on} (${prev.id}, ${cur.id}); not used` });
      continue;
    }
    const a = new Decimal(prev.value);
    const b = new Decimal(cur.value);
    const span = { start: addDays(prev.on, 1), end: cur.on, fromIds: [prev.id, cur.id] as [string, string] };
    if (cur.reset) {
      const total = new Decimal(cur.reset.finalBeforeReset).minus(a).plus(b.minus(cur.reset.startAfterReset));
      if (total.isNegative()) issues.push({ at: cur.on, detail: `reset values give a negative total (${total.toString()}); not used` });
      else intervals.push({ ...span, total: total.toString(), basis: "difference_with_reset" });
    } else if (b.gte(a)) {
      intervals.push({ ...span, total: b.minus(a).toString(), basis: "difference" });
    } else if (opts.rolloverAt !== undefined) {
      intervals.push({ ...span, total: new Decimal(opts.rolloverAt).minus(a).plus(b).toString(), basis: "difference_with_rollover" });
    } else {
      issues.push({ at: cur.on, detail: `register decreased from ${a.toString()} to ${b.toString()} without a declared reset or rollover; interval ${span.start} – ${span.end} is missing` });
    }
  }
  return { intervals, issues };
}
