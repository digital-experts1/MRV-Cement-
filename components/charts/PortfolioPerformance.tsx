"use client";

import { useEffect, useRef, useState } from "react";
import { Chart, type ChartConfiguration } from "chart.js";
import "./ChartCanvas";
import { PORTFOLIO_METRICS } from "@/lib/mrv/portfolio";
import { Fmt } from "@/components/ui/Fmt";
import styles from "./PortfolioPerformance.module.css";

export interface PerformanceFactory {
  id: string; name: string; code: string; current: boolean; issues: number;
  values: Record<string, number | null>;
}
const COLORS = ["#2267bd", "#168d88", "#8870b5", "#c18b43", "#587c96", "#a95c76"];
const METRICS = PORTFOLIO_METRICS;
const value = (f: PerformanceFactory, key: string) => {
  const v = f.current ? f.values[key] : null;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
};

function Canvas({ config, label }: { config: ChartConfiguration<"bar"> | ChartConfiguration<"doughnut">; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const font = { family: getComputedStyle(ref.current).fontFamily, size: 12 };
    const chart = new Chart(ref.current, { ...config, options: { ...config.options, font,
      animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 250 },
    } } as ChartConfiguration);
    return () => chart.destroy();
  }, [config]);
  return <div className={styles.canvas}><canvas ref={ref} role="img" aria-label={label} /></div>;
}

