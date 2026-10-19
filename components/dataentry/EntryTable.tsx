"use client";

import { Icon } from "@/components/icons/Icon";
import type { SheetRow } from "@/lib/types";

export interface EntryColumn {
  key: string;
  label: string;
  type: "date" | "text" | "number" | "select" | "computed";
  options?: { value: string; label: string }[];
  step?: string;
  minWidth?: number;
  /** For computed columns: renders a value from the engine-computed row. */
  render?: (computed: SheetRow | undefined) => React.ReactNode;
}

/** Editable input table. Inputs show the raw entered value; computed cells come from the shared engine output. */
export function EntryTable({
  columns,
  rows,
  computedRows,
  onChange,
  onRemove,
}: {
  columns: EntryColumn[];
  rows: SheetRow[];
  computedRows: SheetRow[];
  onChange: (idx: number, key: string, value: string) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="entry-table-wrap">
      <table className="entry-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            <th style={{ width: 36 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} style={{ color: "var(--text-muted)", fontSize: 12 }}>
                No records. Missing records are reported as incomplete, never as zero.
              </td>
            </tr>
          ) : null}
          {rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map((c) => {
                const value = row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key]);
                if (c.type === "computed") return <td key={c.key}>{c.render?.(computedRows[idx])}</td>;
                if (c.type === "select") {
                  return (
                    <td key={c.key}>
                      <select className="table-select" aria-label={c.label} value={value} onChange={(e) => onChange(idx, c.key, e.target.value)}>
                        <option value="">— select —</option>
                        {c.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                }
                return (
                  <td key={c.key}>
                    <input
                      type={c.type}
                      step={c.step}
                      className="table-input"
                      aria-label={c.label}
                      style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                      value={value}
                      onChange={(e) => onChange(idx, c.key, e.target.value)}
                    />
                  </td>
                );
              })}
              <td>
                <button type="button" className="btn-delete-row" onClick={() => onRemove(idx)} title="Delete row" aria-label="Delete row">
                  <Icon name="trash-2" size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
