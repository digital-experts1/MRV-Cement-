"use client";

import { useScope } from "@/context/ScopeContext";
import { SECTION_LABELS_CLIENT } from "@/lib/mrv/sectionLabels";

const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Persisted-run provenance, coverage and staleness for the active range. */
export function RunStatus() {
  const s = useScope();
  const cov = s.coverage;
  const missing = cov ? Object.entries(cov.missing) : [];

  return (
    <div className="run-status" aria-live="polite">
      <div className="run-status-row">
        {s.calculating ? (
          <span className="scope-muted">
            <span className="spinner spinner-sm" aria-hidden="true" /> Loading stored readings and calculating on the server…
          </span>
        ) : s.run ? (
          <>
            <span className={`badge ${s.run.stale ? "badge-warn" : "badge-pass"}`}>{s.run.stale ? "STALE RUN" : "STORED RUN"}</span>
            <span>
              Calculated {fmtTime(s.run.created_at)} from {s.run.readings} stored readings · engine <span className="mono">{s.run.engine_version}</span>
            </span>
            {s.run.integrity === "verified_reproducible" ? (
              <span className="scope-muted" title="The engine re-ran the frozen inputs and reproduced the stored results. This is not external verification.">
                recomputation matches
              </span>
            ) : (
              <span className="badge badge-fail">{s.run.integrity === "mismatch" ? "Stored result does not reproduce" : "Engine version changed — recalculate"}</span>
            )}
          </>
        ) : (
          <span className="scope-muted">No stored calculation for this range.</span>
        )}
        <span className="scope-muted">
          Latest reading: {s.summary?.latestObservation ?? "—"} · last import: {fmtTime(s.summary?.latestImport)}
        </span>
        {s.canCalculate && !s.calculating ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={s.recalculate}>
            {s.run?.stale ? "Recalculate (inputs changed)" : "Recalculate"}
          </button>
        ) : null}
      </div>
      {s.run?.stale ? <div className="run-status-warn">This result is stale: {s.run.stale.reason}. It remains stored for audit; recalculate to use current readings.</div> : null}
      {s.runNote ? <div className="run-status-note">{s.runNote}</div> : null}
      {cov && !s.calculating ? (
        <div className="run-status-cov">
          {cov.coverageThrough ? <span>All required sections covered through {cov.coverageThrough}.</span> : <span>Required data is incomplete for this range.</span>}
          {missing.map(([section, months]) => (
            <span key={section} className="badge badge-warn">
              {SECTION_LABELS_CLIENT[section] ?? section} missing: {months.join(", ")}
            </span>
          ))}
          {cov.partialOverlaps.length ? (
            <span className="badge badge-warn" title={cov.partialOverlaps.map((p) => `${p.section} ${p.interval}`).join("\n")}>
              {cov.partialOverlaps.length} monthly reading(s) cross the range boundary and were excluded (not prorated)
            </span>
          ) : null}
          {cov.supersededDaily ? <span className="badge badge-warn">{cov.supersededDaily} daily reading(s) excluded: a monthly total exists for the same month</span> : null}
          {cov.extendsIntoFuture ? <span className="badge badge-warn">Range extends past today — partial period</span> : null}
        </div>
      ) : null}
    </div>
  );
}
