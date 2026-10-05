"use client";

import { BarChart, DonutChart } from "@/components/charts/ChartCanvas";
import { Icon } from "@/components/icons/Icon";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { RequireWorkbook } from "@/components/ui/RequireWorkbook";
import { useExplainer } from "@/context/ExplainerContext";
import { buildFallbackBreakdown } from "@/lib/breakdown";
import { CO2_COLORS } from "@/lib/charts";
import { fmtDec, fmtInt } from "@/lib/formatter";
import type { Store } from "@/lib/types";

function n(v: unknown): number {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
}

function qaBound(map: Record<string, number>, key: string, fallback: number): number {
  const v = map[key];
  return Number.isFinite(v) ? v : fallback;
}

function RangeBar({
  value,
  min,
  max,
  qaMin,
  qaMax,
  unit,
  label,
  explainKey,
}: {
  value: number;
  min: number;
  max: number;
  qaMin: number;
  qaMax: number;
  unit: string;
  label: string;
  explainKey?: string;
}) {
  const { showExplanation } = useExplainer();
  const range = max - min;
  const valPct = range > 0 ? Math.max(0, Math.min(100, ((value - min) / range) * 100)) : 50;
  const qaPct1 = range > 0 ? ((qaMin - min) / range) * 100 : 0;
  const qaPct2 = range > 0 ? ((qaMax - min) / range) * 100 : 100;
  const inRange = value >= qaMin && value <= qaMax;
  return (
    <div className="chart-card" data-explain={explainKey} style={explainKey ? { cursor: "pointer" } : undefined} onClick={explainKey ? () => showExplanation(explainKey) : undefined}>
      <div className="chart-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <h3 style={{ margin: 0 }}>{label}</h3>
          {explainKey ? (
            <span style={{ color: "var(--text-muted)", display: "flex" }}>
              <Icon name="info" size={13} />
            </span>
          ) : null}
        </div>
        <span className={`badge ${inRange ? "badge-pass" : "badge-fail"}`}>
          <span className={`qa-dot ${inRange ? "qa-dot-pass" : "qa-dot-fail"}`} />
          {inRange ? "In Range" : "Out of Range"}
        </span>
      </div>
      <div style={{ padding: "12px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 11, color: "var(--text-muted)" }}>
          <span>
            {min}
            {unit}
          </span>
          <span style={{ fontSize: 14, fontWeight: 700, color: inRange ? "var(--qa-pass)" : "var(--qa-fail)" }} className="mono">
            {fmtDec(value, 3)} {unit}
          </span>
          <span>
            {max}
            {unit}
          </span>
        </div>
        <div className="range-bar-track">
          <div className="range-bar-qa" style={{ left: `${qaPct1}%`, right: `${100 - qaPct2}%` }} />
          <div className="range-bar-value" style={{ left: `${valPct}%`, background: inRange ? "var(--accent)" : "var(--qa-fail)" }} />
        </div>
        <div className="range-bar-labels">
          <span>Min</span>
          <span style={{ color: "var(--qa-pass)" }}>
            QA min: {qaMin}
            {unit}
          </span>
          <span style={{ color: "var(--qa-pass)" }}>
            QA max: {qaMax}
            {unit}
          </span>
          <span>Max</span>
        </div>
      </div>
    </div>
  );
}

function AnalyticsContent({ s }: { s: Store }) {
  const { showExplanation } = useExplainer();
  const c = s.calculations;
  const clinkerFactor = n(c["Clinker Factor"]?.Value);
  const seeClinker = n(c["SEE Clinker"]?.Value);
  const seeCement = n(c["Specific Embedded Emissions Cement"]?.Value);
  const tsr = n(c["Thermal Substitution Rate (TSR)"]?.Value ?? c["Thermal Substitution Rate"]?.Value);
  const shc = n(c["Specific Heat Consumption"]?.Value);

  const constMap: Record<string, number> = {};
  s.constants.forEach((r) => {
    constMap[String(r["Constant / Factor"])] = parseFloat(String(r.Value));
  });
  const cfMin = qaBound(constMap, "Clinker factor min QA", 0.25);
  const cfMax = qaBound(constMap, "Clinker factor max QA", 1.0);
  const seeMin = qaBound(constMap, "SEE clinker min QA", 0.5);
  const seeMax = qaBound(constMap, "SEE clinker max QA", 1.2);
  const shcMin = qaBound(constMap, "Specific heat min QA", 2.8);
  const shcMax = qaBound(constMap, "Specific heat max QA", 4.5);
  const tsrMin = qaBound(constMap, "TSR min QA", 0);
  const tsrMax = qaBound(constMap, "TSR max QA", 80);

  const breakdown = s.dashboard.co2Breakdown.length > 0 ? s.dashboard.co2Breakdown : buildFallbackBreakdown(c);
  const kilnFuel = s.kilnFuel;
  const fuelTypes = [...new Set(kilnFuel.map((r) => String(r["Fuel Type"] || "")).filter(Boolean))];
  const fossilArr = fuelTypes.map((f) => kilnFuel.filter((r) => String(r["Fuel Type"]) === f).reduce((a, r) => a + n(r["Fossil CO2 t"]), 0));
  const biogenArr = fuelTypes.map((f) => kilnFuel.filter((r) => String(r["Fuel Type"]) === f).reduce((a, r) => a + n(r["Biogenic CO2 Memo t"]), 0));
  const energyArr = fuelTypes.map((f) => kilnFuel.filter((r) => String(r["Fuel Type"]) === f).reduce((a, r) => a + n(r["Energy GJ"]), 0));
  const totalEnergy = energyArr.reduce((a, b) => a + b, 0);

  const metrics = [
    { metric: "Clinker Factor", val: clinkerFactor, unit: "ratio", qaIn: clinkerFactor >= cfMin && clinkerFactor <= cfMax, src: "08_Calculations", key: "kpi-clinker-factor" },
    { metric: "SEE Clinker", val: seeClinker, unit: "tCO₂/t clinker", qaIn: seeClinker >= seeMin && seeClinker <= seeMax, src: "08_Calculations", key: "kpi-see-clinker" },
    { metric: "SEE Cement", val: seeCement, unit: "tCO₂/t cement", qaIn: seeCement >= 0.2 && seeCement <= 1.2, src: "08_Calculations", key: "kpi-see-cement" },
    { metric: "Specific Heat Consumption", val: shc, unit: "GJ/t clinker", qaIn: shc >= shcMin && shc <= shcMax, src: "08_Calculations", key: "kpi-specific-heat" },
    { metric: "TSR", val: tsr, unit: "%", qaIn: tsr >= tsrMin && tsr <= tsrMax, src: "08_Calculations", key: "kpi-tsr" },
  ];

  return (
    <>
      <PageHeader icon="bar-chart-2" title="Analytics Dashboard" desc="Advanced performance indicators, fuel mix substitutions, emission intensity gauges, and QA threshold bounds." />

      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="bar-chart-2" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>CO₂ Component Breakdown</h3>
            </div>
            <span className="badge badge-accent">{fmtInt(breakdown.reduce((a, d) => a + d.tCO2, 0))} tCO₂ total</span>
          </div>
          <div className="donut-split">
            <div className="chart-container donut-chart">
              <DonutChart breakdown={breakdown} />
            </div>
            <div style={{ flex: 1 }}>
              {breakdown.map((d) => (
                <div className="metric-row" key={d.component}>
                  <span className="metric-dot" style={{ background: CO2_COLORS[d.component] || "#60a5fa" }} />
                  <span className="metric-name">{d.component}</span>
                  <span className="metric-value">{fmtInt(d.tCO2)}</span>
                  <span className="metric-share">{fmtDec((d.share || 0) * 100, 1)}%</span>
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <div className="co2-share-bar">
                  {breakdown.map((d) => (
                    <div className="seg" key={d.component} style={{ flex: d.share, background: CO2_COLORS[d.component] || "#60a5fa" }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="flame" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Fuel Mix — Fossil vs Biogenic CO₂</h3>
            </div>
          </div>
          <div className="chart-container" style={{ height: 220 }}>
            <BarChart
              labels={fuelTypes}
              yUnit="tCO₂"
              datasets={[
                { label: "Fossil CO₂ (t)", data: fossilArr, color: "#f59e0b" },
                { label: "Biogenic CO₂ (t)", data: biogenArr, color: "#a78bfa" },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="grid-2 mb-lg">
        <div className="chart-card">
          <div className="chart-card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="zap" size={15} className="text-muted" />
              <h3 style={{ margin: 0 }}>Fuel Energy by Type</h3>
            </div>
            <span className="badge badge-info">TSR: {fmtDec(tsr, 2)}%</span>
          </div>
          <div className="chart-container" style={{ height: 200 }}>
            <BarChart labels={fuelTypes} yUnit="GJ" stacked datasets={[{ label: "Energy (GJ)", data: energyArr, color: "#00d4aa" }]} />
          </div>
          <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--bg-panel)", borderRadius: "var(--r-sm)", fontSize: 12 }}>
            <strong>Thermal Substitution Rate (TSR):</strong>
            <span className="mono" style={{ color: "var(--accent)", marginLeft: 8 }}>
              {fmtDec(tsr, 2)}%
            </span>
            <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>
              Alt fuel energy as % of total ({fmtInt(totalEnergy)} GJ total)
            </span>
          </div>
        </div>
        <RangeBar value={clinkerFactor} min={0} max={1.2} qaMin={cfMin} qaMax={cfMax} unit="" label="Clinker Factor vs QA Band" explainKey="kpi-clinker-factor" />
      </div>

      <div className="grid-2 mb-lg">
        <RangeBar value={seeClinker} min={0} max={1.5} qaMin={seeMin} qaMax={seeMax} unit=" tCO₂/t" label="SEE Clinker vs QA Range" explainKey="kpi-see-clinker" />
        <RangeBar value={seeCement} min={0} max={1.5} qaMin={0.2} qaMax={1.2} unit=" tCO₂/t" label="SEE Cement vs QA Range" explainKey="kpi-see-cement" />
      </div>

      <div className="grid-2 mb-lg">
        <RangeBar value={shc} min={0} max={6} qaMin={shcMin} qaMax={shcMax} unit=" GJ/t" label="Specific Heat Consumption vs QA Range" explainKey="kpi-specific-heat" />
        <RangeBar value={tsr} min={0} max={100} qaMin={tsrMin} qaMax={tsrMax} unit="%" label="Thermal Substitution Rate vs QA Range" explainKey="kpi-tsr" />
      </div>

      <div className="section-card">
        <SectionHeader icon="calculator" title="Key Metrics Summary Table (from 08_Calculations + 13_Dashboard)" />
        <div className="section-card-body no-pad">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Value</th>
                <th>Unit</th>
                <th>QA Result</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((row) => (
                <tr key={row.metric} data-explain={row.key} style={{ cursor: "pointer" }} title="Click for definition" onClick={() => showExplanation(row.key)}>
                  <td>
                    <strong>{row.metric}</strong>
                  </td>
                  <td className="num mono" style={{ color: "var(--accent)" }}>
                    {fmtDec(row.val, 4)}
                  </td>
                  <td className="unit-col">{row.unit}</td>
                  <td>
                    {row.qaIn ? (
                      <span className="badge badge-pass">
                        <span className="qa-dot qa-dot-pass" /> In Range
                      </span>
                    ) : (
                      <span className="badge badge-fail">
                        <span className="qa-dot qa-dot-fail" /> Out of Range
                      </span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: "var(--text-muted)" }}>{row.src}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function AnalyticsPage() {
  return <RequireWorkbook title="Analytics Dashboard">{(s) => <AnalyticsContent s={s} />}</RequireWorkbook>;
}
