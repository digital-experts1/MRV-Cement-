"use client";
import { useState } from "react";
import { BarChart, DonutChart } from "@/components/charts/ChartCanvas";
import { CO2_COLORS } from "@/lib/charts";
import type { Co2BreakdownItem } from "@/lib/types";
export function EmissionsVisual({ breakdown }: { breakdown: Co2BreakdownItem[] }) {
  const [mode, setMode] = useState<"donut" | "bars">("donut");
  const available = breakdown.length > 0 && breakdown.every(d => Number.isFinite(d.tCO2) && d.tCO2 >= 0) && breakdown.some(d => d.tCO2 > 0);
  return <div className="overview-emissions-visual"><div className="overview-chart-toggle" aria-label="Emissions chart view"><button type="button" aria-pressed={mode === "donut"} onClick={() => setMode("donut")}>Donut</button><button type="button" aria-pressed={mode === "bars"} onClick={() => setMode("bars")}>Bars</button></div>
    <div className="chart-container" role="img" aria-label="Emissions component chart. Exact values and shares are listed alongside.">{available ? mode === "donut" ? <DonutChart breakdown={breakdown} /> : <BarChart horizontal labels={breakdown.map(d => d.component)} data={breakdown.map(d => d.tCO2)} colors={breakdown.map(d => CO2_COLORS[d.component] || "#1677ff")} yUnit="tCO₂" /> : <p>No positive emissions breakdown is available for this period.</p>}</div>
  </div>;
}
