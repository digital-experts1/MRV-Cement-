"use client";

import { INTERVAL_MAPPINGS, MAPPING_LABELS, type IntervalMapping } from "@/lib/mrv/importMapping";

/** Explicit, reviewed interpretation of dated rows (Directive 06 §3). Nothing is inferred when left unselected. */
export function MappingSelect({ value, onChange, id }: { value: IntervalMapping | ""; onChange: (v: IntervalMapping | "") => void; id: string }) {
  return (
    <label className="mapping-select" htmlFor={id}>
      <span>Row interval mapping</span>
      <select id={id} className="form-input" value={value} onChange={(e) => onChange(e.target.value as IntervalMapping | "")}>
        <option value="">Not declared — only rows with Interval Start/End columns are accepted</option>
        {INTERVAL_MAPPINGS.map((m) => (
          <option key={m} value={m}>
            {MAPPING_LABELS[m]}
          </option>
        ))}
      </select>
    </label>
  );
}
