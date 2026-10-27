/**
 * Shared reporting date-range resolution (Directive 04 §5). Pure; used by the browser selector and the server.
 * Dates are calendar dates ("YYYY-MM-DD") in the facility timezone. Ranges are inclusive [start, end] as dates;
 * timestamp queries use [startUtc, endExclusiveUtc) where endExclusiveUtc is the next local midnight after `end`.
 */

export const RANGE_PRESETS = [
  "today", "yesterday", "this_week", "previous_week", "this_month", "previous_month", "month", "quarter", "half",
  "mtd", "qtd", "ytd", "year", "previous_year", "fiscal_year", "last_7", "last_30", "last_90", "last_12_months", "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface RangeSpec {
  preset: RangePreset;
  year?: number;
  month?: number; // 1–12
  quarter?: number; // 1–4 (calendar quarter)
  half?: number; // 1–2
  start?: string;
  end?: string;
}

export interface ResolvedRange {
  spec: RangeSpec;
  start: string;
  end: string;
  label: string;
  timezone: string;
  startUtc: string;
  endExclusiveUtc: string;
  days: number;
  /** End lies after "today" in the facility timezone: coverage is necessarily partial. */
  extendsIntoFuture: boolean;
}

export interface ResolveOptions {
  timezone: string;
  now?: Date;
  fiscalYearStartMonth?: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = ISO.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

const toMs = (s: string) => {
  const p = parseDate(s);
  if (!p) throw new Error(`Invalid date ${s}`);
  return Date.UTC(p.y, p.m - 1, p.d);
};
const fromMs = (ms: number) => {
  const t = new Date(ms);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
export const addDays = (s: string, n: number) => fromMs(toMs(s) + n * DAY);
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const monthStart = (y: number, m: number) => ymd(y, m, 1);
export const monthEnd = (y: number, m: number) => ymd(y, m, daysInMonth(y, m));
export const isLastDayOfMonth = (s: string) => {
  const p = parseDate(s);
  return !!p && p.d === daysInMonth(p.y, p.m);
};
export const daysBetweenInclusive = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY) + 1;

function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

function zonedParts(utcMs: number, timezone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) if (part.type !== "literal") p[part.type] = Number(part.value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date "today" in the facility timezone. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const p = zonedParts(now.getTime(), timezone);
  return ymd(p.year, p.month, p.day);
}

/** First instant (UTC ISO) of a local calendar date, handling DST transitions that skip local midnight. */
export function zonedStartOfDayUtc(date: string, timezone: string): string {
  const local = toMs(date);
  const offsetAt = (ms: number) => {
    const p = zonedParts(ms, timezone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  let guess = local - offsetAt(local);
  guess = local - offsetAt(guess);
  // Move forward while the instant still falls on the previous local day (midnight skipped by DST).
  for (let i = 0; i < 4 && zonedDate(guess, timezone) < date; i++) guess += 3_600_000;
  // Move back while the previous hour is still the same local day (we landed after the first instant).
  for (let i = 0; i < 4 && zonedDate(guess - 3_600_000, timezone) === date; i++) guess -= 3_600_000;
  return new Date(guess).toISOString();
}

function zonedDate(ms: number, timezone: string): string {
  const p = zonedParts(ms, timezone);
  return ymd(p.year, p.month, p.day);
}

function isoWeekStart(s: string): string {
  const dow = new Date(toMs(s)).getUTCDay(); // 0 = Sunday
  return addDays(s, -((dow + 6) % 7));
}

const intInRange = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Validates untrusted input (stored preference, query string) into a RangeSpec. */
export function validateSpec(value: unknown): RangeSpec | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.preset !== "string" || !(RANGE_PRESETS as readonly string[]).includes(v.preset)) return null;
  const preset = v.preset as RangePreset;
  const spec: RangeSpec = { preset };
  if (preset === "month") {
    if (!intInRange(v.year, 1900, 2200) || !intInRange(v.month, 1, 12)) return null;
    spec.year = v.year;
    spec.month = v.month;
  } else if (preset === "quarter") {
    if (!intInRange(v.year, 1900, 2200) || !intInRange(v.quarter, 1, 4)) return null;
    spec.year = v.year;
    spec.quarter = v.quarter;
  } else if (preset === "half") {
    if (!intInRange(v.year, 1900, 2200) || !intInRange(v.half, 1, 2)) return null;
    spec.year = v.year;
    spec.half = v.half;
  } else if (preset === "year" || preset === "fiscal_year") {
    if (!intInRange(v.year, 1900, 2200)) return null;
    spec.year = v.year;
  } else if (preset === "custom") {
    if (typeof v.start !== "string" || typeof v.end !== "string" || !parseDate(v.start) || !parseDate(v.end) || v.end < v.start) return null;
    if (daysBetweenInclusive(v.start, v.end) > 366 * 10) return null;
    spec.start = v.start;
    spec.end = v.end;
  }
  return spec;
}

const mLabel = (y: number, m: number) => `${MONTHS[m - 1]} ${y}`;

export function resolveRange(spec: RangeSpec, opts: ResolveOptions): ResolvedRange {
  const tz = opts.timezone;
  const today = todayIn(tz, opts.now);
  const t = parseDate(today)!;
  let start: string;
  let end: string;
  let label: string;
  const span = (a: { y: number; m: number }, b: { y: number; m: number }) => `${mLabel(a.y, a.m)} – ${mLabel(b.y, b.m)}`;

  switch (spec.preset) {
    case "today":
      start = end = today;
      label = "Today";
      break;
    case "yesterday":
      start = end = addDays(today, -1);
      label = "Yesterday";
      break;
    case "this_week":
      start = isoWeekStart(today);
      end = addDays(start, 6);
      label = "This week (Mon–Sun)";
      break;
    case "previous_week":
      start = addDays(isoWeekStart(today), -7);
      end = addDays(start, 6);
      label = "Previous week (Mon–Sun)";
      break;
    case "this_month":
      start = monthStart(t.y, t.m);
      end = monthEnd(t.y, t.m);
      label = `This month (${MONTHS_LONG[t.m - 1]} ${t.y})`;
      break;
    case "previous_month": {
      const p = shiftMonth(t.y, t.m, -1);
      start = monthStart(p.y, p.m);
      end = monthEnd(p.y, p.m);
      label = `Previous month (${MONTHS_LONG[p.m - 1]} ${p.y})`;
      break;
    }
    case "month": {
      const y = spec.year ?? t.y;
      const m = spec.month ?? t.m;
      start = monthStart(y, m);
      end = monthEnd(y, m);
      label = `${MONTHS_LONG[m - 1]} ${y}`;
      break;
    }
    case "quarter": {
      const y = spec.year ?? t.y;
      const q = spec.quarter ?? Math.ceil(t.m / 3);
      const m0 = (q - 1) * 3 + 1;
      start = monthStart(y, m0);
      end = monthEnd(y, m0 + 2);
      label = `Calendar Q${q} ${y} (${MONTHS[m0 - 1]}–${MONTHS[m0 + 1]})`;
      break;
    }
    case "half": {
      const y = spec.year ?? t.y;
      const h = spec.half ?? (t.m <= 6 ? 1 : 2);
      start = monthStart(y, h === 1 ? 1 : 7);
      end = monthEnd(y, h === 1 ? 6 : 12);
      label = `H${h} ${y} (${h === 1 ? "Jan–Jun" : "Jul–Dec"})`;
      break;
    }
    case "mtd":
      start = monthStart(t.y, t.m);
      end = today;
      label = "Month to date";
      break;
    case "qtd": {
      const m0 = Math.floor((t.m - 1) / 3) * 3 + 1;
      start = monthStart(t.y, m0);
      end = today;
      label = "Calendar quarter to date";
      break;
    }
    case "ytd":
      start = monthStart(t.y, 1);
      end = today;
      label = "Calendar year to date";
      break;
    case "year": {
      const y = spec.year ?? t.y;
      start = monthStart(y, 1);
      end = monthEnd(y, 12);
      label = `Full calendar year ${y} (Jan–Dec)`;
      break;
    }
    case "previous_year":
      start = monthStart(t.y - 1, 1);
      end = monthEnd(t.y - 1, 12);
      label = `Previous calendar year ${t.y - 1} (Jan–Dec)`;
      break;
    case "fiscal_year": {
      const fm = opts.fiscalYearStartMonth ?? 1;
      const y = spec.year ?? (t.m >= fm ? t.y : t.y - 1);
      const last = shiftMonth(y, fm, 11);
      start = monthStart(y, fm);
      end = monthEnd(last.y, last.m);
      label = fm === 1 ? `Fiscal year ${y} (Jan–Dec)` : `Fiscal year starting ${mLabel(y, fm)} (${span({ y, m: fm }, last)})`;
      break;
    }
    case "last_7":
    case "last_30":
    case "last_90": {
      const n = spec.preset === "last_7" ? 7 : spec.preset === "last_30" ? 30 : 90;
      start = addDays(today, -(n - 1));
      end = today;
      label = `Last ${n} days (incl. today)`;
      break;
    }
    case "last_12_months": {
      const first = shiftMonth(t.y, t.m, -12);
      const last = shiftMonth(t.y, t.m, -1);
      start = monthStart(first.y, first.m);
      end = monthEnd(last.y, last.m);
      label = `Last 12 complete months (${span(first, last)})`;
      break;
    }
    case "custom":
      if (!spec.start || !spec.end || !parseDate(spec.start) || !parseDate(spec.end) || spec.end < spec.start) throw new Error("Custom range needs valid start ≤ end");
      start = spec.start;
      end = spec.end;
      label = "Custom range";
      break;
  }

  return {
    spec,
    start,
    end,
    label,
    timezone: tz,
    startUtc: zonedStartOfDayUtc(start, tz),
    endExclusiveUtc: zonedStartOfDayUtc(addDays(end, 1), tz),
    days: daysBetweenInclusive(start, end),
    extendsIntoFuture: end > today,
  };
}

export const rangeKey = (r: { start: string; end: string }) => `${r.start}..${r.end}`;

/**
 * Selector spec for a stored range's exact dates: a calendar month/quarter/half/year when the dates match one exactly,
 * otherwise a custom range. Resolving the result always yields exactly `start`..`end` (no relabelling of other dates).
 */
export function specForDates(start: string, end: string): RangeSpec {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b || end < start) throw new Error("Invalid stored range");
  if (a.d === 1 && isLastDayOfMonth(end) && a.y === b.y) {
    if (a.m === b.m) return { preset: "month", year: a.y, month: a.m };
    if (a.m % 3 === 1 && b.m === a.m + 2) return { preset: "quarter", year: a.y, quarter: (a.m + 2) / 3 };
    if ((a.m === 1 && b.m === 6) || (a.m === 7 && b.m === 12)) return { preset: "half", year: a.y, half: a.m === 1 ? 1 : 2 };
    if (a.m === 1 && b.m === 12) return { preset: "year", year: a.y };
  }
  return { preset: "custom", start, end };
}

/** Months (YYYY-MM) touched by an inclusive date range. */
export function monthsInRange(start: string, end: string): string[] {
  const a = parseDate(start)!;
  const b = parseDate(end)!;
  const out: string[] = [];
  let cur = { y: a.y, m: a.m };
  while (cur.y < b.y || (cur.y === b.y && cur.m <= b.m)) {
    out.push(`${cur.y}-${pad(cur.m)}`);
    cur = shiftMonth(cur.y, cur.m, 1);
  }
  return out;
}

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  previous_week: "Previous week",
  this_month: "This month",
  previous_month: "Previous month",
  month: "Calendar month…",
  quarter: "Calendar quarter (Q1–Q4)…",
  half: "Half year (H1/H2)…",
  mtd: "Month to date",
  qtd: "Quarter to date",
  ytd: "Year to date",
  year: "Full calendar year (Jan–Dec)…",
  previous_year: "Previous calendar year",
  fiscal_year: "Fiscal year…",
  last_7: "Last 7 days",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  last_12_months: "Last 12 complete months",
  custom: "Custom dates…",
};
