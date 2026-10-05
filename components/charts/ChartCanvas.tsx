"use client";

import { useEffect, useRef } from "react";
import {
  Chart,
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { CHART_DEFAULTS, CO2_COLORS, FUEL_COLORS, TOOLTIP_CFG, type ChartDataset } from "@/lib/charts";
import type { Co2BreakdownItem } from "@/lib/types";

Chart.register(
  DoughnutController,
  BarController,
  LineController,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Legend,
  Tooltip,
  Filler
);

function useChart(factory: () => ChartConfiguration, depsKey: string) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const instance = new Chart(ref.current, factory());
    return () => instance.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey]);

  return ref;
}

export function DonutChart({ breakdown }: { breakdown: Co2BreakdownItem[] }) {
  const ref = useChart(() => {
    const labels = breakdown.map((d) => d.component);
    const data = breakdown.map((d) => d.tCO2);
    const colors = labels.map((l) => CO2_COLORS[l] || "#1677FF");
    return {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderColor: "#FFFFFF", hoverOffset: 6, borderWidth: 3, borderRadius: 3 }],
      },
      options: {
        cutout: "72%",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP_CFG,
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed;
                const pct = breakdown[ctx.dataIndex] ? `${(breakdown[ctx.dataIndex].share * 100).toFixed(1)}%` : "";
                return `  ${ctx.label}: ${new Intl.NumberFormat("en-US").format(val)} tCO2 (${pct})`;
              },
            },
          },
        },
      },
    };
  }, JSON.stringify(breakdown));

  return <canvas ref={ref} />;
}

export function LineChart({ labels, datasets, yUnit }: { labels: string[]; datasets: ChartDataset[]; yUnit?: string }) {
  const ref = useChart(() => {
    const ds = datasets.map((d, i) => {
      const color = d.color || FUEL_COLORS[i % FUEL_COLORS.length];
      return {
        label: d.label,
        data: d.data,
        borderColor: color,
        backgroundColor: color + "18",
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: color,
        tension: 0.3,
        fill: datasets.length === 1,
      };
    });
    return {
      type: "line",
      data: { labels, datasets: ds },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: CHART_DEFAULTS.gridColor }, ticks: { color: CHART_DEFAULTS.color, font: CHART_DEFAULTS.font } },
          y: {
            grid: { color: CHART_DEFAULTS.gridColor },
            ticks: {
              color: CHART_DEFAULTS.color,
              font: CHART_DEFAULTS.font,
              callback: (v) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(Number(v)),
            },
          },
        },
        plugins: {
          legend: { labels: { color: "#64748B", font: CHART_DEFAULTS.font, boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            ...TOOLTIP_CFG,
            callbacks: {
              label: (ctx) => `  ${ctx.dataset.label}: ${new Intl.NumberFormat("en-US").format(ctx.parsed.y ?? 0)}${yUnit ? " " + yUnit : ""}`,
            },
          },
        },
      },
    };
  }, JSON.stringify({ labels, datasets, yUnit }));

  return <canvas ref={ref} />;
}

export function BarChart({
  labels,
  datasets,
  yUnit,
  stacked = false,
  horizontal = false,
  colors,
  data,
}: {
  labels: string[];
  datasets?: ChartDataset[];
  yUnit?: string;
  stacked?: boolean;
  horizontal?: boolean;
  colors?: string[];
  data?: number[];
}) {
  const ref = useChart(() => {
    const chartDatasets = datasets
      ? datasets.map((d, i) => ({
          label: d.label,
          data: d.data,
          backgroundColor: d.color || FUEL_COLORS[i % FUEL_COLORS.length],
          borderRadius: 3,
          borderSkipped: false as const,
        }))
      : [{ data: data || [], backgroundColor: colors, borderRadius: 3, borderSkipped: false as const }];

    return {
      type: "bar",
      data: { labels, datasets: chartDatasets },
      options: {
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked,
            grid: { color: CHART_DEFAULTS.gridColor },
            ticks: { color: CHART_DEFAULTS.color, font: CHART_DEFAULTS.font, stepSize: horizontal ? 1 : undefined },
          },
          y: {
            stacked,
            grid: { color: CHART_DEFAULTS.gridColor, display: !horizontal },
            ticks: {
              color: CHART_DEFAULTS.color,
              font: CHART_DEFAULTS.font,
              callback: horizontal
                ? undefined
                : (v) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(Number(v)) + (yUnit ? " " + yUnit : ""),
            },
          },
        },
        plugins: {
          legend: datasets ? { labels: { color: "#64748B", font: CHART_DEFAULTS.font, boxWidth: 10, boxHeight: 10 } } : { display: false },
          tooltip: datasets
            ? {
                ...TOOLTIP_CFG,
                callbacks: {
                  label: (ctx) => `  ${ctx.dataset.label}: ${new Intl.NumberFormat("en-US").format(ctx.parsed.y ?? 0)}${yUnit ? " " + yUnit : ""}`,
                },
              }
            : { enabled: false },
        },
      },
    };
  }, JSON.stringify({ labels, datasets, yUnit, stacked, horizontal, colors, data }));

  return <canvas ref={ref} />;
}
