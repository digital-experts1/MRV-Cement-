"use client";

import { Icon } from "@/components/icons/Icon";
import { useStore } from "@/context/StoreContext";
import { SYNTHETIC_NOTICE } from "@/lib/sampleData";

/** Persistent dataset-level notices: synthetic data and internal readiness (never "verified"). */
export function DatasetBanner() {
  const { store } = useStore();
  if (!store?._valid) return null;
  const ready = store.readiness.status === "READY_FOR_INTERNAL_REVIEW";

  return (
    <>
      {store.meta.synthetic ? (
        <div className="dataset-banner dataset-banner-synthetic" role="status">
          <Icon name="alert-triangle" size={15} />
          <strong>{SYNTHETIC_NOTICE}</strong>
        </div>
      ) : null}
      <div className={`dataset-banner ${ready ? "dataset-banner-ok" : "dataset-banner-warn"}`} role="status">
        <Icon name={ready ? "check-circle" : "alert-triangle"} size={14} />
        <span>
          <strong>{ready ? "Ready for internal review" : "Not ready"}</strong> · Required data {store.completeness.pct}% complete · QA pass rate{" "}
          {store.qaPassPct}% · Not externally verified
          {!ready && store.readiness.reasons.length > 0 ? <span className="dataset-banner-reasons"> — {store.readiness.reasons.join("; ")}</span> : null}
        </span>
      </div>
    </>
  );
}
