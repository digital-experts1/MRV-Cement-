"use client";

import { useEffect, useState } from "react";
import { PRESET_LABELS, RANGE_PRESETS, parseDate, todayIn, validateSpec, type RangePreset, type RangeSpec, type ResolvedRange } from "@/lib/mrv/dateRanges";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function withDefaults(preset: RangePreset, current: RangeSpec | null, timezone: string): RangeSpec {
  const t = parseDate(todayIn(timezone))!;
  const year = current?.year ?? t.y;
  switch (preset) {
    case "month":
      return { preset, year, month: current?.month ?? t.m };
    case "quarter":
      return { preset, year, quarter: current?.quarter ?? Math.ceil(t.m / 3) };
    case "half":
      return { preset, year, half: current?.half ?? (t.m <= 6 ? 1 : 2) };
    case "year":
    case "fiscal_year":
      return { preset, year };
    case "custom":
      return { preset, start: current?.start ?? `${t.y}-01-01`, end: current?.end ?? todayIn(timezone) };
    default:
      return { preset };
  }
}

/** Reporting date-range selector. Shows the exact resolved dates and timezone so labels are never ambiguous. */
export function RangeSelector({ spec, resolved, timezone, onChange, disabled }: {
  spec: RangeSpec | null;
  resolved: ResolvedRange | null;
  timezone: string;
  onChange: (spec: RangeSpec) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<RangeSpec | null>(spec);
  useEffect(() => setDraft(spec), [spec]);

  const apply = (next: RangeSpec) => {
    setDraft(next);
    if (next.preset !== "custom" && validateSpec(next)) onChange(next);
  };
  const years = Array.from({ length: 12 }, (_, i) => parseDate(todayIn(timezone))!.y - 9 + i);
  const d = draft;
  const customValid = d?.preset === "custom" && !!validateSpec(d);

  return (
    <div className="range-selector">
      <select
        className="scope-select"
        aria-label="Reporting range"
        value={d?.preset ?? ""}
        disabled={disabled}
        onChange={(e) => apply(withDefaults(e.target.value as RangePreset, d, timezone))}
      >
        {!d ? <option value="">Select range…</option> : null}
        {RANGE_PRESETS.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABELS[p]}
          </option>
        ))}
      </select>
      {d && ["month", "quarter", "half", "year", "fiscal_year"].includes(d.preset) ? (
        <select className="scope-select" aria-label="Year" value={d.year} disabled={disabled} onChange={(e) => apply({ ...d, year: Number(e.target.value) })}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      ) : null}
      {d?.preset === "month" ? (
        <select className="scope-select" aria-label="Month" value={d.month} disabled={disabled} onChange={(e) => apply({ ...d, month: Number(e.target.value) })}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      ) : null}
      {d?.preset === "quarter" ? (
        <select className="scope-select" aria-label="Quarter" value={d.quarter} disabled={disabled} onChange={(e) => apply({ ...d, quarter: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q} ({["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][q - 1]})
            </option>
          ))}
        </select>
      ) : null}
      {d?.preset === "half" ? (
        <select className="scope-select" aria-label="Half year" value={d.half} disabled={disabled} onChange={(e) => apply({ ...d, half: Number(e.target.value) })}>
          <option value={1}>H1 (Jan–Jun)</option>
          <option value={2}>H2 (Jul–Dec)</option>
        </select>
      ) : null}
      {d?.preset === "custom" ? (
        <>
          <input className="scope-select" type="date" aria-label="Start date" value={d.start ?? ""} disabled={disabled} onChange={(e) => setDraft({ ...d, start: e.target.value })} />
          <span className="scope-muted">to</span>
          <input className="scope-select" type="date" aria-label="End date (inclusive)" value={d.end ?? ""} disabled={disabled} onChange={(e) => setDraft({ ...d, end: e.target.value })} />
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || !customValid} onClick={() => d && onChange(d)}>
            Apply
          </button>
        </>
      ) : null}
      {resolved ? (
        <span className="range-resolved mono" title={`Inclusive dates in the factory timezone (${resolved.timezone})`}>
          {resolved.start} → {resolved.end} · {resolved.timezone}
        </span>
      ) : null}
    </div>
  );
}
