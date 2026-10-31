"use client";
import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts/ChartCanvas";
import { overviewSeries, productionInterval } from "@/lib/overviewSeries";
import type { Store } from "@/lib/types";
export function SourceCharts({ s }: { s: Store }) {
  const [product, setProduct] = useState("Cement Produced t");
  const units = [...new Set(s.inputs.kilnFuel.map(r => r.Unit).filter(v => typeof v === "string" && v))] as string[];
  const [chosenUnit, setUnit] = useState("");
  const unit = units.includes(chosenUnit) ? chosenUnit : units[0] ?? "";
  const production = useMemo(() => overviewSeries(s.inputs.production, productionInterval, product), [s.inputs.production, product]);
  const fuel = useMemo(() => overviewSeries(s.inputs.kilnFuel.filter(r => r.Unit === unit), r => r["Fuel Type"] ? String(r["Fuel Type"]) : null, "Quantity"), [s.inputs.kilnFuel, unit]);
  return <div className="grid-2 mb-lg overview-source-charts">
    <section className="chart-card"><div className="chart-card-header"><h3>Production by source interval</h3><label>Product <select value={product} onChange={e => setProduct(e.target.value)}><option value="Cement Produced t">Cement</option><option value="Clinker Produced t">Clinker</option></select></label></div>
      <div className="chart-container" role="img" aria-label="Production interval quantities in tonnes">{production.labels.length ? <BarChart labels={production.labels} data={production.values} colors={["#1765e8"]} yUnit="t" /> : <p>No complete, dated production quantities are available.</p>}</div>
      <p>Stored intervals are shown as supplied, without dividing monthly readings into days. {production.incomplete} incomplete intervals and {production.unlabelled} undated rows omitted. Exact readings are below.</p>
    </section>
    <section className="chart-card"><div className="chart-card-header"><h3>Fuel quantities by type</h3><label>Unit <select value={unit} onChange={e => setUnit(e.target.value)}>{units.map(u => <option key={u}>{u}</option>)}</select></label></div>
      <div className="chart-container" role="img" aria-label={`Fuel quantities in ${unit}`}>{fuel.labels.length ? <BarChart horizontal labels={fuel.labels} data={fuel.values} colors={["#078e8a", "#1765e8", "#d99723", "#738aa3"]} yUnit={unit} /> : <p>No complete fuel quantities are available.</p>}</div>
      <p>Only quantities in {unit || "the selected unit"} are combined. These are quantities, not energy shares. {fuel.incomplete} incomplete fuel groups and {fuel.unlabelled} unnamed rows omitted.</p>
    </section>
  </div>;
}
