/**
 * Directive 02 acceptance cases. Runner-agnostic: executed by Vitest (tests/acceptance.test.ts) and by the
 * development-only browser harness (/dev/acceptance). All fixtures are synthetic.
 */
import * as XLSX from "xlsx";
import { calcFuelRow, calculateStore } from "@/lib/calcEngine";
import { buildDataPackage, parseDataPackage } from "@/lib/dataPackage";
import { makeDraft, readDraft, resolveDraft, LEGACY_DRAFT_KEY } from "@/lib/draft";
import { buildBlankTemplateWorkbook, buildReportWorkbook } from "@/lib/export";
import { resolveImport } from "@/lib/importResolution";
import { parseStrictNumber } from "@/lib/numeric";
import { parseWorkbook } from "@/lib/parser";
import { buildReportContent } from "@/lib/reportContent";
import { createSampleDataset } from "@/lib/sampleData";
import type { RowSource, SheetRow, Store } from "@/lib/types";
import { SYNTH_FUEL, SYNTH_PRODUCTION, buildWorkbook, manualInput, workbookToBuffer } from "../fixtures/synthetic";

export interface AcceptanceCase {
  id: string;
  name: string;
  run: () => void;
}

function fail(msg: string): never {
  throw new Error(msg);
}
function eq(actual: unknown, expected: unknown, what: string) {
  if (actual !== expected) fail(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function ok(cond: unknown, what: string) {
  if (!cond) fail(what);
}
const check = (s: Store, id: string) => s.qaqc.find((r) => r["Check ID"] === id) ?? fail(`check ${id} missing`);
const calc = (s: Store, metric: string) => s.calculations[metric]?.Value;

function allCells(wb: XLSX.WorkBook): string[] {
  return wb.SheetNames.flatMap((n) => (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: null }) as unknown[][]).flat().filter((v) => v !== null).map(String));
}

/** Every "verified" must be negated ("not externally verified", "NOT been externally verified", "unverified"). */
function assertNoVerificationClaim(texts: string[], where: string) {
  for (const t of texts) {
    if (/\b(compliant|certified|aligned|compliance assurance)\b/i.test(t)) fail(`${where}: unsupported claim in "${t}"`);
    const re = /verified/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 22), m.index).toLowerCase();
      if (!/\bnot\b|\bun$|none/.test(before)) fail(`${where}: un-negated "verified" in "${t}"`);
    }
  }
}

