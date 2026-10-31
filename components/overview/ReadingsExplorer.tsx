"use client";

import { useMemo, useState } from "react";
import { useScope } from "@/context/ScopeContext";
import type { SheetRow, Store } from "@/lib/types";

const SECTIONS = [
  ["production", "Production"], ["kilnFuel", "Fuel"], ["electricity", "Electricity"],
  ["rawMaterial", "Raw materials"], ["inventory", "Inventory"], ["constants", "Constants"],
  ["fuelDefaults", "Fuel defaults"], ["setupRows", "Setup"], ["dcsMap", "DCS / ERP / Lab mapping"],
  ["evidence", "Evidence"], ["regulatory", "Regulatory references"], ["readme", "Readme"],
] as const;
type Section = typeof SECTIONS[number][0];
function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Missing";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
export function ReadingsExplorer({ s }: { s: Store }) {
  const scope = useScope();
  const [section, setSection] = useState<Section>("production");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(25);
  const [sort, setSort] = useState<{ key: string; ascending: boolean } | null>(null);
  const rows: SheetRow[] = s.inputs[section];
  const columns = useMemo(() => [...new Set(rows.flatMap(row => Object.keys(row)))], [rows]);
  const filtered = useMemo(() => {
    const items = rows.map((row, index) => ({ row, index })).filter(({ row }) => Object.values(row).some(v => cell(v).toLowerCase().includes(query.toLowerCase())));
    if (sort) items.sort((a, b) => {
      const x = a.row[sort.key], y = b.row[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : cell(x).localeCompare(cell(y), undefined, { numeric: true })) * (sort.ascending ? 1 : -1);
    });
    return items;
  }, [rows, query, sort]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / size) - 1));
  function exportCsv() {
    const quote = (v: unknown) => {
      let text = v === null || v === undefined ? "" : cell(v);
      if (typeof v !== "number" && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const csv = [columns.map(quote).join(","), ...filtered.map(({ row }) => columns.map(k => quote(row[k])).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${s.meta.synthetic ? "SYNTHETIC-" : ""}${section}-${scope.range?.start ?? "selected"}-${scope.range?.end ?? "period"}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="section-card overview-explorer" id="overview-readings" aria-label="Readings and source inputs">
    <div className="overview-explorer-heading"><div><h2>Readings & source inputs</h2><p>Every input row used by the displayed calculation. Original fields, units and provenance are retained.</p></div>
      {scope.readingsPeriod && <button className="btn btn-secondary" type="button" disabled={scope.loading} onClick={scope.openReadingsPeriod}>Show full stored period</button>}
    </div>
    <div className="overview-input-tabs" aria-label="Input sections">{SECTIONS.map(([key, label]) => <button type="button" key={key} aria-pressed={section === key} onClick={() => { setSection(key); setPage(0); setSort(null); setQuery(""); }}>{label} <span>{s.inputs[key].length}</span></button>)}</div>
    <div className="overview-table-tools"><label>Search all fields <input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Find a reading, fuel, date or source" /></label>
      <label>Rows per page <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(0); }}>{[10,25,50,100].map(n => <option key={n}>{n}</option>)}</select></label>
      <button className="btn btn-secondary" type="button" disabled={!filtered.length} onClick={exportCsv}>Export filtered readings (.csv)</button>
    </div>
    <p className="overview-input-caption">{scope.range?.start} – {scope.range?.end} · {s.meta.synthetic ? "Synthetic data · " : ""}Changing the reporting range updates both results and these inputs. Excluded records remain in Run details.</p>
    <div className="table-wrapper overview-scroll-table"><table className="data-table"><thead><tr><th>Input row</th>{columns.map(key => <th key={key}><button type="button" onClick={() => setSort({ key, ascending: sort?.key === key ? !sort.ascending : true })}>{key === "_source" ? "Source provenance" : key}{sort?.key === key ? sort.ascending ? " ↑" : " ↓" : ""}</button></th>)}</tr></thead><tbody>
      {filtered.slice(currentPage * size, (currentPage + 1) * size).map(({ row, index }) => <tr key={index}><td>{index + 1}</td>{columns.map(key => <td key={key}>{typeof row[key] === "object" && row[key] !== null ? <details><summary>View details</summary><pre>{JSON.stringify(row[key], null, 2)}</pre></details> : cell(row[key])}</td>)}</tr>)}
      {!filtered.length && <tr><td colSpan={columns.length + 1}>{rows.length ? "No rows match this search." : "No rows supplied for this section in the displayed calculation. Missing data is not zero."}</td></tr>}
    </tbody></table></div>
    <div className="overview-table-tools overview-pagination"><span aria-live="polite">{filtered.length ? `${currentPage * size + 1}–${Math.min((currentPage + 1) * size, filtered.length)}` : "0"} of {filtered.length} matching rows · {rows.length} total</span><button className="btn btn-secondary" type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="btn btn-secondary" type="button" disabled={(currentPage + 1) * size >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</button></div>
  </section>;
}
