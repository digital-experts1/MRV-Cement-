/**
 * Directive 04/05 pure-logic cases (date ranges, history mapping, range selection, snapshots). Runner-agnostic:
 * executed by Vitest (tests/mrv.test.ts) and by the development-only route GET /api/dev/mrv-selftest.
 * All fixtures are SYNTHETIC.
 */
import { calculateStore } from "@/lib/calcEngine";
import { parseWorkbook } from "@/lib/parser";
import { createSampleDataset } from "@/lib/sampleData";
import { resolveRange, validateSpec, zonedStartOfDayUtc, type RangeSpec } from "@/lib/mrv/dateRanges";
import { rebuildInput, toConfigDrafts, toReadingDrafts, type StoredReading } from "@/lib/mrv/readings";
import { computeCoverage, requiredSectionsFor, selectForRange } from "@/lib/mrv/rangeSelection";
import { checkRunIntegrity, ENGINE_VERSION, inputSha, resultsFingerprint, resultsOf, restoreStore, scopeInputToRange } from "@/lib/mrv/snapshot";
import { buildWorkbook } from "../fixtures/synthetic";

export interface MrvCase {
  id: string;
  name: string;
  run: () => void;
}

function fail(msg: string): never {
  throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, what: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: unknown, what: string) {
  if (!cond) fail(what);
}

const NOW = new Date("2026-10-19T10:00:00Z"); // fixed clock
const r = (spec: RangeSpec, timezone = "UTC", fiscalYearStartMonth = 1) => resolveRange(spec, { timezone, now: NOW, fiscalYearStartMonth });

let idSeq = 0;
function stored(drafts: ReturnType<typeof toReadingDrafts>["readings"]): StoredReading[] {
  return drafts.map((d) => ({ ...d, id: `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}` }));
}

