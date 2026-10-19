/**
 * Directive 04/05 pure-logic cases (date ranges, history mapping, range selection, snapshots). Runner-agnostic:
 * executed by Vitest (tests/mrv.test.ts) and by the development-only route GET /api/dev/mrv-selftest.
 * All fixtures are SYNTHETIC.
 */
import { calculateStore } from "@/lib/calcEngine";
import { parseWorkbook } from "@/lib/parser";
import { createSampleDataset } from "@/lib/sampleData";
import { resolveRange, validateSpec, zonedStartOfDayUtc, type RangeSpec } from "@/lib/mrv/dateRanges";
import { rebuildInput, toConfigDrafts, toReadingDrafts, type ReadingSection, type StoredReading } from "@/lib/mrv/readings";
import { computeCoverage, requiredSectionsFor, selectForRange } from "@/lib/mrv/rangeSelection";
import { checkRunIntegrity, ENGINE_VERSION, inputSha, resultsFingerprint, resultsOf, restoreStore, scopeInputToRange } from "@/lib/mrv/snapshot";
import { granularityOf, MAPPING_VERSION, parseMapping, serializeMapping, type ImportMapping } from "@/lib/mrv/importMapping";
import { deriveIntervals } from "@/lib/mrv/cumulative";
import { planRun, selectConfig, type ConfigDoc } from "@/lib/mrv/executorPayload";
import { sha256Json } from "@/lib/mrv/sha";
import { SOURCE_PROFILES } from "@/lib/mrv/sourceProfiles";
import type { SheetRow } from "@/lib/types";
import { buildWorkbook } from "../fixtures/synthetic";
import { discrepancyRegister } from "../reference/reference";

/** The synthetic fixture documents each row as the total of the calendar month of its Date. */
const MONTHLY: ImportMapping = { version: MAPPING_VERSION, interval: "calendar_month_of_date" };
const DAILY: ImportMapping = { version: MAPPING_VERSION, interval: "single_day_of_date" };

