/**
 * Immutable calculation snapshots (Directives 05 §6, 06 §4). Server/test only.
 *
 * A run stores the complete frozen engine input, pins reading revisions and config versions by id, and stores the
 * engine's results as produced. Stored results are always what is displayed — also after engine upgrades.
 *
 * Integrity on load is reported as two separate facts:
 *  - `stored`: the stored results still hash to the SHA-256 recorded when the run was finalized (storage integrity);
 *  - `recompute`: the CURRENT engine re-run on the frozen input, compared with the stored results. With the same engine
 *    version this is a reproducibility check; with a different version it is only a comparison — a newer engine can
 *    never prove what the historical engine produced.
 */
import { calculateStore } from "@/lib/calcEngine";
import type { MrvInput, Store } from "@/lib/types";
import { sha256Json } from "./sha";

// d06.1: per-sheet interval mappings.
// d06b.1: explicit raw-material unit mapping (percent/fraction, dry/wet); Method A withheld only for contradictory undeclared units.
export const ENGINE_VERSION = "trace-mrv-engine/2026.10-d06b.1";
export const METHODOLOGY_VERSION = "TRACE-FORCE-MRV-Cement-V28";

export type RunResults = Omit<Store, "inputs">;

/** The calculation scope is the selected range: the setup's period fields describe it in reports. */
export function scopeInputToRange(input: MrvInput, range: { start: string; end: string; label: string }): MrvInput {
  return {
    ...input,
    setup: { ...input.setup, "Period start": range.start, "Period end": range.end, "Reporting quarter": range.label },
  };
}


export function inputSha(input: MrvInput): string {
  return sha256Json({ ...input, meta: { ...input.meta, importedAt: null } });
}

/** Fingerprint of the engine outputs that matter for comparison (excludes volatile metadata). */
export function resultsFingerprint(store: Pick<Store, "calcRows" | "qaqc" | "reportOutputs" | "completeness" | "readiness" | "qaPassPct" | "dashboard" | "inputIssues">): string {
  return sha256Json({
    calcRows: store.calcRows,
    qaqc: store.qaqc,
    reportOutputs: store.reportOutputs,
    completeness: store.completeness,
    readiness: store.readiness,
    qaPassPct: store.qaPassPct,
    dashboard: store.dashboard,
    inputIssues: store.inputIssues,
  });
}

export function resultsOf(store: Store): RunResults {
  const { inputs: _inputs, ...rest } = store;
  void _inputs;
  return rest;
}

export function restoreStore(inputSnapshot: MrvInput, results: RunResults): Store {
  return { ...results, inputs: inputSnapshot };
}

export interface RunIntegrity {
  stored: "intact" | "altered" | "unknown";
  storedEngine: string;
  currentEngine: string;
  sameEngine: boolean;
  /** Current engine re-run on the frozen input vs stored results. */
  recomputeMatches: boolean;
}

export function checkRunIntegrity(run: {
  input_snapshot: MrvInput;
  results: RunResults;
  results_sha256?: string | null;
  results_fingerprint: string;
  engine_version: string;
}): RunIntegrity {
  const stored = !run.results_sha256 ? "unknown" : sha256Json(run.results) === run.results_sha256 ? "intact" : "altered";
  const recomputed = calculateStore(run.input_snapshot, run.input_snapshot.meta?.origin ?? "manual");
  return {
    stored,
    storedEngine: run.engine_version,
    currentEngine: ENGINE_VERSION,
    sameEngine: run.engine_version === ENGINE_VERSION,
    recomputeMatches: resultsFingerprint(recomputed) === resultsFingerprint(run.results),
  };
}

export function qaRows(store: Store) {
  return store.qaqc.map((r) => ({
    check_id: String(r["Check ID"] ?? ""),
    category: r.Category == null ? null : String(r.Category),
    name: r["Check Name"] == null ? null : String(r["Check Name"]),
    status: ["PASS", "WARNING", "FAIL", "NOT_EVALUATED"].includes(String(r.Status)) ? String(r.Status) : "NOT_EVALUATED",
    severity: r.Severity == null ? null : String(r.Severity),
    result: r.Result == null ? null : String(r.Result),
  }));
}

export function qaOverall(store: Pick<Store, "calcRows">): string {
  const row = store.calcRows.find((r) => r.Metric === "QA/QC Overall Status");
  return String(row?.Value ?? "INCOMPLETE");
}
