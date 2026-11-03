"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart } from "chart.js";
import "@/components/charts/ChartCanvas";
import { readingInterval, readingTrends, fuelEnergy, type Grain, type TrendMetric } from "@/lib/readingTrends";
import type { SheetRow, Store } from "@/lib/types";
import styles from "./SourceCharts.module.css";

const sections = [["production", "Production"], ["kilnFuel", "Fuel"], ["electricity", "Electricity"], ["rawMaterial", "Raw materials"]] as const;
type Section = typeof sections[number][0];
const palette = ["#1677ff", "#089e99", "#d97706", "#64748b", "#7c3aed", "#db2777"];
const format = (value: unknown): string => value === null || value === undefined || value === "" ? "Missing" : typeof value === "number" ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value) : typeof value === "object" ? JSON.stringify(value) : String(value);
function metricsFor(section: Section, rows: SheetRow[]): TrendMetric[] {
  if (section === "production") return [{ label: "Cement", field: "Cement Produced t" }, { label: "Clinker", field: "Clinker Produced t" }];
  if (section === "electricity") return [{ label: "Grid", field: "Grid MWh" }, { label: "Self-generation", field: "Self-generation MWh" }, { label: "Renewable", field: "Renewable MWh" }];
  const group = section === "kilnFuel" ? "Fuel Type" : "Material";
  return [...new Set(rows.map(row => String(row[group] ?? "Unspecified")))].sort().map(label => ({ label, group, field: "Quantity t", ...(section === "kilnFuel" ? { value: fuelEnergy } : {}) }));
}
function TrendCanvas({ result, unit, bars, onSelect }: { result: ReturnType<typeof readingTrends>; unit: string; bars: boolean; onSelect: (index: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const font = { family: getComputedStyle(ref.current).fontFamily, size: 12 };
    const chart = new Chart(ref.current, {
      type: bars ? "bar" : "line",
      data: { labels: result.labels, datasets: result.series.map((series, index) => ({ ...series, borderColor: palette[index % palette.length], backgroundColor: palette[index % palette.length], borderWidth: bars ? 0 : 2, pointRadius: result.labels.length > 60 ? 1 : 3, pointHoverRadius: 6, tension: 0, spanGaps: false, maxBarThickness: 28 })) },
      options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
        onClick: (_event, elements) => { if (elements[0]) onSelect(elements[0].index); },
        scales: { x: { ticks: { font, maxTicksLimit: 10, maxRotation: 0 }, grid: { display: false } }, y: { beginAtZero: true, title: { display: true, text: unit, font }, ticks: { font }, grid: { color: "#edf1f7" } } },
        plugins: { legend: { position: "bottom", labels: { font, usePointStyle: true, boxWidth: 8, padding: 20 } }, tooltip: { titleFont: font, bodyFont: font, backgroundColor: "#0f2747", padding: 12, callbacks: { label: ctx => `${ctx.dataset.label}: ${format(ctx.parsed.y)} ${unit}`, footer: () => "Click to inspect source readings" } } } }
    });
    return () => chart.destroy();
  }, [result, unit, bars, onSelect]);
  return <canvas ref={ref} role="img" aria-label={`Readings trend in ${unit}. Use the readings table or interval selector to inspect exact values.`} />;
}
export function SourceCharts({ s }: { s: Store }) {
  // Remount controls and selections whenever a new authorized dataset arrives.
  return <ReadingsTrends key={`${s.meta.run?.id}:${s.meta.revision}`} s={s} />;
}
function ReadingsTrends({ s }: { s: Store }) {
  const [section, setSection] = useState<Section>("production");
  const [grain, setGrain] = useState<Grain>("daily");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [selected, setSelected] = useState<number | null>(null);
  const [dates, setDates] = useState({ start: "", end: "" });
  const rows = s.inputs[section];
  const bounds = useMemo(() => {
    const iv = rows.map(readingInterval).filter(x => x !== null);
    return { start: iv.map(x => x.start).sort()[0] ?? "", end: iv.map(x => x.end).sort().at(-1) ?? "" };
  }, [rows]);
  const start = dates.start || bounds.start, end = dates.end || bounds.end;
  const invalid = start > end;
  const metrics = useMemo(() => metricsFor(section, rows), [section, rows]);
  const result = useMemo(() => readingTrends(rows, metrics, grain, start, end), [rows, metrics, grain, start, end]);
  const fuelResult = useMemo(() => readingTrends(s.inputs.kilnFuel, metricsFor("kilnFuel", s.inputs.kilnFuel), grain, start, end), [s.inputs.kilnFuel, grain, start, end]);
  const electricityResult = useMemo(() => readingTrends(s.inputs.electricity, metricsFor("electricity", s.inputs.electricity), grain, start, end), [s.inputs.electricity, grain, start, end]);
  const inspectFuel = useCallback((index: number) => { setSection("kilnFuel"); setDates({ start, end }); setSelected(index); }, [start, end]);
  const inspectElectricity = useCallback((index: number) => { setSection("electricity"); setDates({ start, end }); setSelected(index); }, [start, end]);
  const unit = section === "kilnFuel" ? "GJ" : section === "electricity" ? "MWh" : "t";
  const selection = selected !== null ? result.indices[selected] ?? [] : [];
  const columns = [...new Set(selection.flatMap(i => Object.keys(rows[i])))];
  return <section className={styles.panel} aria-label="Readings and trends">
    <header className={styles.heading}><div><h2>Readings & trends</h2><p>Explore the selected factory’s readings. Inspect the source behind each point.</p></div>{s.meta.synthetic && <span className="badge badge-info">Synthetic demo</span>}</header>
    <div className={styles.toolbar}>
      <div className={styles.tabs} aria-label="Reading category">{sections.map(([key, label]) => <button key={key} type="button" aria-pressed={section === key} onClick={() => { setSection(key); setDates({ start: "", end: "" }); setSelected(null); }}>{label}</button>)}</div>
      <label>From<input aria-label="Chart start date" type="date" min={bounds.start} max={bounds.end} value={start} onChange={e => { setDates({ start: e.target.value, end }); setSelected(null); }} /></label>
      <label>To<input aria-label="Chart end date" type="date" min={bounds.start} max={bounds.end} value={end} onChange={e => { setDates({ start, end: e.target.value }); setSelected(null); }} /></label>
      <label>Group by<select aria-label="Aggregation" value={result.grain} onChange={e => { setGrain(e.target.value as Grain); setSelected(null); }}><option value="daily" disabled={result.grain === "interval"}>Day</option><option value="weekly" disabled={result.grain === "interval"}>Week (Monday)</option><option value="monthly" disabled={result.grain === "interval"}>Month</option>{result.grain === "interval" && <option value="interval">Source interval</option>}</select></label>
      <button type="button" className="btn btn-secondary" onClick={() => { setDates({ start: "", end: "" }); setSelected(null); }}>Reset dates</button>
    </div>
    <div className={styles.summary}><div><h3>{sections.find(([key]) => key === section)?.[1]} over time <span>({unit})</span></h3><p>{result.selected} source rows · {result.grain === "interval" ? "Original reporting intervals" : `${result.observedDays} days with readings`} · {result.undated} undated rows</p></div><div className={styles.tabs} aria-label="Chart display"><button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")}>Trend</button><button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>Readings table</button></div></div>
    {invalid ? <p role="alert">Start date must be on or before end date.</p> : !result.selected ? <div className={styles.empty}>No dated readings in this selection. Adjust the chart dates or upload readings for the selected factory.</div> : view === "chart" ? <div className={styles.canvas}><TrendCanvas result={result} unit={unit} bars={section !== "production" || result.grain === "interval"} onSelect={setSelected} /></div> : <div className={styles.scroll}><table className="data-table"><thead><tr><th>Period</th>{result.series.map(x => <th key={x.label}>{x.label} ({unit})</th>)}<th>Source</th></tr></thead><tbody>{result.labels.map((label, index) => <tr key={label}><td>{label}</td>{result.series.map(x => <td key={x.label}>{format(x.data[index])}</td>)}<td><button type="button" className="btn btn-secondary" disabled={!result.indices[index].length} onClick={() => setSelected(index)}>Inspect {result.indices[index].length} rows</button></td></tr>)}</tbody></table></div>}
    {section === "production" && view === "chart" && !invalid && <div className={styles.companions}>
      <section><div className={styles.summary}><h3>Fuel energy <span>(GJ)</span></h3><button type="button" className="btn btn-secondary" onClick={() => { setSection("kilnFuel"); setDates({ start, end }); setSelected(null); }}>Explore fuel</button></div>{fuelResult.selected ? <div className={styles.smallCanvas}><TrendCanvas result={fuelResult} unit="GJ" bars onSelect={inspectFuel} /></div> : <p>No fuel readings in this date range.</p>}</section>
      <section><div className={styles.summary}><h3>Electricity sources <span>(MWh)</span></h3><button type="button" className="btn btn-secondary" onClick={() => { setSection("electricity"); setDates({ start, end }); setSelected(null); }}>Explore electricity</button></div>{electricityResult.selected ? <div className={styles.smallCanvas}><TrendCanvas result={electricityResult} unit="MWh" bars onSelect={inspectElectricity} /></div> : <p>No electricity readings in this date range.</p>}</section>
    </div>}
    <p className={styles.note}>Gaps mean missing values; zero appears only when recorded. Weekly and monthly values sum available observations and may be incomplete. Source intervals are never split into days. {result.excluded > 0 && `${result.excluded} rows outside or crossing the chart date boundaries are excluded.`} {section === "kilnFuel" && "Fuel energy uses quantity × NCV; missing NCV leaves a gap."} {section === "electricity" && "Sources are shown separately; renewable and self-generation may overlap."}</p>
    <label className={styles.inspect}>Inspect a period<select aria-label="Inspect a period" value={selected ?? ""} onChange={e => setSelected(e.target.value === "" ? null : Number(e.target.value))}><option value="">Choose a period to view source readings</option>{result.labels.map((label, index) => <option key={label} value={index}>{label} ({result.indices[index].length} rows)</option>)}</select></label>
    {selected !== null && <div className={styles.detail}><div className={styles.summary}><h3>Source readings · {result.labels[selected]}</h3><button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Close source readings</button></div>{selection.length ? <div className={styles.scroll}><table className="data-table"><thead><tr><th>Input row</th>{columns.map(col => <th key={col}>{col === "_source" ? "Source provenance" : col}</th>)}</tr></thead><tbody>{selection.map(index => <tr key={index}><td>{index + 1}</td>{columns.map(col => <td key={col}>{format(rows[index][col])}</td>)}</tr>)}</tbody></table></div> : <p>No readings recorded for this period.</p>}</div>}
  </section>;
}