/** Reference register for the synthetic fixture: application values are read from the stored-result shape. */
export function syntheticRegister() {
  const ds = createSampleDataset();
  const store = calculateStore(ds, "demo");
  const app: Record<string, number | null> = {};
  for (const row of store.calcRows) app[String(row.Metric)] = typeof row.Value === "number" ? row.Value : null;
  const mb04 = store.qaqc.find((x) => x["Check ID"] === "MB-04");
  app["Stock movement closing difference"] = typeof mb04?.Result === "number" ? mb04.Result : null;
  return discrepancyRegister(ds, app);
}

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
const ZERO_EXTRAS: Record<string, SheetRow> = { electricity: { "Self-generation MWh": 0, "Renewable MWh": 0 } };
function storedRow(section: ReadingSection, series: string, start: string, end: string, values: SheetRow): StoredReading {
  return {
    id: `00000000-0000-4000-8000-${String(++idSeq).padStart(12, "0")}`,
    section,
    series_key: series,
    record_key: `${series}|${start}..${end}|interval_total`,
    observed_on: null,
    interval_start: start,
    interval_end: end,
    granularity: granularityOf(start, end, "interval_total"),
    measurement_type: "interval_total",
    mapping_version: MAPPING_VERSION,
    quality_state: "accepted",
    payload: { ...(ZERO_EXTRAS[section] ?? {}), ...values, "Interval Start": start, "Interval End": end },
  };
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
    name: "Intervals come only from an explicit mapping or row columns — never from 'last day of month'",
    run: () => {
      const { readings, errors } = toReadingDrafts(createSampleDataset(), MONTHLY);
      eq(errors, [], "no mapping errors");
      const jan = readings.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!;
      eq([jan.interval_start, jan.interval_end, jan.granularity, jan.measurement_type, jan.interval_basis], ["2025-01-01", "2025-01-31", "month", "interval_total", "calendar_month_of_date"], "January production (declared monthly)");
      eq(jan.mapping_version, MAPPING_VERSION, "mapping version stored");
      // March 31 as a DAILY record: same date, explicit daily mapping → one day, not a month.
      const mar31 = toReadingDrafts(createSampleDataset(), DAILY).readings.find((x) => x.section === "production" && x.observed_on === "2025-03-31")!;
      eq([mar31.interval_start, mar31.interval_end, mar31.granularity], ["2025-03-31", "2025-03-31", "day"], "March 31 daily stays a day");
      // No mapping and no interval columns → rejected, not guessed.
      const none = toReadingDrafts(createSampleDataset(), null);
      eq(none.readings.map((x) => [x.section, x.interval_basis]), [["inventory", "row_columns"]], "only the self-describing (Interval Start/End) row is accepted without a mapping");
      ok(none.errors.length > 0 && none.errors.every((e) => /no import mapping was declared/.test(e)), "mapping error explains");
    },
  },
  {
    id: "HS-02",
    name: "Row interval columns are authoritative; inconsistent rows and unsupported measurement types are rejected",
    run: () => {
      const ds = createSampleDataset();
      ds.production = [{ ...ds.production[0], Date: null, "Interval Start": "2025-01-01", "Interval End": "2025-03-31" }];
      ds.rawMaterial = [];
      ds.kilnFuel = [];
      ds.inventory = [];
      ds.electricity = [{ ...ds.electricity[0], "Interval Start": "2025-02-01", "Interval End": "2025-02-28" }]; // Date 2025-01-31 outside
      const res = toReadingDrafts(ds, null);
      const prod = res.readings.find((x) => x.section === "production")!;
      eq([prod.granularity, prod.interval_basis], ["quarter", "row_columns"], "declared quarter");
      eq(res.errors.length, 1, "electricity row rejected");
      ok(/outside the stated interval/.test(res.errors[0]), "date outside interval explained");
      const cm = createSampleDataset();
      cm.electricity[0]["Measurement Type"] = "cumulative meter";
      ok(toReadingDrafts(cm, MONTHLY).errors.some((e) => /cumulative_meter/.test(e)), "cumulative register rows need a dedicated meter mapping");
      eq(granularityOf("2024-02-01", "2024-02-29", "interval_total"), "month", "leap February is a month");
      eq(granularityOf("2025-02-01", "2025-02-28", "interval_total"), "month", "non-leap February is a month");
      eq(granularityOf("2024-02-01", "2024-02-28", "interval_total"), "custom", "Feb 1–28 in a leap year is NOT a month");
    },
  },
  {
    id: "HS-05",
    name: "Per-sheet mappings: monthly production next to a quarter-total fuel row dated 31 March; transport form is strict",
    run: () => {
      const m = parseMapping("default=calendar_month_of_date;kilnFuel=calendar_quarter_of_date")!;
      eq([m.interval, m.sections], ["calendar_month_of_date", { kilnFuel: "calendar_quarter_of_date" }], "parsed");
      eq(serializeMapping("calendar_month_of_date", { kilnFuel: "calendar_quarter_of_date" }), "default=calendar_month_of_date;kilnFuel=calendar_quarter_of_date", "round trip");
      eq(serializeMapping("single_day_of_date", {}), "single_day_of_date", "plain form kept");
      for (const bad of ["kilnFuel=nope", "default=calendar_month_of_date;default=single_day_of_date", "secret=calendar_month_of_date", "x", ""]) eq(parseMapping(bad), null, `rejected: ${bad}`);
      const ds = createSampleDataset();
      ds.kilnFuel = ds.kilnFuel.map((x, i) => ({ ...x, Date: "2025-03-31", "Fuel Type": `Fuel ${i}` }));
      const res = toReadingDrafts(ds, m);
      eq(res.errors, [], "no errors");
      const fuel = res.readings.filter((x) => x.section === "kilnFuel");
      ok(fuel.every((x) => x.interval_start === "2025-01-01" && x.interval_end === "2025-03-31" && x.granularity === "quarter"), "fuel = Q1 totals");
      const prod = res.readings.find((x) => x.section === "production" && x.observed_on === "2025-03-31")!;
      eq([prod.interval_start, prod.granularity], ["2025-03-01", "month"], "production stays monthly");
      const onlyFuel = toReadingDrafts(ds, parseMapping("kilnFuel=calendar_quarter_of_date"));
      ok(onlyFuel.errors.length > 0 && onlyFuel.errors.every((e) => /no import mapping was declared for this sheet/.test(e)), "undeclared sheets are rejected, not defaulted");
      // March-only range must not receive the quarter fuel total.
      const sel = selectForRange(stored(res.readings), "2025-03-01", "2025-03-31");
      ok(sel.included.every((x) => x.section !== "kilnFuel"), "quarter fuel total is not attributed to March");
    },
  },
  {
    id: "EN-01",
    name: "Low carbonate values alone are no contradiction: header/explicit units are honoured; a source profile's required declaration resolves genuine ambiguity",
    run: () => {
      const low = () => {
        const ds = createSampleDataset();
        ds.setup["Selected calcination method"] = "Method A - raw material input";
        ds.rawMaterial = ds.rawMaterial.map((x) => ({ ...x, "CaCO3 %": 0.95, "MgCO3 %": 0.02 }));
        return ds;
      };
      // Platform template (header authoritative): 0.95 under "CaCO3 %" is 0.95 %, calculated, not withheld or rescaled.
      const s = calculateStore(low(), "demo");
      eq(s.rawMaterial[0]["CaCO3 Fraction"], 0.0095, "0.95 % → 0.0095 (header honoured)");
      ok(typeof s.calculations["Process CO2 Method A"].Value === "number", "Method A calculated");
      eq(s.inputIssues, [], "no issue for small values");
      eq(s.qaqc.find((x) => x["Check ID"] === "CP-03")?.Status, "WARNING", "undeclared units still flagged, not FAIL");
      // Explicit row unit is honoured as declared.
      const expl = low();
      expl.rawMaterial = expl.rawMaterial.map((x) => ({ ...x, "Carbonate Unit": "fraction" }));
      eq(calculateStore(expl, "demo").rawMaterial[0]["CaCO3 Fraction"], 0.95, "declared fraction honoured");
      // Source whose headers are not authoritative (V28 Demo collection workbook): declaration required.
      const demo = low();
      demo.setup["Workbook mode"] = "Cement_QAQC_V28_Demo";
      const ds2 = calculateStore(demo, "demo");
      eq(ds2.calculations["Process CO2 Method A"].Value, null, "Method A withheld without the required declaration");
      eq(ds2.qaqc.find((x) => x["Check ID"] === "CP-03")?.Status, "FAIL", "required declaration missing → CP-03 FAIL");
      eq(ds2.rawMaterial[0]["CaCO3 %"], 0.95, "source value preserved");
      const rejected = toReadingDrafts(demo, MONTHLY).errors.filter((e) => /requires an explicit Carbonate Unit and Mass Basis declaration/.test(e));
      eq(rejected.length, demo.rawMaterial.length, "every raw-material row rejected at import without the required declaration");
      const m = parseMapping("default=calendar_month_of_date;carbonate=fraction;massBasis=dry")!;
      const drafts = toReadingDrafts(demo, m);
      eq(drafts.errors, [], "declared units satisfy the source requirement");
      const cfg = Object.fromEntries(toConfigDrafts(demo).map((d) => [d.kind, d.content]));
      const resolved = calculateStore(rebuildInput(stored(drafts.readings), cfg, demo.meta), "demo");
      eq(resolved.rawMaterial[0]["CaCO3 Fraction"], 0.95, "declared fraction applied");
      eq(resolved.qaqc.find((x) => x["Check ID"] === "CP-03")?.Status, "PASS", "fully declared → CP-03 PASS");
      // A value outside its unit is still flagged (that is a real contradiction).
      const over = low();
      over.rawMaterial[0]["CaCO3 %"] = 120;
      ok(calculateStore(over, "demo").inputIssues.some((x) => /contradicts its unit/.test(x.reason)), "120 under a % header flagged");
    },
  },
  {
    id: "EN-02",
    name: "Explicit unit mapping: fraction vs percent give the same CO2; 0.5 % is valid; contradictions and out-of-range values are flagged; wet basis deducts moisture",
    run: () => {
      const base = createSampleDataset();
      base.setup["Selected calcination method"] = "Method A - raw material input";
      const pctStore = calculateStore(base, "demo");
      const pctA = pctStore.calculations["Process CO2 Method A"].Value as number;
      ok(typeof pctA === "number" && pctA > 0, "percent Method A calculated");
      eq(pctStore.qaqc.find((x) => x["Check ID"] === "CP-03")?.Status, "WARNING", "undeclared units → WARNING, not PASS");
      // Same chemistry declared as fractions through the import mapping → identical CO2.
      const frac = createSampleDataset();
      frac.setup["Selected calcination method"] = "Method A - raw material input";
      frac.rawMaterial = frac.rawMaterial.map((x) => ({ ...x, "CaCO3 %": Number(x["CaCO3 %"]) / 100, "MgCO3 %": Number(x["MgCO3 %"]) / 100 }));
      const m = parseMapping("default=calendar_month_of_date;carbonate=fraction;massBasis=dry")!;
      eq(m.units, { carbonate: "fraction", massBasis: "dry" }, "units parsed");
      eq(serializeMapping("calendar_month_of_date", {}, { carbonate: "fraction", massBasis: "dry" }), "default=calendar_month_of_date;carbonate=fraction;massBasis=dry", "units round trip");
      eq(parseMapping("default=calendar_month_of_date;carbonate=ppm"), null, "unknown unit rejected");
      const drafts = toReadingDrafts(frac, m);
      eq(drafts.errors, [], "fraction rows map");
      const raw = drafts.readings.filter((x) => x.section === "rawMaterial");
      ok(raw.every((x) => x.payload["Carbonate Unit"] === "fraction" && x.payload["Unit Mapping Version"] === "trace-source-units/v1"), "unit + mapping version stamped on readings");
      const cfg = Object.fromEntries(toConfigDrafts(frac).map((d) => [d.kind, d.content]));
      const fracStore = calculateStore(rebuildInput(stored(drafts.readings), cfg, frac.meta), "demo");
      const fracA = fracStore.calculations["Process CO2 Method A"].Value as number;
      ok(Math.abs(fracA - pctA) <= 1e-9 * pctA, `fraction-declared Method A equals percent Method A (${fracA} vs ${pctA})`);
      // 0.5 % declared as percent is a valid percentage (no rejection for being below 1).
      const small = createSampleDataset();
      small.rawMaterial = small.rawMaterial.map((x, i) => (i === 0 ? { ...x, "MgCO3 %": 0.5, "Carbonate Unit": "percent" } : x));
      const sm = calculateStore(small, "demo");
      eq(sm.inputIssues, [], "0.5 % accepted");
      eq(sm.rawMaterial[0]["MgCO3 Fraction"], 0.005, "0.5 % → 0.005");
      // Row-level declaration contradicting the import declaration → validation error.
      const clash = createSampleDataset();
      clash.rawMaterial[0]["Carbonate Unit"] = "percent";
      ok(toReadingDrafts(clash, m).errors.some((e) => /contradicts the import declaration/.test(e)), "row vs import contradiction rejected");
      // 95 declared as a fraction contradicts its unit → issue, not converted.
      const over = createSampleDataset();
      over.rawMaterial = over.rawMaterial.map((x) => ({ ...x, "Carbonate Unit": "fraction" }));
      ok(calculateStore(over, "demo").inputIssues.some((x) => /contradicts its unit/.test(x.reason)), "out-of-range for declared unit flagged");
      // Wet basis deducts moisture explicitly; undeclared basis uses the quantity as entered.
      const wet = createSampleDataset();
      wet.setup["Selected calcination method"] = "Method A - raw material input";
      wet.rawMaterial = wet.rawMaterial.map((x) => ({ ...x, "Mass Basis": "wet", "Carbonate Unit": "percent", "Moisture %": 10 }));
      const ws = calculateStore(wet, "demo");
      eq(ws.rawMaterial[0]["Dry Quantity t"], Number(wet.rawMaterial[0]["Quantity t"]) * 0.9, "dry quantity = wet × (1 − moisture)");
      ok(Math.abs((ws.calculations["Process CO2 Method A"].Value as number) - pctA * 0.9) <= 1e-6 * pctA, "wet basis lowers Method A by the moisture share");
      eq(ws.qaqc.find((x) => x["Check ID"] === "CP-03")?.Status, "PASS", "fully declared units → CP-03 PASS");
    },
  },
  {
    id: "SP-01",
    name: "Source profiles: conflicting unit declarations never silently override; invalid required rows are reported; workbook mode selects a parsing profile only",
    run: () => {
      const m = parseMapping("default=calendar_month_of_date;carbonate=fraction;massBasis=dry")!;
      // Row vs import declaration conflicts (carbonate and mass basis) are validation errors, not a silent precedence.
      for (const [col, val] of [["Carbonate Unit", "percent"], ["Mass Basis", "wet"]] as const) {
        const ds = createSampleDataset();
        ds.rawMaterial = ds.rawMaterial.map((x) => ({ ...x, "CaCO3 %": Number(x["CaCO3 %"]) / 100, "MgCO3 %": Number(x["MgCO3 %"]) / 100 }));
        ds.rawMaterial[0][col] = val;
        const res = toReadingDrafts(ds, m);
        ok(res.errors.some((e) => /contradicts the import declaration/.test(e)), `${col}: row/import conflict rejected`);
      }
      // One row of a declaration-requiring source lacks its declaration: reported, so the import (all-or-nothing) is rejected.
      const partial = createSampleDataset();
      partial.setup["Workbook mode"] = "Cement_QAQC_V28_Demo";
      partial.rawMaterial = partial.rawMaterial.map((x, i) => (i === 0 ? x : { ...x, "Carbonate Unit": "percent", "Mass Basis": "dry" }));
      const pd = toReadingDrafts(partial, MONTHLY);
      eq(pd.errors.length, 1, "exactly the invalid row is reported");
      eq(calculateStore(partial, "demo").calculations["Process CO2 Method A"].Value, null, "engine withholds Method A while any required row is unresolved");
      // Workbook mode selects a parsing profile only: identical, fully declared data gives identical results, evidence
      // status, readiness, QA and synthetic labelling whatever the mode says.
      const declared = (mode: string | null) => {
        const ds = createSampleDataset();
        ds.setup["Selected calcination method"] = "Method A - raw material input";
        ds.rawMaterial = ds.rawMaterial.map((x) => ({ ...x, "Carbonate Unit": "percent", "Mass Basis": "dry" }));
        if (mode === null) delete ds.setup["Workbook mode"];
        else ds.setup["Workbook mode"] = mode;
        const s = calculateStore(ds, "demo");
        return {
          values: s.calcRows.map((x) => x.Value),
          qa: s.qaqc.map((x) => [x["Check ID"], x.Status]),
          readiness: s.readiness,
          evidence: s.calculations["Evidence Status"].Value,
          synthetic: s.meta.synthetic,
          evidenceRows: s.evidence.map((x) => x.Status),
        };
      };
      const base = declared("Cement_QAQC_V28");
      for (const mode of ["Cement_QAQC_V28_Demo", "Cement_QAQC_V28_Online", "Verified_Approved_Final", null]) eq(declared(mode), base, `mode ${mode} changes nothing beyond parsing`);
      for (const p of SOURCE_PROFILES) eq(Object.keys(p).sort(), ["basis", "id", "label", "requiredUnits", "workbookModes"], `profile ${p.id} carries parsing rules only`);
    },
  },
  {
    id: "HS-03",
    name: "Re-import keys are stable; values change the content hash; provenance-only changes do not; same-series overlaps are errors",
    run: () => {
      const a = toReadingDrafts(createSampleDataset(), MONTHLY).readings;
      const b = toReadingDrafts(createSampleDataset(), MONTHLY).readings;
      eq(a.map((x) => x.record_key + x.content_hash), b.map((x) => x.record_key + x.content_hash), "identical re-import → identical keys/hashes");
      const changed = createSampleDataset();
      changed.production[0]["Clinker Produced t"] = 175001;
      const c = toReadingDrafts(changed, MONTHLY).readings.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!;
      const o = a.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!;
      eq(c.record_key, o.record_key, "same source record key");
      ok(c.content_hash !== o.content_hash, "changed value → different hash (new revision)");
      const prov = createSampleDataset();
      prov.production[0]._source = { origin: "manual", previous: { origin: "workbook", file: "x.xlsx", row: 4 } };
      eq(toReadingDrafts(prov, MONTHLY).readings.find((x) => x.section === "production" && x.observed_on === "2025-01-31")!.content_hash, o.content_hash, "provenance-only change is not a revision");
      const twin = createSampleDataset();
      twin.electricity.push({ ...twin.electricity[0] });
      const t = toReadingDrafts(twin, MONTHLY);
      ok(t.errors.some((e) => /double count/.test(e)), "two totals of one meter for one month → validation error, not silent merge");
      eq(o.legacy_key, "production|kiln 1|cem ii/a-l 42.5n|2025-01-31|#1", "legacy (Directive 05) key kept for auditable correction");
    },
  },
  {
    id: "HS-04",
    name: "Workbook → readings → rebuilt input reproduces the direct calculation exactly",
    run: () => {
      const direct = parseWorkbook(buildWorkbook(), "synthetic.xlsx");
      ok(direct._valid, "workbook valid");
      const drafts = toReadingDrafts(direct.inputs, MONTHLY);
      eq(drafts.errors, [], "workbook rows map");
      const rows = stored(drafts.readings);
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
    name: "Partial ranges: totals are included only when fully inside; boundary-crossing totals are excluded and listed",
    run: () => {
      const rows = stored(toReadingDrafts(createSampleDataset(), MONTHLY).readings);
      const q1 = selectForRange(rows, "2025-01-01", "2025-03-31");
      eq(q1.excluded.length, 0, "Q1: nothing excluded");
      eq(q1.included.length, rows.length, "Q1: all included");
      const mid = selectForRange(rows, "2025-01-15", "2025-02-28");
      ok(mid.excluded.filter((x) => x.reason === "partial_overlap").every((x) => x.interval.startsWith("2025-01-01")), "January monthly rows are partial");
      ok(mid.included.every((x) => x.interval_start >= "2025-01-15"), "only fully-covered rows included");
      eq(mid.considered.length, mid.included.length + mid.excluded.length, "every overlapping reading is accounted for");
    },
  },
  {
    id: "RS-02",
    name: "March daily + March monthly of the same series: monthly used, dailies reconciled; disagreement is flagged, never silently dropped",
    run: () => {
      const base = createSampleDataset();
      const monthly = stored(toReadingDrafts(base, MONTHLY).readings).filter((x) => x.section === "electricity");
      const mar = monthly.find((x) => x.interval_start === "2025-03-01")!;
      const dailies: StoredReading[] = [];
      for (let d = 1; d <= 31; d++) {
        const day = `2025-03-${String(d).padStart(2, "0")}`;
        dailies.push(storedRow("electricity", mar.series_key, day, day, { "Grid MWh": d === 31 ? 32500 - 30 * 1048 : 1048 }));
      }
      const sel = selectForRange([...monthly, ...dailies], "2025-03-01", "2025-03-31");
      eq(sel.included.map((x) => x.id), [mar.id], "monthly total used once");
      eq(sel.excluded.filter((x) => x.reason === "superseded_by_coarser_total").length, 31, "31 dailies excluded and listed");
      eq(sel.reconciliations[0].status, "consistent", "Σ daily = monthly");
      const bad = dailies.map((x, i) => (i === 30 ? { ...x, payload: { ...x.payload, "Grid MWh": 999 } } : x));
      const sel2 = selectForRange([...monthly, ...bad], "2025-03-01", "2025-03-31");
      eq(sel2.reconciliations[0].status, "discrepancy", "discrepancy flagged");
      const range = r({ preset: "month", year: 2025, month: 3 });
      ok(!computeCoverage(sel2, range, ["electricity"]).complete, "discrepancy blocks completeness");
      // A March-31-only daily record alongside the monthly total: partial finer set → consistent coverage, flagged as partial.
      const sel3 = selectForRange([...monthly, dailies[30]], "2025-03-01", "2025-03-31");
      eq(sel3.reconciliations[0].status, "partial_finer", "single March 31 daily recognised as partial finer data");
    },
  },
  {
    id: "RS-03",
    name: "Overlapping sources that do not nest (two totals for one period, partial overlaps) are conflicts: none used, range incomplete",
    run: () => {
      const s = "electricity|meter a";
      const a = storedRow("electricity", s, "2025-01-01", "2025-01-31", { "Grid MWh": 100 });
      const b = storedRow("electricity", s, "2025-01-01", "2025-01-31", { "Grid MWh": 120 });
      const c = storedRow("electricity", s, "2025-01-20", "2025-02-10", { "Grid MWh": 50 });
      const sel = selectForRange([a, b], "2025-01-01", "2025-01-31");
      eq(sel.included.length, 0, "neither duplicate period total used");
      eq(sel.conflicts.length, 1, "conflict reported");
      const sel2 = selectForRange([a, c], "2025-01-01", "2025-02-28");
      eq(sel2.conflicts.length, 1, "partial overlap reported as conflict");
      const range = r({ preset: "custom", start: "2025-01-01", end: "2025-01-31" });
      ok(!computeCoverage(sel, range, ["electricity"]).complete, "conflict blocks completeness");
    },
  },
  {
    id: "RS-04",
    name: "Coverage is day-level and per expected meter: one record in a month is not 'covered'",
    run: () => {
      const ds = createSampleDataset();
      ds.electricity = ds.electricity.filter((x) => x.Date !== "2025-02-28");
      const rows = stored(toReadingDrafts(ds, MONTHLY).readings);
      const range = r({ preset: "quarter", year: 2025, quarter: 1 });
      const cov = computeCoverage(selectForRange(rows, range.start, range.end), range, requiredSectionsFor(ds.setup));
      eq(cov.missing, { electricity: ["2025-02"] }, "February electricity missing");
      eq(cov.coverageThrough, "2025-01-31", "covered through end of January only");
      ok(!cov.complete, "incomplete");
      const one = [storedRow("electricity", "electricity|m1", "2025-02-10", "2025-02-10", { "Grid MWh": 1 })];
      const feb = r({ preset: "month", year: 2025, month: 2 });
      const cov2 = computeCoverage(selectForRange(one, feb.start, feb.end), feb, ["electricity"]);
      eq(cov2.gaps[0].missingDays, 27, "27 of 28 days missing despite a record in the month");
      const cov3 = computeCoverage(selectForRange(one, feb.start, feb.end), feb, ["electricity"], { expectedSeries: { electricity: ["electricity|m1", "electricity|m2"] } });
      ok(cov3.gaps.some((g) => g.series_key === "electricity|m2" && g.missingDays === 28), "a meter seen before but silent now is missing");
      const leap = r({ preset: "month", year: 2024, month: 2 });
      const leapRow = [storedRow("electricity", "electricity|m1", "2024-02-01", "2024-02-28", { "Grid MWh": 1 })];
      eq(computeCoverage(selectForRange(leapRow, leap.start, leap.end), leap, ["electricity"]).gaps[0].missingDays, 1, "leap day 2024-02-29 is missing");
    },
  },
  {
    id: "RS-05",
    name: "Inventory balances need valid opening/closing anchors at range start/end and continuity between statements",
    run: () => {
      const s = "inventory|clinker";
      const jan = storedRow("inventory", s, "2025-01-01", "2025-01-31", { "Opening Stock t": 100, "Closing Stock t": 110, "Purchased t": 0, "Dispatched t": 0 });
      const feb = storedRow("inventory", s, "2025-02-01", "2025-02-28", { "Opening Stock t": 110, "Closing Stock t": 90, "Purchased t": 0, "Dispatched t": 0 });
      eq(selectForRange([jan, feb], "2025-01-01", "2025-02-28").anchorIssues.length, 0, "chained statements accepted");
      const febBad = { ...feb, payload: { ...feb.payload, "Opening Stock t": 105 } };
      const sel = selectForRange([jan, febBad], "2025-01-01", "2025-02-28");
      ok(/≠ previous closing/.test(sel.anchorIssues[0]?.detail ?? ""), "opening ≠ previous closing detected");
      eq(sel.included.filter((x) => x.section === "inventory").length, 0, "broken chain not used");
      ok(/no closing-stock anchor/.test(selectForRange([jan], "2025-01-01", "2025-02-28").anchorIssues[0]?.detail ?? ""), "missing closing anchor detected");
    },
  },
  {
    id: "CM-01",
    name: "Cumulative meters: differences between registers; explicit resets/rollovers only; unexplained decreases are missing, not zero",
    run: () => {
      const res = deriveIntervals([
        { id: "a", on: "2025-01-31", value: 1000 },
        { id: "b", on: "2025-02-28", value: 1500 },
        { id: "c", on: "2025-03-31", value: 200, reset: { finalBeforeReset: 1700, startAfterReset: 0 } },
        { id: "d", on: "2025-04-30", value: 100 },
      ]);
      eq(res.intervals.map((x) => [x.start, x.end, x.total, x.basis]), [
        ["2025-02-01", "2025-02-28", "500", "difference"],
        ["2025-03-01", "2025-03-31", "400", "difference_with_reset"],
      ], "differences and declared reset");
      ok(res.issues.some((x) => /without a declared reset or rollover/.test(x.detail)), "unexplained decrease reported");
      const roll = deriveIntervals([{ id: "a", on: "2025-01-31", value: 99990 }, { id: "b", on: "2025-02-28", value: 15 }], { rolloverAt: 100000 });
      eq(roll.intervals[0].total, "25", "rollover with declared rollover value");
    },
  },
  {
    id: "CF-01",
    name: "Configuration is selected by effective period covering the range, not by latest upload",
    run: () => {
      const doc = (id: string, kind: ConfigDoc["kind"], from: string | null, to: string | null, at: string, content: unknown = {}): ConfigDoc => ({ id, kind, content, effective_from: from, effective_to: to, created_at: at });
      const docs = [
        doc("s-q1", "setup", "2025-01-01", "2025-03-31", "2025-04-02T00:00:00Z"),
        doc("c-q1", "constants", "2025-01-01", "2025-03-31", "2025-04-02T00:00:00Z", [{ v: "q1" }]),
        doc("s-q2", "setup", "2025-04-01", "2025-06-30", "2025-07-02T00:00:00Z"),
        doc("c-q2", "constants", "2025-04-01", "2025-06-30", "2025-07-02T00:00:00Z", [{ v: "q2" }]),
      ];
      const jan = selectConfig(docs, "2025-01-01", "2025-01-31");
      eq(jan.chosen.map((d) => d.id).sort(), ["c-q1", "s-q1"], "January uses Q1 factors although Q2 was uploaded later");
      eq(jan.gaps, [], "no gaps");
      const h1 = selectConfig(docs, "2025-01-01", "2025-06-30");
      ok(h1.gaps.some((g) => /different configuration versions apply/.test(g)), "range spanning two versions is not silently calculated");
      const corrected = [...docs, doc("c-q1b", "constants", "2025-01-01", "2025-03-31", "2025-08-01T00:00:00Z", [{ v: "q1 corrected" }])];
      eq(selectConfig(corrected, "2025-02-01", "2025-02-28").chosen.find((d) => d.kind === "constants")!.id, "c-q1b", "a later correction for the same period wins");
      ok(selectConfig([doc("legacy", "setup", null, null, "2025-01-01T00:00:00Z")], "2025-01-01", "2025-01-31").gaps.some((g) => /without an effective period/.test(g)), "legacy undated config flagged");
    },
  },
  {
    id: "RN-01",
    name: "Run plan pins readings, considered set and config versions; dependency hash changes when any dependency changes",
    run: () => {
      const ds = createSampleDataset();
      const rows = stored(toReadingDrafts(ds, MONTHLY).readings).map((x) => ({ ...x, synthetic: true }));
      const docs: ConfigDoc[] = toConfigDrafts(ds).map((d, i) => ({ id: `cfg-${i}`, kind: d.kind, content: d.content, effective_from: "2025-01-01", effective_to: "2025-03-31", created_at: "2025-04-01T00:00:00Z" }));
      const range = r({ preset: "quarter", year: 2025, quarter: 1 });
      const plan = planRun({ readings: rows, docs, range, facility: { code: "SYN", synthetic: true } });
      ok(plan.kind === "run", "plan produced");
      if (plan.kind !== "run") return;
      const body = JSON.parse(plan.body);
      eq(body.reading_ids.length, rows.length, "all readings pinned (incl. the explicitly quarterly inventory statement)");
      eq(body.considered_ids.length, rows.length, "considered set pinned");
      eq(body.run.engine_version, ENGINE_VERSION, "engine version recorded");
      ok(body.input_snapshot.meta.synthetic === true && body.results.meta.synthetic === true, "synthetic labelled");
      const again = planRun({ readings: rows, docs, range, facility: { code: "SYN", synthetic: true } });
      ok(again.kind === "run" && again.dependencySha === plan.dependencySha, "deterministic dependency hash");
      const withExtra = planRun({ readings: [...rows, { ...rows[0], id: "00000000-0000-4000-8000-999999999999", interval_start: "2025-01-01", interval_end: "2025-03-31", quality_state: "withdrawn" as const }], docs, range, facility: { code: "SYN", synthetic: true } });
      ok(withExtra.kind === "run" && withExtra.dependencySha !== plan.dependencySha, "a new (even excluded) reading changes the dependency hash → no stale reuse");
      const noConstants = planRun({ readings: rows, docs: docs.filter((d) => d.kind !== "constants"), range, facility: { code: "SYN", synthetic: true } });
      ok(noConstants.kind === "none" && /constants/.test(noConstants.note), "no effective constants → not calculated (no silent defaults)");
    },
  },
  {
    id: "RF-01",
    name: "Independent reference (no engine import) agrees with the application on the SYNTHETIC fixture — not a real-Q1 validation",
    run: () => {
      const rows = syntheticRegister();
      const bad = rows.filter((x) => x.status === "discrepancy");
      eq(bad, [], "no unexplained discrepancies on synthetic data");
      ok(rows.find((x) => x.metric.startsWith("Product allocation"))?.status === "not_comparable", "product allocation gap reported, not hidden");
    },
  },
  {
    id: "SN-01",
    name: "Frozen results stay displayed after engine upgrades; recomputation is reported only as a comparison",
    run: () => {
      const rows = stored(toReadingDrafts(createSampleDataset(), MONTHLY).readings);
      const cfg = Object.fromEntries(toConfigDrafts(createSampleDataset()).map((d) => [d.kind, d.content]));
      const input = scopeInputToRange(rebuildInput(rows, cfg, { origin: "demo", synthetic: true, filename: "x", importedAt: null }), { start: "2025-01-01", end: "2025-03-31", label: "Q1" });
      const store = calculateStore(input, "demo");
      const results = JSON.parse(JSON.stringify(resultsOf(store)));
      const snap = JSON.parse(JSON.stringify({ input_snapshot: store.inputs, results, results_sha256: sha256Json(results), results_fingerprint: resultsFingerprint(store), engine_version: ENGINE_VERSION }));
      const restored = restoreStore(snap.input_snapshot, snap.results);
      eq(restored.calcRows, store.calcRows, "restored calculations");
      ok(restored.meta.synthetic, "synthetic flag persisted");
      const same = checkRunIntegrity(snap);
      eq([same.stored, same.sameEngine, same.recomputeMatches], ["intact", true, true], "same engine reproduces");
      const old = checkRunIntegrity({ ...snap, engine_version: "trace-mrv-engine/2026.01-old" });
      eq([old.stored, old.sameEngine], ["intact", false], "older engine: stored result intact, comparison only");
      const altered = JSON.parse(JSON.stringify(snap));
      altered.results.calcRows[0].Value = 1;
      eq(checkRunIntegrity(altered).stored, "altered", "altered stored result detected by its finalization hash");
      eq(inputSha(store.inputs), inputSha(JSON.parse(JSON.stringify(store.inputs))), "input hash stable through JSON round-trip");
    },
  },
];
