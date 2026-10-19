import Decimal from "decimal.js";

export type NumericParse =
  | { kind: "blank" }
  | { kind: "ok"; value: Decimal }
  | { kind: "invalid"; reason: string };

const PLAIN = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
const US_GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
// "520.000" could be 520 (decimal point) or 520000 (European thousands separator).
const DOT_THOUSANDS_LOOKALIKE = /^[+-]?[1-9]\d{0,2}(\.\d{3})+$/;

/**
 * Strict numeric parsing for activity data.
 * Accepts: real numbers, plain decimal text ("1365.5") and US-style grouped text ("520,000.25").
 * Rejects ambiguous or non-numeric text instead of guessing (e.g. "520.000", "32,5", "1.234,5", "520 t", "#N/A").
 */
export function parseStrictNumber(value: unknown): NumericParse {
  if (value === null || value === undefined) return { kind: "blank" };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { kind: "ok", value: new Decimal(value) } : { kind: "invalid", reason: "Non-finite number" };
  }
  if (value instanceof Decimal) return { kind: "ok", value };
  if (typeof value !== "string") return { kind: "invalid", reason: `Unsupported value type (${typeof value})` };

  const text = value.trim();
  if (text === "") return { kind: "blank" };
  if (text.startsWith("#")) return { kind: "invalid", reason: `Spreadsheet error value "${text}"` };
  if (DOT_THOUSANDS_LOOKALIKE.test(text)) {
    return { kind: "invalid", reason: `Ambiguous number "${text}" (decimal point or thousands separator?)` };
  }
  if (PLAIN.test(text)) return { kind: "ok", value: new Decimal(text) };
  if (US_GROUPED.test(text)) return { kind: "ok", value: new Decimal(text.replace(/,/g, "")) };
  return { kind: "invalid", reason: `Not an unambiguous number: "${text}"` };
}

/** Convenience for display/UI code: number or null (invalid and blank both become null, never 0). */
export function strictNumberOrNull(value: unknown): number | null {
  const p = parseStrictNumber(value);
  return p.kind === "ok" ? p.value.toNumber() : null;
}
