import { SYNTHETIC_NOTICE } from "./sampleData";
import type { Store } from "./types";

export const NOT_VERIFIED_STATEMENT =
  "Internal QA/QC working report. Figures are computed by the platform from the supplied inputs. " +
  "This report has NOT been externally verified, assured or approved, and makes no claim of regulatory compliance. " +
  "\"Mapped\" evidence means only that a document reference is linked in the evidence register.";

export interface ReportContent {
  synthetic: boolean;
  /** Printed on every page when present. */
  banner: string | null;
  headerLine: string;
  title: string;
  subtitle: string;
  coverLines: [string, string][];
  statementTitle: string;
  statement: string;
  qaSummaryLine: string;
  evidenceSummaryLine: string;
  filename: string;
}

function text(v: unknown, fallback = "—"): string {
  return v === null || v === undefined || String(v).trim() === "" ? fallback : String(v);
}

/** All wording used in the PDF report. Pure, so wording rules are testable. */
export function buildReportContent(store: Store, now = new Date()): ReportContent {
  const s = store;
  const quarter = text(s.setup["Reporting quarter"]);
  const qaTotal = s.qaqc.length;
  const qaPassed = s.qaqc.filter((r) => r.Status === "PASS").length;
  const notEvaluated = s.qaqc.filter((r) => r.Status === "NOT_EVALUATED").length;
  const mapped = s.evidence.filter((r) => r.Status === "Mapped").length;
  const prefix = s.meta.synthetic ? "SYNTHETIC_DEMO_" : "";

  return {
    synthetic: s.meta.synthetic,
    banner: s.meta.synthetic ? SYNTHETIC_NOTICE : null,
    headerLine: `TRACE FORCE MRV  |  Internal QA/QC Working Report${s.meta.synthetic ? "  |  SYNTHETIC DEMO" : ""}`,
    title: "TRACE FORCE MRV",
    subtitle: "Cement Embedded Emissions — Internal QA/QC Working Report",
    coverLines: [
      ["Installation / Site:", text(s.setup["Installation / site"])],
      ["Country / Jurisdiction:", text(s.setup["Country"])],
      ["Primary Product:", text(s.setup["Primary product"])],
      ["Reporting Quarter:", quarter],
      ["Accounting Period:", `${text(s.setup["Period start"])} to ${text(s.setup["Period end"])}`],
      ["Data Origin:", s.meta.synthetic ? "SYNTHETIC DEMO DATA" : text(s.meta.origin)],
      ["QA/QC Overall Status:", text(s.calculations["QA/QC Overall Status"]?.Value)],
      ["Required Data Completeness:", `${s.completeness.pct}%`],
      ["Internal Review Readiness:", s.readiness.status === "READY_FOR_INTERNAL_REVIEW" ? "Ready for internal review" : "Not ready"],
      ["Evidence Mapping Status:", text(s.calculations["Evidence Status"]?.Value)],
      ["Report Status:", "DRAFT — not approved"],
      ["Calculation Run:", s.meta.run ? `${s.meta.run.id}${s.meta.run.stale ? " (STALE — inputs changed since)" : ""}` : "Not a stored calculation run"],
      ["Run Input SHA-256:", s.meta.run ? s.meta.run.input_sha256 : "—"],
      ["Run Results SHA-256:", text(s.meta.run?.results_sha256)],
      ["Engine Version:", text(s.meta.run?.engine_version)],
      ["External Verification:", "None recorded — not externally verified"],
      ["Report Generation Date:", now.toISOString().replace("T", " ").substring(0, 19) + " UTC"],
    ],
    statementTitle: "Scope & Limitations Statement",
    statement: NOT_VERIFIED_STATEMENT,
    qaSummaryLine: `${qaPassed} of ${qaTotal} checks PASS · ${notEvaluated} not evaluated (missing inputs) · QA pass rate ${s.qaPassPct}% · completeness ${s.completeness.pct}%`,
    evidenceSummaryLine: `${mapped} of ${s.evidence.length} evidence references mapped in the register (mapping only — not externally verified).`,
    filename: `${prefix}TRACE_FORCE_MRV_Internal_Report_${quarter.replace(/\s/g, "_")}_${now.toISOString().split("T")[0]}.pdf`,
  };
}
