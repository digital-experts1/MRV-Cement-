"use client";

import { useState } from "react";
import { PORTFOLIO_METRICS } from "@/lib/mrv/portfolio";
import { Fmt } from "@/components/ui/Fmt";
import styles from "./PortfolioPerformance.module.css";

export interface PerformanceFactory {
  id: string; name: string; code: string; current: boolean; issues: number;
  values: Record<string, number | null>;
}

/** Period totals only: do not invent daily trends from a saved aggregate. */
export function PortfolioPerformance({ factories, start, end, openFactory }: {
  factories: PerformanceFactory[]; start: string; end: string; openFactory: (id: string) => void;
}) {
  const [metric, setMetric] = useState<string>("Direct Embedded CO2");
  const [sort, setSort] = useState("value");
  const selected = PORTFOLIO_METRICS.find(m => m.key === metric)!;
  const single = factories.length === 1 ? factories[0] : null;
  const numeric = factories.filter(f => f.current && f.values[metric] !== null && f.values[metric] !== undefined);
  const max = Math.max(0, ...numeric.map(f => f.values[metric]!));
  const sorted = [...factories].sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) :
    ((b.current ? b.values[metric] : null) ?? -1) - ((a.current ? a.values[metric] : null) ?? -1) || a.name.localeCompare(b.name));
  return <section className={styles.panel} aria-labelledby="performance-title">
    <div className={styles.heading}><div><span className={styles.eyebrow}>FACTORY PERFORMANCE</span><h2 id="performance-title">{single ? single.name : "Compare your factories"}</h2><p>{start} — {end} · Current saved results</p></div><span className={styles.count}>{factories.length} {factories.length === 1 ? "factory" : "factories"} in view</span></div>
    {single ? <>
      <div className={styles.singleMeta}><span>{single.code}</span><span>{single.issues ? `Needs attention · ${single.issues} issues` : "Ready for internal review"}</span><button className="btn btn-secondary" onClick={() => openFactory(single.id)}>Open factory →</button></div>
      <div className={styles.metrics} aria-label="Factory metrics">{PORTFOLIO_METRICS.map((m, i) => <article key={m.key} className={styles.metric} style={{ borderTopColor: COLORS[i] }}><span>{m.label}</span><strong>{single.current ? <Fmt value={single.values[m.key]} unit={m.unit} /> : "—"}</strong><small>{m.unit}</small></article>)}</div>
      <p className={styles.note}>One factory is shown, so these cards display its period totals and intensity. Select a wider factory view to compare sites. Missing values are not zero.</p>
    </> : <>
      <div className={styles.metricPicker} role="group" aria-label="Comparison metric">{PORTFOLIO_METRICS.map((m,i) => <button key={m.key} type="button" aria-pressed={metric === m.key} onClick={() => setMetric(m.key)} className={metric === m.key ? styles.active : ""}><span style={{ background: COLORS[i] }} />{m.label}<small>{m.unit}</small></button>)}</div>
      <div className={styles.chartToolbar}><div><h3>{selected.label}</h3><p>{numeric.length} of {factories.length} factories have a current value · {selected.unit}</p></div><label>Sort by <select value={sort} onChange={e => setSort(e.target.value)}><option value="value">Largest value first</option><option value="name">Factory name</option></select></label></div>
      {factories.length ? <>
        <div className={styles.scale} aria-hidden="true"><span>0</span><span>{max > 0 ? <><Fmt value={max} unit={selected.unit} /> {selected.unit}</> : "No positive values"}</span></div>
        <ul className={styles.bars} aria-label={`${selected.label} by factory`}>{sorted.map(f => {
          const value = f.current ? f.values[metric] : null;
          const present = value !== null && value !== undefined;
          return <li key={f.id}>
            <div className={styles.barHeading}><button onClick={() => openFactory(f.id)}><strong>{f.name}</strong><small>{f.code}</small></button><div className={styles.value}>{present ? <><Fmt value={value} unit={selected.unit} /><small>{selected.unit}</small></> : <span>{f.current ? "Missing value" : "No current result"}</span>}</div></div>
            <div className={styles.track} aria-hidden="true">{present && <span style={{ width: `${max > 0 ? value! / max * 100 : 0}%`, background: COLORS[PORTFOLIO_METRICS.findIndex(m => m.key === metric)] }} />}</div>
            {f.issues > 0 && <small className={styles.attention}>Needs attention · {f.issues} issues — see Factory results below</small>}
          </li>;
        })}</ul>
        <p className={styles.note}>Bars share a zero baseline and scale to the largest visible value. Order shows magnitude, not a performance rating. Check methodology, reporting boundaries and data quality before comparing factories.</p>
      </> : <p className={styles.empty}>No factories match this view. Adjust the search or attention filter to show results.</p>}
    </>}
  </section>;
}

const COLORS = ["#1677ff", "#5669c9", "#087f8c", "#3d8f71", "#b7791f", "#bc5c36", "#7d50b4"];
