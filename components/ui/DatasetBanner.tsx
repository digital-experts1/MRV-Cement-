"use client";

import { useStore } from "@/context/StoreContext";
import { SYNTHETIC_NOTICE } from "@/lib/sampleData";

/** Compact dataset context; detailed readiness remains available without banner noise. */
export function DatasetBanner() {
  const { store } = useStore();
  if (!store?._valid) return null;
  const ready = store.readiness.status === "READY_FOR_INTERNAL_REVIEW";
  return (
    <details className="dataset-status">
      <summary>
        {store.meta.synthetic ? <span className="badge badge-info">Synthetic demo</span> : null}
        <span>{ready ? "Ready for internal review" : "Needs review"}</span>
        <span>Required data {store.completeness.pct}%</span>
        <span>QA pass rate {store.qaPassPct}%</span>
        <span className="dataset-status-verification">Not externally verified</span>
        <span className="dataset-status-link">Details</span>
      </summary>
      <div className="dataset-status-body">
        {store.meta.synthetic ? <p>{SYNTHETIC_NOTICE}</p> : null}
        {store.readiness.reasons.length > 0 ? <ul>{store.readiness.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul> : <p>Required checks are ready for internal review. This does not establish external verification.</p>}
      </div>
    </details>
  );
}
