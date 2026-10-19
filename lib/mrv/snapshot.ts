/**
 * Immutable calculation snapshots (Directive 05 §6). Server/test only.
 * A run stores the complete frozen engine input (rows with provenance, setup, constants/EFs, fuel defaults, registers),
 * pins reading revisions/config versions by id, and records a fingerprint of the engine outputs. Loading a run re-runs
 * the engine on the frozen input and compares fingerprints, so a stored result that the engine would not reproduce is
 * never displayed as authoritative.
 */
import { calculateStore } from "@/lib/calcEngine";
import type { MrvInput, Store } from "@/lib/types";
import { sha256Json } from "./sha";

export const ENGINE_VERSION = "trace-mrv-engine/2026.10-d05";
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

export function resultsFingerprint(store: Store): string {
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

export type RunIntegrity = "verified_reproducible" | "engine_version_changed" | "mismatch";

/** Re-runs the engine on the frozen input. "verified_reproducible" refers to recomputation only, not external verification. */
export function checkRunIntegrity(run: { input_snapshot: MrvInput; results_fingerprint: string; engine_version: string }): RunIntegrity {
  if (run.engine_version !== ENGINE_VERSION) return "engine_version_changed";
  const recomputed = calculateStore(run.input_snapshot, run.input_snapshot.meta?.origin ?? "manual");
  return resultsFingerprint(recomputed) === run.results_fingerprint ? "verified_reproducible" : "mismatch";
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

export function qaOverall(store: Store): string {
  const row = store.calcRows.find((r) => r.Metric === "QA/QC Overall Status");
  return String(row?.Value ?? "INCOMPLETE");
}
