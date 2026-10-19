"use client";

import { INTERVAL_MAPPINGS, MAPPABLE_SECTIONS, MAPPING_LABELS, parseMapping, serializeMapping, type IntervalMapping, type MappableSection } from "@/lib/mrv/importMapping";
import { SECTION_LABELS_CLIENT } from "@/lib/mrv/sectionLabels";

/**
 * Explicit, reviewed interpretation of dated rows (Directive 06 §3). Nothing is inferred when left unselected.
 * `value` is the serialized mapping sent to the API (see parseMapping); per-sheet overrides cover workbooks that mix
 * monthly rows with quarter totals.
 */
export function MappingSelect({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const parsed = parseMapping(value);
  const def: IntervalMapping | "" = parsed?.interval ?? "";
  const sections: Partial<Record<MappableSection, IntervalMapping | "">> = parsed?.sections ?? {};
  const overrides = MAPPABLE_SECTIONS.filter((s) => sections[s]).length;

  return (
    <div className="mapping-select">
      <label htmlFor={id}>
        <span>Row interval mapping</span>
        <select id={id} className="form-input" value={def} onChange={(e) => onChange(serializeMapping(e.target.value as IntervalMapping | "", sections))}>
          <option value="">Not declared — only rows with Interval Start/End columns are accepted</option>
          {INTERVAL_MAPPINGS.map((m) => (
            <option key={m} value={m}>
              {MAPPING_LABELS[m]}
            </option>
          ))}
        </select>
      </label>
      <details className="mapping-overrides" open={overrides > 0}>
        <summary>Per-sheet overrides{overrides ? ` (${overrides})` : ""}</summary>
        {MAPPABLE_SECTIONS.map((s) => (
          <label key={s} htmlFor={`${id}-${s}`}>
            <span>{SECTION_LABELS_CLIENT[s]}</span>
            <select
              id={`${id}-${s}`}
              className="form-input"
              value={sections[s] ?? ""}
              onChange={(e) => onChange(serializeMapping(def, { ...sections, [s]: e.target.value as IntervalMapping | "" }))}
            >
              <option value="">Use the mapping above</option>
              {INTERVAL_MAPPINGS.map((m) => (
                <option key={m} value={m}>
                  {MAPPING_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </details>
    </div>
  );
}
