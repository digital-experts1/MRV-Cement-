"use client";

import { Icon } from "@/components/icons/Icon";
import { useScope } from "@/context/ScopeContext";
import { useStore } from "@/context/StoreContext";

export function EmptyState({ title }: { title: string }) {
  const { openUpload } = useStore();
  const scope = useScope();
  const hasRuns = !!scope.summary?.latestCalculation;
  const readings = scope.summary?.currentReadings ?? 0;
  const period = scope.range ? `${scope.range.label} (${scope.range.start} – ${scope.range.end})` : "the selected reporting period";
  const readingsPeriod = scope.readingsPeriod;
  const inReadingsPeriod = !!readingsPeriod && !!scope.range && readingsPeriod.start === scope.range.start && readingsPeriod.end === scope.range.end;

  let heading = "No data loaded yet";
  let message = `Upload your TRACE FORCE MRV workbook to view ${title.toLowerCase()}.`;
  let action: { label: string; onClick: () => void } | null = null;
  if (hasRuns) {
    heading = "No saved results for this reporting period";
    message = `This factory has saved calculation results, but none for ${period}.`;
    action = { label: "Open latest saved results", onClick: scope.openLatestSaved };
  } else if (readings > 0) {
    heading = "Stored readings, no calculated results yet";
    message = `This factory has ${readings} stored reading(s) (latest ${scope.summary?.latestObservation ?? "—"}), but no calculation has been saved. Readings are not results: a reporting period must be calculated first.`;
    if (readingsPeriod && !inReadingsPeriod) action = { label: `Open ${readingsPeriod.label}`, onClick: scope.openReadingsPeriod };
    else if (scope.canCalculate) action = { label: "Calculate this period", onClick: scope.recalculate };
    else message += " An MRV analyst or facility manager must calculate it.";
  } else if (scope.error) {
    heading = "Unable to load saved data";
    action = { label: "Retry loading saved data", onClick: scope.reload };
  }
  const archive = scope.summary?.archive ?? null;
  if (archive && !hasRuns && readings === 0) {
    heading = "No active dataset";
    message = `The previous dataset of this factory was archived (${new Date(archive.at).toLocaleDateString()}): ${archive.reason}. Its readings, calculations and configuration remain available as labelled history only. Upload a fresh workbook to start a new dataset.`;
  }

  return (
    <div className="state-box">
      <div className="state-icon" style={{ color: "var(--accent)" }}>
        <Icon name="upload" size={40} />
      </div>
      <div className="state-title">{heading}</div>
      <div className="state-sub">{message}</div>
      {scope.error ? (
        <div className="state-sub" role="alert">
          Could not load saved data: {scope.error}
        </div>
      ) : null}
      {action ? (
        <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={action.onClick} disabled={scope.calculating}>
          {action.label}
        </button>
      ) : null}
      {hasRuns && readingsPeriod && !inReadingsPeriod ? (
        <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={scope.openReadingsPeriod} disabled={scope.calculating}>
          Open stored readings period ({readingsPeriod.start} – {readingsPeriod.end})
        </button>
      ) : null}
      {hasRuns && readings > 0 && scope.canCalculate ? (
        <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={scope.recalculate} disabled={scope.calculating}>
          Calculate selected period
        </button>
      ) : null}
      <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={openUpload} aria-haspopup="dialog">
        <Icon name="upload" size={14} /> Upload Readings File
      </button>
    </div>
  );
}

export function LoadingState({ filename }: { filename?: string }) {
  return (
    <div className="state-box">
      <div className="spinner" />
      <div className="state-title">Loading data…</div>
      {filename ? <div className="state-sub" style={{ color: "var(--text-muted)", fontSize: 12 }}>{filename}</div> : null}
      <div className="state-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
        Please wait while the selected dataset is loaded.
      </div>
    </div>
  );
}

export function ErrorBanner({ title, errors }: { title: string; errors: string[] }) {
  return (
    <div className="error-banner">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon name="alert-triangle" size={16} />
        <h3 style={{ margin: 0 }}>{title}</h3>
      </div>
      <ul>
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}
