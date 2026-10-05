export const CO2_COLORS: Record<string, string> = {
  "Process CO2": "#1677FF",
  "Fuel Combustion CO2": "#D97706",
  "Indirect Grid CO2": "#64748B",
  "Biogenic CO2 Memo": "#16A34A",
};

export const FUEL_COLORS = ["#1677FF", "#D97706", "#16A34A", "#64748B", "#DC2626", "#2563EB"];

export const CHART_DEFAULTS = {
  font: { family: "'Inter', sans-serif", size: 11 },
  color: "#94A3B8",
  borderColor: "#E2E8F0",
  gridColor: "#E2E8F0",
};

export const TOOLTIP_CFG = {
  backgroundColor: "#FFFFFF",
  borderColor: "#E2E8F0",
  borderWidth: 1,
  titleColor: "#172B4D",
  bodyColor: "#64748B",
  padding: 12,
};

export interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
}
