import { parseDate, todayIn, type RangePreset, type RangeSpec, type ResolvedRange } from "./dateRanges";

export function rangeWithDefaults(preset: RangePreset, current: RangeSpec | null, timezone: string, resolved: ResolvedRange | null): RangeSpec {
  const t = parseDate(todayIn(timezone))!;
  const anchor = resolved ? parseDate(resolved.start) ?? t : t;
  const year = current?.year ?? anchor.y;
  switch (preset) {
    case "month":
      return { preset, year, month: current?.month ?? anchor.m };
    case "quarter":
      return { preset, year, quarter: current?.quarter ?? Math.ceil(anchor.m / 3) };
    case "half":
      return { preset, year, half: current?.half ?? (anchor.m <= 6 ? 1 : 2) };
    case "year":
    case "fiscal_year":
      return { preset, year };
    case "custom":
      return { preset, start: resolved?.start ?? current?.start ?? `${t.y}-01-01`, end: resolved?.end ?? current?.end ?? todayIn(timezone) };
    default:
      return { preset };
  }
}