export const MRV_CASES: MrvCase[] = [
  {
    id: "DR-01",
    name: "Calendar quarter/half/year/month presets resolve to exact inclusive dates",
    run: () => {
      eq([r({ preset: "quarter", year: 2025, quarter: 1 }).start, r({ preset: "quarter", year: 2025, quarter: 1 }).end], ["2025-01-01", "2025-03-31"], "Q1 2025");
      eq(r({ preset: "quarter", year: 2025, quarter: 1 }).label, "Calendar Q1 2025 (Jan–Mar)", "Q1 label");
      eq([r({ preset: "half", year: 2025, half: 2 }).start, r({ preset: "half", year: 2025, half: 2 }).end], ["2025-07-01", "2025-12-31"], "H2");
      eq([r({ preset: "year", year: 2025 }).start, r({ preset: "year", year: 2025 }).end], ["2025-01-01", "2025-12-31"], "full year");
      eq(r({ preset: "month", year: 2024, month: 2 }).end, "2024-02-29", "leap February");
      eq(r({ preset: "month", year: 2025, month: 2 }).end, "2025-02-28", "non-leap February");
      eq(r({ preset: "quarter", year: 2025, quarter: 1 }).days, 90, "Q1 2025 day count");
    },
  },
  {
    id: "DR-02",
    name: "Relative presets use the facility-timezone 'today' and are labelled without ambiguity",
    run: () => {
      eq(r({ preset: "today" }).start, "2026-10-19", "today UTC");
      // 10:00Z on 19 Oct is already 20 Oct in Pacific/Kiritimati (UTC+14).
      eq(r({ preset: "today" }, "Pacific/Kiritimati").start, "2026-10-20", "today in UTC+14");
      eq([r({ preset: "previous_month" }).start, r({ preset: "previous_month" }).end], ["2026-09-01", "2026-09-30"], "previous month");
      eq([r({ preset: "this_week" }).start, r({ preset: "this_week" }).end], ["2026-10-19", "2026-10-25"], "ISO week Mon–Sun");
      eq([r({ preset: "last_7" }).start, r({ preset: "last_7" }).end], ["2026-10-13", "2026-10-19"], "last 7 days incl. today");
      eq([r({ preset: "last_12_months" }).start, r({ preset: "last_12_months" }).end], ["2025-10-01", "2026-09-30"], "last 12 complete months");
      eq([r({ preset: "ytd" }).start, r({ preset: "ytd" }).end], ["2026-01-01", "2026-10-19"], "calendar YTD");
      ok(r({ preset: "this_month" }).extendsIntoFuture, "this month extends into future");
      ok(!r({ preset: "previous_month" }).extendsIntoFuture, "previous month complete");
    },
  },
  {
    id: "DR-03",
    name: "Fiscal year is configurable and labelled separately from the calendar year",
    run: () => {
      const fy = r({ preset: "fiscal_year", year: 2025 }, "UTC", 7);
      eq([fy.start, fy.end], ["2025-07-01", "2026-06-30"], "July fiscal year");
      ok(fy.label.startsWith("Fiscal year"), "fiscal label");
      ok(!fy.label.includes("Full calendar"), "fiscal label is not a calendar label");
    },
  },
  {
    id: "DR-04",
    name: "Timezone-aware UTC boundaries, including DST days",
    run: () => {
      eq(zonedStartOfDayUtc("2025-01-01", "Africa/Cairo"), "2024-12-31T22:00:00.000Z", "Cairo midnight (UTC+2)");
      const q1 = r({ preset: "quarter", year: 2025, quarter: 1 }, "Europe/Berlin");
      eq([q1.startUtc, q1.endExclusiveUtc], ["2024-12-31T23:00:00.000Z", "2025-03-31T22:00:00.000Z"], "Berlin Q1 across DST start");
      eq(zonedStartOfDayUtc("2025-03-09", "America/New_York"), "2025-03-09T05:00:00.000Z", "NY DST-start day begins at EST midnight");
    },
  },
  {
    id: "DR-05",
    name: "Range specs from untrusted input are validated (no silent defaults)",
    run: () => {
      eq(validateSpec({ preset: "custom", start: "2025-03-01", end: "2025-02-01" }), null, "end before start rejected");
      eq(validateSpec({ preset: "custom", start: "2025-02-30", end: "2025-03-01" }), null, "impossible date rejected");
      eq(validateSpec({ preset: "quarter", year: 2025, quarter: 5 }), null, "quarter 5 rejected");
      eq(validateSpec({ preset: "nope" }), null, "unknown preset rejected");
      eq(validateSpec({ preset: "quarter", year: 2025, quarter: 1, extra: 1 }), { preset: "quarter", year: 2025, quarter: 1 }, "extra keys dropped");
    },
  },
  {
    id: "HS-01",
    name: "Readings carry intervals: month-end dates are monthly summaries, other dates daily records",
    run: () => {
      const { readings, errors } = toReadingDrafts(createSampleDataset());
      eq(errors, [], "no mapping errors");
      const jan = readings.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!;
      eq([jan.interval_start, jan.interval_end, jan.granularity], ["2025-01-01", "2025-01-31", "month"], "January production monthly");
      const daily = toReadingDrafts({ ...createSampleDataset(), production: [{ ...createSampleDataset().production[0], Date: "2025-01-15" }] }).readings.find((x) => x.section === "production")!;
      eq([daily.interval_start, daily.interval_end, daily.granularity], ["2025-01-15", "2025-01-15", "day"], "mid-month is daily");
    },
  },
  {
    id: "HS-02",
    name: "Re-import dedupe keys are stable; equal legitimate readings keep distinct occurrences; values change the content hash",
    run: () => {
      const a = toReadingDrafts(createSampleDataset()).readings;
      const b = toReadingDrafts(createSampleDataset()).readings;
      eq(a.map((x) => x.record_key + x.content_hash), b.map((x) => x.record_key + x.content_hash), "identical re-import → identical keys/hashes");
      const twin = createSampleDataset();
      twin.electricity.push({ ...twin.electricity[0] });
      const keys = toReadingDrafts(twin).readings.filter((x) => x.section === "electricity" && x.observed_on === "2025-01-31").map((x) => x.record_key);
      eq(keys.length, 2, "two equal readings are both kept");
      ok(keys[0] !== keys[1], "distinct occurrences");
      const changed = createSampleDataset();
      changed.production[0]["Clinker Produced t"] = 175001;
      const c = toReadingDrafts(changed).readings.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!;
      const o = a.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!;
      eq(c.record_key, o.record_key, "same source record key");
      ok(c.content_hash !== o.content_hash, "changed value → different hash (new revision)");
      const prov = createSampleDataset();
      prov.production[0]._source = { origin: "manual", previous: { origin: "workbook", file: "x.xlsx", row: 4 } };
      eq(toReadingDrafts(prov).readings.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!.content_hash, o.content_hash, "provenance-only change is not a revision");
    },
  },
  {
    id: "HS-03",
    name: "Rows without a valid date are rejected, never guessed",
    run: () => {
      const bad = createSampleDataset();
      bad.kilnFuel[0].Date = "1/2/2025";
      const { errors } = toReadingDrafts(bad);
      eq(errors.length, 1, "one error");
      ok(/missing or invalid Date/.test(errors[0]), "error explains the date problem");
    },
  },
  {
    id: "HS-04",
    name: "Workbook → readings → rebuilt input reproduces the direct calculation exactly",
    run: () => {
      const direct = parseWorkbook(buildWorkbook(), "synthetic.xlsx");
      ok(direct._valid, "workbook valid");
      const rows = stored(toReadingDrafts(direct.inputs).readings);
      const cfg = Object.fromEntries(toConfigDrafts(direct.inputs).map((d) => [d.kind, d.content]));
      const rebuilt = calculateStore(rebuildInput(rows, cfg, direct.inputs.meta), "workbook");
      eq(rebuilt.calcRows.map((x) => x.Value), direct.calcRows.map((x) => x.Value), "calculation values");
      eq(rebuilt.qaqc.map((x) => x.Status), direct.qaqc.map((x) => x.Status), "QA statuses");
      const src = rebuilt.production[0]._source as { file?: string; row?: number };
      ok(src?.file === "synthetic.xlsx" && typeof src.row === "number", "row provenance preserved");
    },
  },
  {
    id: "RS-01",
    name: "Monthly totals are included only when fully inside the range; partial overlaps are excluded, not prorated",
    run: () => {
      const rows = stored(toReadingDrafts(createSampleDataset()).readings);
      const q1 = selectForRange(rows, "2025-01-01", "2025-03-31");
      eq(q1.partial.length, 0, "Q1: no partial");
      eq(q1.included.length, rows.length, "Q1: all included");
      const mid = selectForRange(rows, "2025-01-15", "2025-02-28");
      ok(mid.partial.every((x) => x.interval_start === "2025-01-01"), "January monthly rows are partial");
      ok(mid.included.every((x) => x.interval_start >= "2025-01-15"), "only fully-covered rows included");
      ok(mid.partial.length > 0, "partials reported");
    },
  },
  {
    id: "RS-02",
    name: "Daily records are excluded when a monthly total of the same series covers that month (no double counting)",
    run: () => {
      const ds = createSampleDataset();
      ds.electricity.push({ ...ds.electricity[0], Date: "2025-01-10", "Grid MWh": 1000 });
      const rows = stored(toReadingDrafts(ds).readings);
      const sel = selectForRange(rows, "2025-01-01", "2025-03-31");
      eq(sel.supersededByMonthly.length, 1, "one daily excluded");
      eq(sel.supersededByMonthly[0].observed_on, "2025-01-10", "the daily January record");
      const other = createSampleDataset();
      other.electricity.push({ ...other.electricity[0], "Meter / Source": "Aux meter M-02", Date: "2025-01-10" });
      eq(selectForRange(stored(toReadingDrafts(other).readings), "2025-01-01", "2025-03-31").supersededByMonthly.length, 0, "different meter is not double counting");
    },
  },
  {
    id: "RS-03",
    name: "Coverage reports missing months per required section; missing is never complete",
    run: () => {
      const ds = createSampleDataset();
      ds.electricity = ds.electricity.filter((x) => x.Date !== "2025-02-28");
      const rows = stored(toReadingDrafts(ds).readings);
      const range = r({ preset: "quarter", year: 2025, quarter: 1 });
      const cov = computeCoverage(selectForRange(rows, range.start, range.end), range, requiredSectionsFor(ds.setup));
      eq(cov.missing, { electricity: ["2025-02"] }, "February electricity missing");
      ok(!cov.complete, "incomplete");
      eq(requiredSectionsFor({ "Selected calcination method": "Method A - raw meal" }).includes("rawMaterial"), true, "Method A requires raw material");
    },
  },
  {
    id: "SN-01",
    name: "Snapshots: restored store equals the calculation; integrity re-computation matches; tampering is detected",
    run: () => {
      const rows = stored(toReadingDrafts(createSampleDataset()).readings);
      const cfg = Object.fromEntries(toConfigDrafts(createSampleDataset()).map((d) => [d.kind, d.content]));
      const input = scopeInputToRange(rebuildInput(rows, cfg, { origin: "demo", synthetic: true, filename: "x", importedAt: null }), { start: "2025-01-01", end: "2025-03-31", label: "Q1" });
      const store = calculateStore(input, "demo");
      const snap = JSON.parse(JSON.stringify({ input_snapshot: store.inputs, results: resultsOf(store), results_fingerprint: resultsFingerprint(store), engine_version: ENGINE_VERSION }));
      const restored = restoreStore(snap.input_snapshot, snap.results);
      eq(restored.calcRows, store.calcRows, "restored calculations");
      ok(restored.meta.synthetic, "synthetic flag persisted");
      eq(checkRunIntegrity(snap), "verified_reproducible", "integrity ok");
      const tampered = { ...snap, results_fingerprint: "0".repeat(64) };
      eq(checkRunIntegrity(tampered), "mismatch", "tampered fingerprint detected");
      eq(checkRunIntegrity({ ...snap, engine_version: "old" }), "engine_version_changed", "engine change flagged");
      eq(inputSha(store.inputs), inputSha(JSON.parse(JSON.stringify(store.inputs))), "input hash stable through JSON round-trip");
    },
  },
];
