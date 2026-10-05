"use client";

import { Icon } from "@/components/icons/Icon";
import { useExplainer } from "@/context/ExplainerContext";

export function KpiCard({
  label,
  value,
  unit,
  desc,
  explainKey,
  className = "",
}: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
  desc?: string;
  explainKey?: string;
  className?: string;
}) {
  const { showExplanation } = useExplainer();
  const v = value !== null && value !== undefined ? value : "—";

  return (
    <div
      className={`kpi-card ${className}`}
      data-explain={explainKey}
      title="Click to view explanation"
      onClick={explainKey ? () => showExplanation(explainKey) : undefined}
    >
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <button className="kpi-info-trigger" aria-label="Information" tabIndex={-1} type="button">
          <Icon name="info" size={13} />
        </button>
      </div>
      <div className="kpi-val-row">
        <span className="kpi-value">{v !== "—" ? <span className="mono">{v}</span> : "—"}</span>
        {unit ? <span className="kpi-unit">{unit}</span> : null}
      </div>
      {desc ? <div className="kpi-desc">{desc}</div> : null}
    </div>
  );
}