export const ACCEPTANCE_CASES: AcceptanceCase[] = [
  {
    id: "AT-A01",
    name: "Formatted 520,000 remains numeric 520000; ambiguous text is rejected",
    run: () => {
      const numericFormatted = parseWorkbook(buildWorkbook({ formats: [["03_Production_Input", 0, "Clinker Produced t", "#,##0"]] }), "synthetic.xlsx");
      ok(numericFormatted._valid, "workbook valid");
      eq(numericFormatted.production[0]["Clinker Produced t"], 520000, "#,##0 formatted numeric cell");
      eq(calc(numericFormatted, "Clinker Produced"), 520000, "Clinker Produced total");
      const textGrouped = parseWorkbook(buildWorkbook({ production: [{ ...SYNTH_PRODUCTION, "Clinker Produced t": "520,000" }] }), "synthetic.xlsx");
      eq(textGrouped.production[0]["Clinker Produced t"], 520000, "text '520,000'");
      eq((textGrouped.production[0]._source as RowSource).raw?.["Clinker Produced t"], "520,000", "raw source value preserved");
      for (const bad of ["520.000", "32,5", "1.234,5", "520 t", "#N/A", "5,20,000"]) eq(parseStrictNumber(bad).kind, "invalid", `reject "${bad}"`);
      const ambiguous = parseWorkbook(buildWorkbook({ production: [{ ...SYNTH_PRODUCTION, "Clinker Produced t": "520.000" }] }), "synthetic.xlsx");
      eq(ambiguous.production[0]["Clinker Produced t"], null, "ambiguous value not used");
      ok(ambiguous.inputIssues.some((i) => i.field === "Clinker Produced t"), "ambiguous value reported as input issue");
      eq(ambiguous.readiness.status, "NOT_READY", "ambiguous input blocks readiness");
    },
  },
  {
    id: "AT-A02",
    name: "Blank template cannot produce successful readiness and contains no fabricated PASS/Mapped",
    run: () => {
      const wb = buildBlankTemplateWorkbook();
      const cells = allCells(wb);
      ok(!cells.includes("PASS"), "template contains no PASS status");
      ok(!cells.includes("Mapped"), "template contains no Mapped status");
      const s = parseWorkbook(workbookToBuffer(wb), "blank.xlsx");
      ok(s._valid, "blank template structurally valid");
      eq(s.readiness.status, "NOT_READY", "readiness");
      ok(calc(s, "QA/QC Overall Status") !== "PASS", "overall QA not PASS");
      ok(s.completeness.pct < 100, "completeness < 100");
      eq(calc(s, "Total Embedded CO2"), null, "total not calculated (not zero)");
    },
  },
  {
    id: "AT-A03",
    name: "Imported PASS cannot override computed failure",
    run: () => {
      const s = parseWorkbook(
        buildWorkbook({
          production: [{ ...SYNTH_PRODUCTION, "Cement Produced t": 400000 }],
          qaqcClaims: [{ "Check ID": "MB-02", Category: "Mass Balance", "Check Name": "x", Rule: "x", Result: "OK", Status: "PASS", Severity: "Fail", Owner: "x" }],
          calcClaims: [{ Metric: "Clinker Produced", "Formula / Link": "", Value: 999, Unit: "t" }],
          dashboardClaims: [["QA/QC Status", "PASS"]],
        }),
        "synthetic.xlsx",
      );
      eq(check(s, "MB-02").Status, "FAIL", "computed MB-02");
      eq(calc(s, "QA/QC Overall Status"), "FAIL", "computed overall");
      eq(calc(s, "Clinker Produced"), 520000, "computed total ignores workbook 999");
      const a = s.assertions.find((x) => x.field === "MB-02 Status");
      eq(a?.outcome, "MISMATCH", "MB-02 assertion");
      eq(s.assertions.find((x) => x.field === "QA/QC Status")?.outcome, "MISMATCH", "dashboard QA assertion");
      eq(s.assertions.find((x) => x.field === "Clinker Produced")?.outcome, "MISMATCH", "calc assertion");
    },
  },
  {
    id: "AT-A04",
    name: "42 t × 32.5 GJ/t = 1365 GJ = 1.365 TJ (decimal)",
    run: () => {
      const r = calcFuelRow({ ...SYNTH_FUEL, Quantity: 42 });
      eq(r.d["Energy GJ"]?.toString(), "1365", "Energy GJ");
      eq(r.d["Energy TJ"]?.toString(), "1.365", "Energy TJ");
      eq(r.row["Energy TJ"], 1.365, "output number");
      // 1.365 TJ × 97.5 tCO2/TJ × 0.99 × (1 − 0) = 131.756625 tCO2 exactly
      eq(r.d["Fossil CO2 t"]?.toString(), "131.756625", "fossil CO2 exact");
    },
  },
  {
    id: "AT-A05",
    name: "Missing required data does not become zero or PASS",
    run: () => {
      const s = calculateStore(manualInput({ kilnFuel: [{ ...SYNTH_FUEL, "NCV GJ/unit": "", "Biomass Fraction": "" }] }));
      eq(s.kilnFuel[0]["Energy GJ"], null, "row energy null");
      eq(s.kilnFuel[0]["Biomass Fraction"], null, "blank biomass not 0");
      eq(calc(s, "Fuel Combustion CO2"), null, "fuel CO2 null");
      eq(calc(s, "Total Embedded CO2"), null, "total null");
      eq(check(s, "FC-01").Status, "FAIL", "FC-01");
      eq(check(s, "EI-01").Status, "NOT_EVALUATED", "EI-01");
      eq(check(s, "FC-03").Status, "NOT_EVALUATED", "FC-03 biomass");
      ok(!s.qaqc.some((r) => r.Status === "PASS" && ["EI-01", "EI-02", "EI-03", "FC-05"].includes(String(r["Check ID"]))), "dependent checks not PASS");
      eq(s.readiness.status, "NOT_READY", "readiness");
      const noMethod = calculateStore(manualInput({ setup: { ...manualInput().setup, "Selected calcination method": "" } }));
      eq(calc(noMethod, "Selected Process CO2"), null, "no silent Method B default");
      eq(check(noMethod, "CP-02").Status, "FAIL", "CP-02");
    },
  },
  {
    id: "AT-A06",
    name: "Out-of-period records are detected",
    run: () => {
      const s = calculateStore(manualInput({ kilnFuel: [{ ...SYNTH_FUEL, Date: "2025-04-02" }] }));
      eq(check(s, "PR-01").Status, "FAIL", "PR-01 out of period");
      ok(String(check(s, "PR-01").Comment).includes("2025-04-02"), "offending date reported");
      eq(check(calculateStore(manualInput()), "PR-01").Status, "PASS", "in-period PASS");
      const noPeriod = calculateStore(manualInput({ setup: { ...manualInput().setup, "Period end": "" } }));
      eq(check(noPeriod, "PR-01").Status, "NOT_EVALUATED", "no period → NOT_EVALUATED");
      const wbSerial = parseWorkbook(buildWorkbook({ electricity: [{ ...manualInput().electricity![0], Date: 45778 }] }), "synthetic.xlsx");
      eq(check(wbSerial, "PR-01").Status, "FAIL", "Excel serial 45778 (2025-05-01) detected");
    },
  },
  {
    id: "AT-A07",
    name: "Stock reconciliation without inventory evidence is NOT_EVALUATED",
    run: () => {
      eq(check(calculateStore(manualInput({ inventory: [] })), "MB-04").Status, "NOT_EVALUATED", "no inventory");
      eq(check(calculateStore(manualInput()), "MB-04").Status, "PASS", "consistent inventory");
      const bad = calculateStore(manualInput({ inventory: [{ ...manualInput().inventory![0], "Closing Stock t": "10000" }] }));
      eq(check(bad, "MB-04").Status, "WARNING", "imbalanced inventory");
      eq(check(parseWorkbook(buildWorkbook({ inventory: null }), "synthetic.xlsx"), "MB-04").Status, "NOT_EVALUATED", "workbook without inventory sheet");
    },
  },
  {
    id: "AT-A08",
    name: "Manual and imported equivalent inputs produce identical results",
    run: () => {
      const manual = calculateStore(manualInput());
      const imported = parseWorkbook(
        buildWorkbook({
          formats: [
            ["03_Production_Input", 0, "Clinker Produced t", "#,##0"],
            ["03_Production_Input", 0, "Cement Produced t", "#,##0"],
            ["05_Kiln_Fuel_Input", 0, "Quantity", "#,##0.00"],
          ],
          electricity: [{ ...manualInput().electricity![0], Date: 45688, "Grid MWh": "95,000" }],
        }),
        "synthetic.xlsx",
      );
      ok(imported._valid, "import valid");
      for (const r of manual.calcRows) eq(calc(imported, String(r.Metric)), r.Value, `metric ${String(r.Metric)}`);
      for (const r of manual.qaqc) eq(check(imported, String(r["Check ID"])).Status, r.Status, `check ${String(r["Check ID"])}`);
      eq(manual.readiness.status, "READY_FOR_INTERNAL_REVIEW", "fixture complete");
      eq(imported.readiness.status, manual.readiness.status, "readiness");
    },
  },
  {
    id: "AT-A09",
    name: "Failed import preserves the previous valid dataset",
    run: () => {
      const previous = calculateStore(manualInput());
      const garbage = new TextEncoder().encode("not a workbook").buffer as ArrayBuffer;
      for (const [label, candidate] of [
        ["missing sheet", parseWorkbook(buildWorkbook({ omitSheet: "13_Dashboard" }), "bad.xlsx")],
        ["presentation export", parseWorkbook(workbookToBuffer(buildReportWorkbook(previous)), "report.xlsx")],
        ["bad json", parseDataPackage("{", "bad.json")],
        ["garbage", parseWorkbook(garbage, "garbage.xlsx")],
      ] as [string, Store][]) {
        const out = resolveImport(previous, candidate);
        eq(out.accepted, false, `${label} rejected`);
        ok(out.active === previous, `${label}: previous dataset kept`);
        ok(out.errors.length > 0, `${label}: errors reported`);
      }
      eq(resolveImport(null, parseWorkbook(garbage, "g.xlsx")).active, null, "no invalid dataset becomes active");
    },
  },
  {
    id: "AT-A10",
    name: "Data export re-import preserves supported inputs and provenance",
    run: () => {
      const original = parseWorkbook(buildWorkbook({ production: [{ ...SYNTH_PRODUCTION, "Clinker Produced t": "520,000" }] }), "synthetic.xlsx");
      const text = JSON.stringify(buildDataPackage(original));
      const back = parseDataPackage(text, "export.json");
      ok(back._valid, "re-import valid");
      eq(back.meta.origin, "data-package", "dataset origin");
      for (const k of ["production", "kilnFuel", "electricity", "inventory", "constants", "evidence"] as const) {
        eq(JSON.stringify(back.inputs[k]), JSON.stringify(original.inputs[k]), `inputs.${k} identical`);
      }
      eq(JSON.stringify(back.inputs.setup), JSON.stringify(original.inputs.setup), "setup identical");
      const src = back.inputs.production[0]._source as RowSource;
      eq(src.origin, "workbook", "row provenance origin");
      eq(src.sheet, "03_Production_Input", "row provenance sheet");
      eq(src.row, 4, "row provenance row number");
      eq(src.raw?.["Clinker Produced t"], "520,000", "raw source value");
      for (const r of original.calcRows) eq(calc(back, String(r.Metric)), r.Value, `metric ${String(r.Metric)}`);
      eq(back.meta.revision, original.meta.revision, "same input revision");
    },
  },
  {
    id: "AT-A11",
    name: "Demo data and every demo export remain clearly marked synthetic",
    run: () => {
      const demo = calculateStore(createSampleDataset());
      ok(demo.meta.synthetic, "store flagged synthetic");
      ok(String(demo.setup["Installation / site"]).includes("SYNTHETIC"), "fictitious site name");
      eq(demo.readiness.status, "NOT_READY", "synthetic never ready");
      const pdf = buildReportContent(demo);
      ok(pdf.banner?.includes("SYNTHETIC"), "PDF banner");
      ok(pdf.filename.startsWith("SYNTHETIC_DEMO_"), "PDF filename");
      ok(pdf.coverLines.some(([, v]) => v.includes("SYNTHETIC")), "PDF cover");
      const xlsx = buildReportWorkbook(demo);
      for (const name of xlsx.SheetNames) {
        const a1 = String(xlsx.Sheets[name]["A1"]?.v ?? "");
        const marked = name === "_EXPORT_INFO" ? allCells({ SheetNames: [name], Sheets: xlsx.Sheets } as XLSX.WorkBook).includes("YES") : a1.includes("SYNTHETIC");
        ok(marked, `report sheet ${name} marked`);
      }
      const pkg = buildDataPackage(demo);
      ok(pkg.synthetic && pkg.notice.includes("SYNTHETIC"), "data package marked");
      const back = parseDataPackage(JSON.stringify(pkg), "demo.json");
      ok(back.meta.synthetic, "synthetic flag survives re-import");
      ok(buildReportContent(back).banner?.includes("SYNTHETIC"), "re-imported demo report still marked");
    },
  },
  {
    id: "AT-A12",
    name: "Mapped evidence is never described as externally verified",
    run: () => {
      for (const s of [calculateStore(createSampleDataset()), calculateStore(manualInput())]) {
        ok(s.evidence.length > 0 && s.evidence.every((r) => r.Status === "Mapped"), "fixture fully mapped");
        const c = buildReportContent(s);
        assertNoVerificationClaim([c.headerLine, c.title, c.subtitle, c.statement, c.qaSummaryLine, c.evidenceSummaryLine, ...c.coverLines.map(([, v]) => v)], "PDF content");
        assertNoVerificationClaim([String(calc(s, "Evidence Status"))], "Evidence Status");
        ok(String(calc(s, "Evidence Status")).includes("not externally verified"), "evidence status explicitly not verified");
        assertNoVerificationClaim(s.qaqc.map((r) => String(r.Comment)), "QA comments");
        assertNoVerificationClaim(allCells(buildReportWorkbook(s)), "report workbook");
      }
    },
  },
  {
    id: "AT-A13",
    name: "Stale drafts are resolved explicitly by facility/period/revision",
    run: () => {
      const store = calculateStore(manualInput());
      const same = makeDraft(store.inputs, store.meta.revision);
      eq(resolveDraft(same, store).action, "use-draft", "same scope + revision");
      eq(resolveDraft(makeDraft(store.inputs, "r-other"), store).action, "ask", "stale revision");
      const otherFacility = makeDraft({ ...store.inputs, setup: { ...store.inputs.setup, "Installation / site": "OTHER" } }, store.meta.revision);
      eq(resolveDraft(otherFacility, store).action, "ask", "different facility");
      const otherPeriod = makeDraft({ ...store.inputs, setup: { ...store.inputs.setup, "Period end": "2025-06-30" } }, store.meta.revision);
      eq(resolveDraft(otherPeriod, store).action, "ask", "different period");
      eq(resolveDraft(null, store).action, "use-store", "no draft");
      const legacy = readDraft({ getItem: (k: string) => (k === LEGACY_DRAFT_KEY ? JSON.stringify(store.inputs) : null) });
      ok(legacy !== null, "legacy draft read");
      eq(resolveDraft(legacy, null).action, "ask", "legacy draft never auto-applied");
    },
  },
];

export type { SheetRow };