/** All charts use saved period totals; no synthetic trends or inferred group intensity. */
export function PortfolioPerformance({ factories, start, end, openFactory, allowTotals = false }: {
  factories: PerformanceFactory[]; start: string; end: string; openFactory: (id: string) => void; allowTotals?: boolean;
}) {
  const [mode, setMode] = useState("Production");
  const [sort, setSort] = useState("name");
  const [table, setTable] = useState(false);
  const [energy, setEnergy] = useState("Total Fuel Energy");
  const metrics = mode === "Production" ? METRICS.slice(0, 2) : mode === "Emissions" ? METRICS.slice(2, 4) : mode === "Energy" ? METRICS.filter(m => m.key === energy) : METRICS.slice(6);
  const sorted = [...factories].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : (value(b, metrics[0].key) ?? -1) - (value(a, metrics[0].key) ?? -1));
  const sum = (key: string) => {
    const values = factories.map(f => value(f, key));
    if (!allowTotals || !values.length || values.some(v => v === null)) return null;
    const result = values.reduce<number>((a, b) => a + b!, 0);
    return Number.isFinite(result) ? result : null;
  };
  const direct = sum("Direct Embedded CO2"), grid = sum("Indirect Grid CO2"), cement = sum("Cement Produced");
  const bar = (keys: typeof metrics, horizontal = false): ChartConfiguration<"bar"> => ({
    type: "bar", data: { labels: sorted.map(f => f.name), datasets: keys.map((m, i) => ({ label: `${m.label} (${m.unit})`, data: sorted.map(f => value(f, m.key)), backgroundColor: COLORS[i], borderRadius: 4, maxBarThickness: 42 })) },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: horizontal ? "y" : "x",
      onClick: (_, elements) => { if (elements[0]) openFactory(sorted[elements[0].index].id); },
      scales: { x: { beginAtZero: true, grid: { display: horizontal }, title: { display: horizontal, text: keys[0].unit } }, y: { beginAtZero: true, grid: { display: !horizontal }, title: { display: !horizontal, text: keys[0].unit } } },
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(Number(horizontal ? ctx.parsed.x : ctx.parsed.y))}` } } },
    },
  });
  const donut = (labels: string[], data: number[]): ChartConfiguration<"doughnut"> => ({ type: "doughnut", data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => COLORS[i % COLORS.length]), borderColor: "#fff", borderWidth: 3, hoverOffset: 5 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: "70%", plugins: { legend: { position: "bottom", labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${Number(ctx.raw).toLocaleString()} (${(Number(ctx.raw) / data.reduce((a,b) => a+b,0)*100).toFixed(1)}%)` } } } } });
  const exactTable = (keys: typeof metrics) => <div className={styles.tableWrap}><table><caption>Exact saved values · {start} — {end}</caption><thead><tr><th>Factory</th>{keys.map(m => <th key={m.key}>{m.label} ({m.unit})</th>)}</tr></thead><tbody>{sorted.map(f => <tr key={f.id}><th><button onClick={() => openFactory(f.id)}>{f.name}</button>{!f.current && <small>No current result</small>}</th>{keys.map(m => <td key={m.key}><Fmt value={value(f, m.key)} unit={m.unit} /></td>)}</tr>)}</tbody></table></div>;
  if (!factories.length) return <section className={styles.panel}><h2>Factory analytics</h2><p>No factories match your filters.</p></section>;
  return <section className={styles.dashboard} aria-label="Factory analytics">
    <div className={styles.metrics}>{[METRICS[0], METRICS[1], METRICS[2], METRICS[4]].map((m, i) => <article className={styles.kpi} key={m.key} style={{ borderTopColor: COLORS[i] }}><span>{m.label}</span><strong><Fmt value={sum(m.key)} unit={m.unit} /> <small>{m.unit}</small></strong><small>{sum(m.key) === null ? "Total withheld · see comparability rules below" : `${factories.length} visible factories · management sum`}</small></article>)}</div>
    <div className={styles.grid}>
      <article className={styles.panel}>
        <div className={styles.heading}><div><h2>{factories.length === 1 ? "Factory performance" : "Compare factory performance"}</h2><p>{start} — {end} · Saved period totals</p></div><button aria-pressed={table} onClick={() => setTable(!table)}>{table ? "Show charts" : "Show values"}</button></div>
        <div className={styles.tabs} role="group" aria-label="Chart metric">{["Production", "Emissions", "Energy", "Intensity"].map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m}</button>)}</div>
        <div className={styles.controls}><label>Order <select value={sort} onChange={e => setSort(e.target.value)}><option value="name">Factory name</option><option value="value">Largest value first</option></select></label>{mode === "Energy" && <label>Measure <select value={energy} onChange={e => setEnergy(e.target.value)}><option value="Total Fuel Energy">Fuel energy · GJ</option><option value="Grid Electricity MWh">Grid electricity · MWh</option></select></label>}</div>
        {table ? exactTable(metrics) : <><div className={styles.plotScroll}><div style={{ minWidth: sorted.length > 8 ? sorted.length * 85 : undefined }}><Canvas config={bar(metrics)} label={`${mode} by factory. Exact values available using Show values.`} /></div></div><p className={styles.note}>Select a bar to open its factory. Missing or outdated results are gaps, not zero. Comparison shows magnitude, not a quality rating.</p></>}
      </article>
      <article className={styles.panel}><h2>Emissions composition</h2><p>Direct and grid emissions · tCO₂</p>{direct !== null && grid !== null && direct + grid > 0 ? <><Canvas config={donut(["Direct", "Grid"], [direct, grid])} label={`Direct ${direct} tCO2; Grid ${grid} tCO2`} /><p className={styles.total}><Fmt value={direct + grid} unit="tCO2" /> tCO₂ <small>Management sum before transfer reconciliation</small></p></> : <div className={styles.empty}>{direct === 0 && grid === 0 ? "Recorded emissions are zero. No composition to display." : "Composition withheld until all factories are comparable and both emissions values are available."}</div>}</article>
      <article className={styles.panel}><h2>Emissions intensity by factory</h2><p>Saved cement intensity · tCO₂ / t cement</p><Canvas config={bar(METRICS.slice(6), true)} label="Saved cement emissions intensity by factory. Exact values in the factory results table." /><p className={styles.note}>Use equivalent boundaries and methodologies. Intensities are never averaged.</p></article>
      <article className={styles.panel}><h2>Share of cement production</h2><p>Contribution to the visible factory sum</p>{factories.length > 1 && factories.length <= 6 && cement !== null && cement > 0 ? <><Canvas config={donut(factories.map(f => f.name), factories.map(f => value(f, "Cement Produced")!))} label={factories.map(f => `${f.name}: ${value(f, "Cement Produced")} t`).join("; ")} /><p className={styles.total}><Fmt value={cement} unit="t" /> t</p></> : <div className={styles.empty}>{factories.length === 1 ? "One factory is in view. Production share becomes useful when comparing multiple factories." : factories.length > 6 ? "Use the production bars to compare more than six factories clearly." : cement === 0 ? "Recorded production is zero. No shares to display." : "Shares withheld until all factories have comparable, complete production results."}</div>}</article>
    </div>
    <p className={styles.note}>Charts follow the factory search and attention filters. Totals are withheld unless the full authorized portfolio meets the existing comparability rules. QA issues remain visible below; internal review is not external verification.</p>
  </section>;
}
