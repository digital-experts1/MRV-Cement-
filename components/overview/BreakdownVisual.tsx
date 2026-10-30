"use client";

import { useEffect, useRef, useState } from "react";
import Chart from "chart.js/auto";

export interface VisualItem { label: string; value: number; color: string }
/** Presentation only: values and totals come from the selected calculation. */
export function BreakdownVisual({ items, total, unit, label }: { items: VisualItem[]; total: string; unit: string; label: string }) {
  const [mode, setMode] = useState<"doughnut" | "bar">("doughnut");
  const canvas = useRef<HTMLCanvasElement>(null);
  const available = items.filter(i => Number.isFinite(i.value) && i.value >= 0);
  const hasValues = available.some(i => i.value > 0);
  const key = JSON.stringify(available);
  useEffect(() => {
    if (!canvas.current || !hasValues) return;
    const values: VisualItem[] = JSON.parse(key);
    const chart = new Chart(canvas.current, {
      type: mode,
      data: { labels: values.map(i => i.label), datasets: [{ label: unit, data: values.map(i => i.value), backgroundColor: values.map(i => i.color), borderColor: "#fff", borderWidth: mode === "doughnut" ? 4 : 0, borderRadius: 6, hoverOffset: 8, maxBarThickness: 36 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 350 },
        ...(mode === "doughnut" ? { cutout: "76%" } : { indexAxis: "y" as const, scales: { x: { beginAtZero: true, grid: { color: "#e5edf5" }, ticks: { color: "#52647a", callback: (v: string | number) => new Intl.NumberFormat("en", { notation: "compact" }).format(Number(v)) }, title: { display: true, text: unit } }, y: { grid: { display: false }, ticks: { color: "#203957", font: { size: 11 } } } } }),
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "#203957", padding: 12, cornerRadius: 8, callbacks: { label: ctx => `${new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(mode === "bar" ? ctx.parsed.x ?? 0 : Number(ctx.parsed))} ${unit}` } } },
      },
    });
    return () => chart.destroy();
  }, [key, mode, unit, hasValues]);
  return <div className="overview-visual">
    <div className="overview-chart-controls" role="group" aria-label={`${label} chart view`}>
      <button type="button" aria-pressed={mode === "doughnut"} onClick={() => setMode("doughnut")}>Doughnut</button>
      <button type="button" aria-pressed={mode === "bar"} onClick={() => setMode("bar")}>Compare bars</button>
    </div>
    {hasValues ? <div className="overview-visual-layout">
      <div className={`overview-plot overview-plot-${mode}`}>
        <canvas ref={canvas} role="img" aria-label={`${label}. Exact values are listed beside the chart.`} />
        {mode === "doughnut" && <div className="overview-chart-center" aria-hidden="true"><span>Total</span><strong>{total}</strong><span>{unit}</span></div>}
      </div>
      <ul className="overview-chart-legend" aria-label={`${label} values`}>
        {available.map(item => <li key={item.label}><span className="overview-legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(item.value)} <small>{unit}</small></strong></li>)}
      </ul>
    </div> : <p className="overview-chart-empty">{available.length ? "All available values are zero. No proportional chart to display." : "No calculated values available for this period."}</p>}
  </div>;
}
