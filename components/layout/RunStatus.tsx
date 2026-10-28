"use client";

import { useScope } from "@/context/ScopeContext";
import { SECTION_LABELS_CLIENT } from "@/lib/mrv/sectionLabels";

const EXCLUSION_LABELS: Record<string, string> = {
  partial_overlap: "cross the range boundary (not prorated)",
  superseded_by_coarser_total: "a period total of the same series is used (reconciled)",
  conflict: "conflicting overlapping totals",
  withdrawn: "withdrawn",
  not_accepted: "not accepted",
  legacy_inferred_interval: "interval was inferred by the retired date rule — re-import with an explicit mapping",
  unsupported_measurement: "not an interval total",
  inventory_anchor: "inventory statements without valid anchors",
};

const fmtTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Persisted-run provenance, coverage and staleness for the active range. */
export function RunStatus() {
  const s = useScope();
  const cov = s.coverage;
  const missing = cov ? Object.entries(cov.missing) : [];

  const needsAttention = Boolean(s.run?.stale || s.run?.integrity.stored === "altered" ||
    (s.run?.integrity.sameEngine && !s.run.integrity.recomputeMatches) ||
    missing.length || cov?.conflicts?.length || cov?.configGaps?.length || cov?.anchorIssues?.length ||
    cov?.reconciliations?.some((r) => r.status === "discrepancy"));

  return (
    <details className="run-status run-status-details">
      <summary>{s.calculating ? "Calculating…" : s.run ? s.run.stale ? "Stored calculation needs updating" : "Stored calculation" : "No stored calculation"}<span>{s.run ? `${s.run.readings} readings · ${fmtTime(s.run.created_at)}` : "Import data to get started"}</span><span>{needsAttention ? "Needs attention · view details" : "Run details"}</span></summary>
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
            {s.run.integrity.stored === "altered" ? (
              <span className="badge badge-fail">Stored result no longer matches its finalization hash</span>
            ) : null}
            {s.run.integrity.sameEngine ? (
              s.run.integrity.recomputeMatches ? (
                <span className="scope-muted" title="The same engine version re-ran the frozen inputs and reproduced the stored results. This is not external verification.">
                  recomputation matches
                </span>
              ) : (
                <span className="badge badge-fail">Same engine does not reproduce the stored result</span>
              )
            ) : (
              <span
                className="badge badge-warn"
                title={`Stored results were produced by ${s.run.integrity.storedEngine} and are shown unchanged. The current engine (${s.run.integrity.currentEngine}) ${s.run.integrity.recomputeMatches ? "gives the same results" : "gives different results"}; that comparison does not prove historical reproducibility.`}
              >
                Earlier engine · current engine {s.run.integrity.recomputeMatches ? "agrees" : "differs"} (comparison only)
              </span>
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
          {(Object.entries(cov.excludedCounts ?? {}) as [string, number][]).map(([reason, n]) => (
            <span
              key={reason}
              className="badge badge-warn"
              title={cov.excluded.filter((e) => e.reason === reason).slice(0, 20).map((e) => `${SECTION_LABELS_CLIENT[e.section] ?? e.section} ${e.interval}`).join("\n")}
            >
              {n} reading(s) excluded: {EXCLUSION_LABELS[reason] ?? reason}
            </span>
          ))}
          {(cov.reconciliations ?? []).filter((r) => r.status === "discrepancy").map((r) => (
            <span key={r.coarse.id} className="badge badge-fail" title={r.fields.map((x) => `${x.field}: total ${x.coarse ?? "—"} vs Σ finer ${x.finerSum ?? "—"}`).join("\n")}>
              {SECTION_LABELS_CLIENT[r.section] ?? r.section} {r.coarse.interval}: finer readings disagree with the period total
            </span>
          ))}
          {(cov.conflicts ?? []).map((c) => (
            <span key={c.ids.join()} className="badge badge-fail" title={c.intervals.join("\n")}>
              {SECTION_LABELS_CLIENT[c.section] ?? c.section}: {c.ids.length} conflicting overlapping totals — none used
            </span>
          ))}
          {(cov.anchorIssues ?? []).map((a) => (
            <span key={a.series_key} className="badge badge-warn" title={a.detail}>
              Inventory {a.series_key.split("|").slice(1).join(" ")}: no valid opening/closing anchors — not used
            </span>
          ))}
          {(cov.configGaps ?? []).map((g) => (
            <span key={g} className="badge badge-fail">{g}</span>
          ))}
          {cov.extendsIntoFuture ? <span className="badge badge-warn">Range extends past today — partial period</span> : null}
        </div>
      ) : null}
    </details>
  );
}
