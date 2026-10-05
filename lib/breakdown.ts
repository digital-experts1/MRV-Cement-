import type { Co2BreakdownItem, SheetRow } from "./types";

export function buildFallbackBreakdown(calcs: Record<string, SheetRow>): Co2BreakdownItem[] {
  const process = parseFloat(String(calcs["Selected Process CO2"]?.Value ?? 0)) || 0;
  const fuel = parseFloat(String(calcs["Fuel Combustion CO2"]?.Value ?? 0)) || 0;
  const indirect = parseFloat(String(calcs["Indirect Grid CO2"]?.Value ?? 0)) || 0;
  const total = process + fuel + indirect;
  if (total === 0) return [];
  return [
    { component: "Process CO2", tCO2: process, share: process / total },
    { component: "Fuel Combustion CO2", tCO2: fuel, share: fuel / total },
    { component: "Indirect Grid CO2", tCO2: indirect, share: indirect / total },
  ];
}
