import { strictNumberOrNull } from "./numeric";
import type { Co2BreakdownItem, SheetRow } from "./types";

/** Returns an empty breakdown unless every component was actually calculated (missing is never treated as zero). */
export function buildFallbackBreakdown(calcs: Record<string, SheetRow>): Co2BreakdownItem[] {
  const process = strictNumberOrNull(calcs["Selected Process CO2"]?.Value);
  const fuel = strictNumberOrNull(calcs["Fuel Combustion CO2"]?.Value);
  const indirect = strictNumberOrNull(calcs["Indirect Grid CO2"]?.Value);
  if (process === null || fuel === null || indirect === null) return [];
  const total = process + fuel + indirect;
  if (total === 0) return [];
  return [
    { component: "Process CO2", tCO2: process, share: process / total },
    { component: "Fuel Combustion CO2", tCO2: fuel, share: fuel / total },
    { component: "Indirect Grid CO2", tCO2: indirect, share: indirect / total },
  ];
}
